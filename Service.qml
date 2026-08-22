import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Background discovery for the Developer Control Center.
//
// Loaded once per shell as a `service` kind, so the scans below run once no
// matter how many monitors the bar spans. Every scan is a short-lived
// subprocess whose output is parsed by Model.js; nothing here blocks the
// shell, and a scan that fails leaves the previous result in place rather
// than blanking the panel.
//
// The panel reads this through `bar.shell.serviceFor(...)` — never by
// importing it, which would hand each importer its own empty copy.
Item {
  id: root
  visible: false

  // Injected by the shell's service loader.
  property var shell: null
  property var manifest: null

  // Services are not given `settings`; the bar widget pushes them in.
  property var settings: ({})

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property var config: Model.normalizeConfig(settings, home)

  // `null` means "not read yet / could not read", which the panel renders
  // differently from an honestly empty result.
  property var repos: null
  property var docker: null
  property var services: null
  property var machines: null
  property var tools: null

  property string defaultEditor: ""
  property bool panelOpen: false

  readonly property var loaded: ({
    repos: repos !== null,
    docker: docker !== null,
    services: services !== null,
    machines: machines !== null,
    tools: tools !== null
  })

  readonly property var snapshot: ({
    repos: repos || [],
    docker: docker || { available: false, reason: "", containers: [] },
    services: services,
    machines: machines || [],
    tools: tools || [],
    loaded: loaded
  })

  readonly property var attention: Model.computeAttention(snapshot, config)
  readonly property var barState: Model.barState(attention, snapshot)
  readonly property var env: ({ home: home, defaultEditor: defaultEditor, tools: tools || [] })

  readonly property string scriptDir: {
    var url = Qt.resolvedUrl("scripts/")
    var text = url.toString()
    return text.indexOf("file://") === 0 ? text.slice(7) : text
  }

  function script(name) {
    return scriptDir + name
  }

  // ---- Scans ---------------------------------------------------------------

  function refreshRepos() {
    if (repoProc.running) return
    var roots = config.projectRoots
    if (!roots || roots.length === 0) { repos = []; return }
    repoProc.command = ["bash", script("scan-repos.sh"), String(config.scanDepth)].concat(roots)
    repoProc.running = true
  }

  function refreshDocker() {
    if (dockerProc.running) return
    dockerProc.command = ["bash", script("docker-ps.sh")]
    dockerProc.running = true
  }

  function refreshServices() {
    if (portProc.running) return
    portProc.command = ["bash", script("ports.sh")]
    portProc.running = true
  }

  function refreshMachines() {
    if (sshProc.running || sshProc.awaitingResult) return
    sshProc.running = true
  }

  function refreshTools() {
    if (toolProc.running) return
    var names = []
    for (var i = 0; i < Model.TOOL_CATALOG.length; i++) names.push(Model.TOOL_CATALOG[i].name)
    if (config.gitUi && names.indexOf(config.gitUi) < 0) names.push(config.gitUi)
    if (config.containerUi && names.indexOf(config.containerUi) < 0) names.push(config.containerUi)
    toolProc.command = ["bash", script("tools.sh")].concat(names)
    toolProc.running = true
  }

  function refreshAll() {
    refreshRepos()
    refreshDocker()
    refreshServices()
    refreshMachines()
    refreshTools()
  }

  function refresh(what) {
    switch (what) {
      case "repos": refreshRepos(); break
      case "docker": refreshDocker(); break
      case "services": refreshServices(); break
      case "machines": refreshMachines(); break
      case "tools": refreshTools(); break
      default: refreshAll()
    }
  }

  // Re-derive services whenever containers change, so a port published by a
  // container is attributed to it without waiting for the next port scan.
  function reapplyServices() {
    if (rawServices === null) return
    services = Model.enrichServices(rawServices, snapshot.docker.containers, snapshot.repos, home)
  }

  property var rawServices: null
  // Probe generations change on setting transitions and successful host-list
  // reads. A process result is admitted only for the generation it started in.
  property int probeGeneration: 0
  property bool probeSettingKnown: false
  property bool previousProbeSetting: false

  function advanceProbeGeneration() {
    probeGeneration = Model.nextProbeGeneration(probeGeneration)
  }

  function syncProbeSetting() {
    var enabled = config.probeMachines
    if (probeSettingKnown && enabled === previousProbeSetting) return
    probeSettingKnown = true
    previousProbeSetting = enabled
    advanceProbeGeneration()
    if (!enabled && machines !== null) machines = Model.resetProbe(machines)
  }

  function probeMachines(hosts) {
    if (!config.probeMachines || probeProc.running || probeProc.awaitingResult || !hosts || hosts.length === 0) return
    var args = []
    for (var i = 0; i < hosts.length && i < 100; i++) args.push(hosts[i].alias, hosts[i].hostname)
    probeProc.command = ["bash", script("probe-hosts.sh")].concat(args)
    probeProc.startedGeneration = probeGeneration
    probeProc.running = true
  }

  onConfigChanged: {
    syncProbeSetting()
    refreshAll()
  }

  Component.onCompleted: {
    syncProbeSetting()
    editorProc.running = true
    refreshAll()
  }

  // ---- Processes -----------------------------------------------------------
  //
  // Each collector keeps the previous value when a scan fails: a momentary
  // failure should not erase what the user could see a second ago. Every
  // response is still put through a Model ceiling: the scripts already bound
  // their own output, and this is the backstop if one ever does not.

  Process {
    id: repoProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var parsed = Model.parseRepoScan(Model.clampText(text))
        if (parsed !== null) { root.repos = parsed; root.reapplyServices() }
        else if (root.repos === null) root.repos = []
      }
    }
  }

  Process {
    id: dockerProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var parsed = Model.parseDockerPs(Model.clampText(text))
        if (parsed !== null) { root.docker = parsed; root.reapplyServices() }
        else if (root.docker === null) root.docker = { available: false, reason: "docker check failed", containers: [] }
      }
    }
  }

  Process {
    id: portProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var parsed = Model.parsePorts(Model.clampText(text))
        if (parsed !== null) { root.rawServices = parsed; root.reapplyServices() }
        else if (root.services === null) root.services = []
      }
    }
  }

  Process {
    id: probeProc
    property bool awaitingResult: false
    property bool outputFinished: false
    property bool processFinished: false
    property int startedGeneration: -1

    function publishResult() {
      if (!outputFinished || !processFinished) return
      var accepted = Model.acceptsProbeResult(startedGeneration, root.probeGeneration,
                                              root.config.probeMachines)
      var retryCurrent = root.config.probeMachines && startedGeneration !== root.probeGeneration
      awaitingResult = false
      if (accepted && root.machines !== null)
        root.machines = Model.applyProbe(root.machines, Model.parseProbe(Model.clampText(probeOutput.text)))
      if (retryCurrent) root.probeMachines(root.machines)
    }

    onStarted: {
      awaitingResult = true
      outputFinished = false
      processFinished = false
    }
    onExited: function(exitCode, exitStatus) {
      processFinished = true
      publishResult()
    }
    stdout: StdioCollector {
      id: probeOutput
      waitForEnd: true
      onStreamFinished: {
        probeProc.outputFinished = true
        probeProc.publishResult()
      }
    }
  }

  Process {
    id: toolProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var parsed = Model.parseTools(Model.clampText(text))
        if (parsed !== null) root.tools = parsed
        else if (root.tools === null) root.tools = []
      }
    }
  }

  // The editor Omarchy would launch, so the project action can name it.
  Process {
    id: editorProc
    property bool awaitingResult: false
    property bool outputFinished: false
    property bool processFinished: false
    property int resultCode: -1
    property int resultStatus: -1

    command: ["bash", script("editor-path.sh")]

    function publishResult() {
      if (!outputFinished || !processFinished) return
      var payload = Model.boundedRead(editorOutput.text, editorOutput.data.byteLength,
                                      resultCode, resultStatus, Model.MAX_EDITOR_BYTES)
      awaitingResult = false
      // On overflow or failure, keep the empty fallback rather than ever
      // interpreting a truncated path as another executable.
      if (payload !== null) root.defaultEditor = payload
    }

    onStarted: {
      awaitingResult = true
      outputFinished = false
      processFinished = false
      resultCode = -1
      resultStatus = -1
    }
    onExited: function(exitCode, exitStatus) {
      resultCode = exitCode
      resultStatus = exitStatus
      processFinished = true
      publishResult()
    }
    stdout: StdioCollector {
      id: editorOutput
      waitForEnd: true
      onStreamFinished: {
        editorProc.outputFinished = true
        editorProc.publishResult()
      }
    }
  }

  // Only host metadata is read out of the SSH configuration; keys, identity
  // files and proxy commands are dropped by the parser. The script does the
  // reading — and stops at its own byte ceiling — because FileView has no
  // size limit of any kind and would load the whole user-writable file into
  // this process before anything here could look at it. With no config the
  // script exits 0 with no output, which parses as an empty list of hosts.
  Process {
    id: sshProc
    property bool awaitingResult: false
    property bool outputFinished: false
    property bool processFinished: false
    property int resultCode: -1
    property int resultStatus: -1

    command: ["bash", script("ssh-config.sh")]

    function publishResult() {
      if (!outputFinished || !processFinished) return
      var payload = Model.boundedRead(sshOutput.text, sshOutput.data.byteLength,
                                      resultCode, resultStatus, Model.MAX_SSH_BYTES)
      awaitingResult = false
      if (payload === null) {
        if (root.machines === null) root.machines = []
        return
      }
      var hosts = Model.parseSshConfig(payload)
      root.advanceProbeGeneration()
      root.machines = hosts === null ? [] : Model.carryProbe(root.machines, hosts, root.config.probeMachines)
      root.probeMachines(root.machines)
    }

    onStarted: {
      awaitingResult = true
      outputFinished = false
      processFinished = false
      resultCode = -1
      resultStatus = -1
    }
    onExited: function(exitCode, exitStatus) {
      resultCode = exitCode
      resultStatus = exitStatus
      processFinished = true
      publishResult()
    }
    stdout: StdioCollector {
      id: sshOutput
      waitForEnd: true
      onStreamFinished: {
        sshProc.outputFinished = true
        sshProc.publishResult()
      }
    }
  }

  // ---- Timers --------------------------------------------------------------
  //
  // Intervals come from configuration. While the panel is open, ports and
  // containers refresh at a floor of 5 s so what is on screen stays true;
  // repository scans keep their slower cadence because they touch the disk.

  Timer {
    interval: Math.max(1000, root.config.gitRefreshInterval * 1000)
    repeat: true
    running: true
    onTriggered: root.refreshRepos()
  }

  Timer {
    interval: Math.max(1000, (root.panelOpen ? Math.min(5, root.config.dockerRefreshInterval) : root.config.dockerRefreshInterval) * 1000)
    repeat: true
    running: true
    onTriggered: root.refreshDocker()
  }

  Timer {
    interval: Math.max(1000, (root.panelOpen ? Math.min(5, root.config.serviceRefreshInterval) : root.config.serviceRefreshInterval) * 1000)
    repeat: true
    running: true
    onTriggered: root.refreshServices()
  }

  // Re-reads the configuration and then probes. There is no file watch any
  // more, and a periodic re-read also picks up edits to `Include`d files,
  // which a watch on the top-level config never did. It runs even with
  // probing off so the host list stays current; probeMachines returns early
  // in that case, so nothing is pinged.
  Timer {
    interval: Math.max(10000, root.config.machineRefreshInterval * 1000)
    repeat: true
    running: true
    onTriggered: root.refreshMachines()
  }
}
