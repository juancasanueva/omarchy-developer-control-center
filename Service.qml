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
    sshFile.reload()
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

  function probeMachines(hosts) {
    if (!config.probeMachines || probeProc.running || !hosts || hosts.length === 0) return
    var args = []
    for (var i = 0; i < hosts.length && i < 100; i++) args.push(hosts[i].alias, hosts[i].hostname)
    probeProc.command = ["bash", script("probe-hosts.sh")].concat(args)
    probeProc.running = true
  }

  onConfigChanged: refreshAll()

  Component.onCompleted: {
    editorProc.running = true
    refreshAll()
  }

  // ---- Processes -----------------------------------------------------------
  //
  // Each collector keeps the previous value when a scan fails: a momentary
  // failure should not erase what the user could see a second ago. Every
  // response is passed through Model.clampText because the scripts already
  // bound their own output and this is the backstop if one ever does not.

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
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (root.machines === null) return
        root.machines = Model.applyProbe(root.machines, Model.parseProbe(Model.clampText(text)))
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
    command: ["bash", "-c", "cat \"${XDG_STATE_HOME:-$HOME/.local/state}/omarchy/defaults/editor\" 2>/dev/null || true"]
    // A path, not a listing, so it gets a much tighter ceiling than the rest.
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: root.defaultEditor = Model.clampText(text, 4096) }
  }

  // Only host metadata is read out of the SSH configuration; keys, identity
  // files and proxy commands are dropped by the parser.
  FileView {
    id: sshFile
    path: root.home ? root.home + "/.ssh/config" : ""
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      var hosts = Model.parseSshConfig(Model.clampText(text()))
      root.machines = hosts === null ? [] : hosts
      root.probeMachines(root.machines)
    }
    onLoadFailed: if (root.machines === null) root.machines = []
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

  Timer {
    interval: Math.max(10000, root.config.machineRefreshInterval * 1000)
    repeat: true
    running: root.config.probeMachines
    onTriggered: root.probeMachines(root.machines)
  }
}
