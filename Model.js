// Pure logic for the Developer Control Center.
//
// Everything that turns command output into state, state into rows, and key
// presses into the next state lives here rather than in QML, so every rule
// can be read on its own and tested with node outside a running shell.
//
// Conventions:
//   - `null` means "could not read"; an empty array means "read fine, nothing
//     there". The panel renders those differently on purpose.
//   - Commands are argv arrays. Nothing here builds a shell string from data
//     it discovered on the machine; identifiers that would travel as argv are
//     checked with `isSafeArg` first.
//   - Written against Qt's QML JavaScript engine: no spread, no arrow
//     functions, no Object.entries/fromEntries, `var` everywhere.

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

var DEFAULT_CONFIG = {
  projectRoots: ["~/Projects", "~/Developer", "~/Code", "~/Work", "~/src"],
  scanDepth: 2,
  terminal: "",
  editor: "",
  gitUi: "lazygit",
  containerUi: "lazydocker",
  gitRefreshInterval: 60,
  dockerRefreshInterval: 15,
  serviceRefreshInterval: 10,
  machineRefreshInterval: 120,
  probeMachines: true,
  barLabel: "DEV",
  barFormat: "full",
  expectedPorts: {},
  attention: {
    gitConflict: true,
    gitDirty: true,
    gitUnpushed: true,
    gitBehind: true,
    behindThreshold: 1,
    dockerUnhealthy: true,
    dockerExited: true,
    portConflict: true,
    serviceMissing: true,
    machineUnreachable: false
  }
}

var MIN_INTERVAL = 5

// ---------------------------------------------------------------------------
// Ceilings
// ---------------------------------------------------------------------------
//
// The plugin lives inside the long-lived shell process, so a single oversized
// response must not be able to pin memory for the rest of the session. The
// scripts bound their own output; these limits are the second line of defence,
// and the only one for ~/.ssh/config, which is read straight off disk with no
// script in between.

var MAX_COLLECTOR_BYTES = 1048576

// A payload can be under the byte ceiling and still be pathologically dense,
// so the parsers stop collecting once these many entries exist rather than
// building the whole array and trimming it afterwards.
var MAX_REPOS = 500
var MAX_CONTAINERS = 500
var MAX_SERVICES = 500
var MAX_HOSTS = 200

// Anything that is not a string is handed back untouched, so the
// `typeof text !== "string"` guard in every parser still sees what it expects
// and answers `null` instead of parsing an empty string as "nothing there".
function clampText(text, limit) {
  if (typeof text !== "string") return text
  var max = typeof limit === "number" && isFinite(limit) && limit > 0 ? limit : MAX_COLLECTOR_BYTES
  return text.length > max ? text.slice(0, max) : text
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function merge(target, source) {
  var out = {}
  var key
  for (key in target) if (Object.prototype.hasOwnProperty.call(target, key)) out[key] = target[key]
  if (source) for (key in source) if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key]
  return out
}

function expandHome(path, home) {
  if (typeof path !== "string") return ""
  if (path === "~") return home
  if (path.indexOf("~/") === 0) return home + path.slice(1)
  return path
}

function collapseHome(path, home) {
  if (typeof path !== "string") return ""
  if (home && path === home) return "~"
  if (home && path.indexOf(home + "/") === 0) return "~" + path.slice(home.length)
  return path
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value.trim() : fallback
}

function intervalOr(value, fallback) {
  if (typeof value !== "number" || !isFinite(value) || value <= 0) return fallback
  return Math.max(MIN_INTERVAL, Math.round(value))
}

function boolOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback
}

function normalizeConfig(raw, home) {
  var source = isObject(raw) ? raw : {}
  var roots = Array.isArray(source.projectRoots) && source.projectRoots.length > 0
    ? source.projectRoots.filter(function (r) { return typeof r === "string" && r.trim() !== "" })
    : []
  if (roots.length === 0) roots = DEFAULT_CONFIG.projectRoots.slice()
  var attentionSource = isObject(source.attention) ? source.attention : {}
  var attention = {}
  var key
  for (key in DEFAULT_CONFIG.attention) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG.attention, key)) continue
    var fallback = DEFAULT_CONFIG.attention[key]
    attention[key] = typeof fallback === "number"
      ? (typeof attentionSource[key] === "number" && attentionSource[key] >= 0 ? attentionSource[key] : fallback)
      : boolOr(attentionSource[key], fallback)
  }
  var expected = {}
  if (isObject(source.expectedPorts)) {
    for (key in source.expectedPorts) {
      if (!Object.prototype.hasOwnProperty.call(source.expectedPorts, key)) continue
      var port = parseInt(key, 10)
      if (port > 0 && port < 65536 && typeof source.expectedPorts[key] === "string") expected[String(port)] = source.expectedPorts[key]
    }
  }
  var format = stringOr(source.barFormat, "full")
  if (["full", "rich", "compact"].indexOf(format) < 0) format = "full"
  var depth = typeof source.scanDepth === "number" && source.scanDepth >= 1 && source.scanDepth <= 6 ? Math.round(source.scanDepth) : DEFAULT_CONFIG.scanDepth
  return {
    projectRoots: roots.map(function (r) { return expandHome(r.trim(), home) }),
    scanDepth: depth,
    terminal: stringOr(source.terminal, ""),
    editor: stringOr(source.editor, ""),
    gitUi: stringOr(source.gitUi, "") || DEFAULT_CONFIG.gitUi,
    containerUi: stringOr(source.containerUi, "") || DEFAULT_CONFIG.containerUi,
    gitRefreshInterval: intervalOr(source.gitRefreshInterval, DEFAULT_CONFIG.gitRefreshInterval),
    dockerRefreshInterval: intervalOr(source.dockerRefreshInterval, DEFAULT_CONFIG.dockerRefreshInterval),
    serviceRefreshInterval: intervalOr(source.serviceRefreshInterval, DEFAULT_CONFIG.serviceRefreshInterval),
    machineRefreshInterval: intervalOr(source.machineRefreshInterval, DEFAULT_CONFIG.machineRefreshInterval),
    probeMachines: boolOr(source.probeMachines, DEFAULT_CONFIG.probeMachines),
    barLabel: stringOr(source.barLabel, "") || DEFAULT_CONFIG.barLabel,
    barFormat: format,
    expectedPorts: expected,
    attention: attention
  }
}

// Anything that travels as an argv element must not look like an option and
// must not carry control characters. Absolute paths, container ids, ports and
// URLs all pass; a hostile SSH alias such as "-oProxyCommand=..." does not.
function isSafeArg(value) {
  if (typeof value !== "string" || value === "") return false
  if (value.charAt(0) === "-") return false
  return !/[\x00-\x1f\x7f]/.test(value)
}

function basename(path) {
  var trimmed = String(path || "").replace(/\/+$/, "")
  var idx = trimmed.lastIndexOf("/")
  return idx < 0 ? trimmed : trimmed.slice(idx + 1)
}

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s")
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

var REPO_BLOCK = "===repo==="
var REPO_REMOTE = "===remote==="
var REPO_STATUS = "===status==="
var REPO_ERROR = "===error==="
var REPO_END = "===end==="

function emptyStatus() {
  return { branch: "", upstream: "", ahead: 0, behind: 0, modified: 0, staged: 0, untracked: 0, conflicts: 0 }
}

// git status --porcelain=v2 --branch
function parsePorcelain(text) {
  var status = emptyStatus()
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (line === "") continue
    if (line.indexOf("# branch.head ") === 0) { status.branch = line.slice(14).trim(); continue }
    if (line.indexOf("# branch.upstream ") === 0) { status.upstream = line.slice(18).trim(); continue }
    if (line.indexOf("# branch.ab ") === 0) {
      var ab = line.slice(12).match(/\+(\d+)\s+-(\d+)/)
      if (ab) { status.ahead = parseInt(ab[1], 10); status.behind = parseInt(ab[2], 10) }
      continue
    }
    var tag = line.charAt(0)
    if (tag === "?") { status.untracked++; continue }
    if (tag === "u") { status.conflicts++; continue }
    if (tag === "1" || tag === "2") {
      var xy = line.slice(2, 4)
      if (xy.charAt(0) !== ".") status.staged++
      if (xy.charAt(1) !== ".") status.modified++
    }
  }
  return status
}

function parseRepoScan(text) {
  if (typeof text !== "string") return null
  var repos = []
  var blocks = text.split(REPO_BLOCK + "\n")
  for (var b = 0; b < blocks.length && repos.length < MAX_REPOS; b++) {
    var block = blocks[b]
    if (block.trim() === "") continue
    var endIdx = block.indexOf(REPO_END)
    if (endIdx < 0) continue
    block = block.slice(0, endIdx)
    var lines = block.split("\n")
    var path = (lines[0] || "").trim()
    if (path === "") continue
    var section = ""
    var remote = ""
    var statusText = ""
    var error = ""
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i]
      if (line === REPO_REMOTE) { section = "remote"; continue }
      if (line === REPO_STATUS) { section = "status"; continue }
      if (line === REPO_ERROR) { section = "error"; continue }
      if (section === "remote" && remote === "") remote = line.trim()
      else if (section === "status") statusText += line + "\n"
      else if (section === "error") error += (error ? "\n" : "") + line
    }
    var repo = merge(emptyStatus(), parsePorcelain(statusText))
    repo.name = basename(path)
    repo.path = path
    repo.remoteUrl = remote
    repo.remoteWebUrl = remoteWebUrl(remote)
    repo.error = error.trim()
    repos.push(repo)
  }
  return repos
}

function remoteWebUrl(url) {
  var value = String(url || "").trim()
  if (value === "") return ""
  var m = value.match(/^(?:ssh|git|https?):\/\/(?:[^@\/]+@)?([^\/:]+)(?::\d+)?\/(.+)$/)
  var host, path
  if (m) {
    host = m[1]
    path = m[2]
  } else {
    m = value.match(/^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/)
    if (!m) return ""
    host = m[1]
    path = m[2]
  }
  path = path.replace(/\/+$/, "").replace(/\.git$/, "")
  if (host === "" || path === "") return ""
  return "https://" + host + "/" + path
}

function isDirty(repo) {
  return (repo.modified || 0) + (repo.staged || 0) + (repo.untracked || 0) > 0
}

function repoState(repo) {
  if (!repo) return "error"
  if (repo.error) return "error"
  if (repo.conflicts > 0) return "conflict"
  if (isDirty(repo)) return "dirty"
  if (repo.behind > 0) return "behind"
  if (repo.ahead > 0) return "ahead"
  return "clean"
}

var REPO_RANK = { conflict: 0, dirty: 1, behind: 2, ahead: 3, error: 4, clean: 5 }

function repoIcon(repo) {
  var state = repoState(repo)
  if (state === "conflict") return "✕"
  if (state === "dirty" || state === "behind" || state === "error") return "⚠"
  return "●"
}

function repoSummary(repo) {
  if (repo.error) return "unreadable"
  if (repo.conflicts > 0) return "merge conflict"
  var parts = []
  if (repo.modified > 0) parts.push(repo.modified + " modified")
  if (repo.staged > 0) parts.push(repo.staged + " staged")
  if (repo.untracked > 0) parts.push(repo.untracked + " untracked")
  if (repo.ahead > 0) parts.push("↑" + repo.ahead)
  if (repo.behind > 0) parts.push("↓" + repo.behind)
  return parts.length ? parts.join(" · ") : "clean"
}

function sortRepos(repos) {
  return (repos || []).slice().sort(function (a, b) {
    var ra = REPO_RANK[repoState(a)], rb = REPO_RANK[repoState(b)]
    if (ra !== rb) return ra - rb
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

var DOCKER_UNAVAILABLE = "===docker-unavailable==="

function parseHealth(status) {
  var m = String(status || "").match(/\((healthy|unhealthy|health: starting)\)/)
  if (!m) return ""
  return m[1] === "health: starting" ? "starting" : m[1]
}

function parseExitCode(status) {
  var m = String(status || "").match(/^Exited \((\d+)\)/)
  return m ? parseInt(m[1], 10) : null
}

function parsePortMappings(text) {
  var out = []
  var seen = {}
  var parts = String(text || "").split(",")
  for (var i = 0; i < parts.length; i++) {
    var m = parts[i].trim().match(/^(.*):(\d+)(?:-\d+)?->(\d+)(?:-\d+)?\/(\w+)$/)
    if (!m) continue
    var entry = { host: parseInt(m[2], 10), container: parseInt(m[3], 10), proto: m[4] }
    var key = entry.host + ":" + entry.container + "/" + entry.proto
    if (seen[key]) continue
    seen[key] = true
    out.push(entry)
  }
  return out
}

function parseComposeProject(labels) {
  var out = { project: "", service: "" }
  var parts = String(labels || "").split(",")
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf("=")
    if (eq < 0) continue
    var k = parts[i].slice(0, eq).trim(), v = parts[i].slice(eq + 1).trim()
    if (k === "com.docker.compose.project") out.project = v
    else if (k === "com.docker.compose.service") out.service = v
  }
  return out
}

// docker ps -a --format '{{json .}}'
function parseDockerPs(text) {
  if (typeof text !== "string") return null
  if (text.indexOf(DOCKER_UNAVAILABLE) === 0) {
    return { available: false, reason: text.slice(DOCKER_UNAVAILABLE.length).trim(), containers: [] }
  }
  var containers = []
  var lines = text.split("\n")
  for (var i = 0; i < lines.length && containers.length < MAX_CONTAINERS; i++) {
    var line = lines[i].trim()
    if (line === "") continue
    var obj
    try { obj = JSON.parse(line) } catch (e) { continue }
    if (!isObject(obj) || typeof obj.ID !== "string") continue
    var status = String(obj.Status || "")
    var state = String(obj.State || "").toLowerCase()
    var compose = parseComposeProject(obj.Labels)
    containers.push({
      name: String(obj.Names || obj.ID).split(",")[0].trim(),
      id: obj.ID,
      image: String(obj.Image || ""),
      state: state,
      status: status,
      health: parseHealth(status),
      exitCode: parseExitCode(status),
      uptime: state === "running" ? status.replace(/^Up\s+/, "").replace(/\s*\([^)]*\)\s*$/, "") : "",
      ports: parsePortMappings(obj.Ports),
      compose: compose.project,
      composeService: compose.service
    })
  }
  return { available: true, reason: "", containers: containers }
}

function containerRank(c) {
  if (c.state !== "running" && c.exitCode !== null && c.exitCode !== 0) return 0
  if (c.state === "running" && c.health === "unhealthy") return 1
  if (c.state === "running") return 2
  return 3
}

function containerIcon(c) {
  var rank = containerRank(c)
  if (rank === 0) return "✕"
  if (rank === 1) return "⚠"
  if (rank === 2) return "●"
  return "○"
}

function containerSummary(c) {
  if (c.state === "running") {
    var parts = ["running"]
    if (c.health) parts.push(c.health)
    if (c.uptime) parts.push(c.uptime)
    return parts.join(" · ")
  }
  if (c.exitCode !== null && c.exitCode !== 0) return "exited (" + c.exitCode + ")"
  return c.state || "unknown"
}

function groupContainers(containers) {
  var groups = {}
  var names = []
  for (var i = 0; i < (containers || []).length; i++) {
    var c = containers[i]
    var key = c.compose || "Other"
    if (!groups[key]) { groups[key] = []; names.push(key) }
    groups[key].push(c)
  }
  names.sort(function (a, b) {
    if (a === "Other") return 1
    if (b === "Other") return -1
    return a < b ? -1 : a > b ? 1 : 0
  })
  return names.map(function (n) { return { name: n, items: groups[n] } })
}

function sortContainers(containers) {
  var indexed = (containers || []).map(function (c, i) { return { c: c, i: i } })
  indexed.sort(function (a, b) {
    var d = containerRank(a.c) - containerRank(b.c)
    return d !== 0 ? d : a.i - b.i
  })
  return indexed.map(function (x) { return x.c })
}

// ---------------------------------------------------------------------------
// Services / ports
// ---------------------------------------------------------------------------

var PORTS_SS = "===ss==="
var PORTS_PROCS = "===procs==="

// One line of `ss -Hlntp`.
function parseSsLine(line) {
  var tokens = String(line || "").trim().split(/\s+/)
  if (tokens.length < 5) return null
  var local = tokens[3]
  var m = local.match(/^(.*):(\d+)$/)
  if (!m) return null
  var address = m[1].replace(/^\[|\]$/g, "").replace(/%.*$/, "")
  var users = String(line).match(/users:\(\("([^"]*)",pid=(\d+)/)
  return {
    address: address,
    port: parseInt(m[2], 10),
    process: users ? users[1] : "",
    pid: users ? parseInt(users[2], 10) : 0
  }
}

function parseProcLines(text) {
  var out = {}
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split("\t")
    var pid = parseInt(parts[0], 10)
    if (!(pid > 0) || parts.length < 2) continue
    out[pid] = { cwd: parts[1] || "", cmdline: (parts[2] || "").trim() }
  }
  return out
}

function isLoopback(address) {
  return address.indexOf("127.") === 0 || address === "::1"
}

function parsePorts(text) {
  if (typeof text !== "string") return null
  var ssIdx = text.indexOf(PORTS_SS)
  var procIdx = text.indexOf(PORTS_PROCS)
  var ssText = ssIdx < 0 ? text : text.slice(ssIdx + PORTS_SS.length, procIdx < 0 ? undefined : procIdx)
  var procs = procIdx < 0 ? {} : parseProcLines(text.slice(procIdx + PORTS_PROCS.length))
  var byPort = {}
  var order = []
  var lines = ssText.split("\n")
  for (var i = 0; i < lines.length; i++) {
    var entry = parseSsLine(lines[i])
    if (!entry) continue
    var existing = byPort[entry.port]
    if (!existing) {
      // Extra addresses for a port already collected still merge; it is only
      // new ports that stop once the cap is reached.
      if (order.length >= MAX_SERVICES) continue
      existing = { port: entry.port, address: entry.address, addresses: [], local: true, process: "", pid: 0, cwd: "", cmdline: "" }
      byPort[entry.port] = existing
      order.push(entry.port)
    }
    existing.addresses.push(entry.address)
    if (!isLoopback(entry.address)) existing.local = false
    if (!existing.pid && entry.pid) { existing.pid = entry.pid; existing.process = entry.process }
    else if (!existing.process && entry.process) existing.process = entry.process
  }
  return order.map(function (port) {
    var s = byPort[port]
    var proc = procs[s.pid]
    if (proc) { s.cwd = proc.cwd; s.cmdline = proc.cmdline }
    return s
  })
}

var IMAGE_TECH = [
  [/postgres/i, "PostgreSQL"], [/redis|valkey/i, "Redis"], [/mariadb/i, "MariaDB"], [/mysql/i, "MySQL"],
  [/mongo/i, "MongoDB"], [/nats/i, "NATS"], [/grafana/i, "Grafana"], [/prometheus/i, "Prometheus"],
  [/rabbitmq/i, "RabbitMQ"], [/elasticsearch/i, "Elasticsearch"], [/nginx/i, "nginx"], [/caddy/i, "Caddy"],
  [/traefik/i, "Traefik"], [/minio/i, "MinIO"], [/keycloak/i, "Keycloak"], [/mailhog|mailpit/i, "Mail catcher"]
]

var CMDLINE_TECH = [
  [/\bnext\b/i, "Next.js"], [/\bnuxt\b/i, "Nuxt"], [/\bvite\b/i, "Vite"], [/\bastro\b/i, "Astro"],
  [/\bremix\b/i, "Remix"], [/\bng serve\b|@angular/i, "Angular"], [/\bstorybook\b/i, "Storybook"],
  [/\buvicorn\b/i, "Uvicorn"], [/\bgunicorn\b/i, "Gunicorn"], [/manage\.py|\bdjango\b/i, "Django"],
  [/\bflask\b/i, "Flask"], [/\bfastapi\b/i, "FastAPI"], [/\brails\b|\bpuma\b/i, "Rails"],
  [/\bphp\b.*artisan|\bartisan\b/i, "Laravel"], [/\bspring\b/i, "Spring"]
]

var PROCESS_TECH = [
  [/^node$/, "Node.js"], [/^bun$/, "Bun"], [/^deno$/, "Deno"], [/^python[\d.]*$/, "Python"],
  [/^java$/, "Java"], [/^dotnet$/, ".NET"], [/^postgres$|^postmaster$/, "PostgreSQL"], [/^redis-server$/, "Redis"],
  [/^mysqld$/, "MySQL"], [/^mariadbd$/, "MariaDB"], [/^mongod$/, "MongoDB"], [/^nats-server$/, "NATS"],
  [/^grafana/, "Grafana"], [/^prometheus$/, "Prometheus"], [/^ruby$/, "Ruby"], [/^php/, "PHP"],
  [/^caddy$/, "Caddy"], [/^nginx$/, "nginx"], [/^beam/, "Elixir/Erlang"], [/^php-fpm/, "PHP"]
]

var PORT_TECH = {
  5432: "PostgreSQL", 3306: "MySQL", 6379: "Redis", 27017: "MongoDB", 4222: "NATS",
  9090: "Prometheus", 5672: "RabbitMQ", 15672: "RabbitMQ", 9200: "Elasticsearch", 11211: "Memcached"
}

// Best effort, and honest about it: a bare conventional port earns a "?".
function detectTechnology(s) {
  var i
  if (s.image) {
    for (i = 0; i < IMAGE_TECH.length; i++) if (IMAGE_TECH[i][0].test(s.image)) return IMAGE_TECH[i][1]
  }
  if (s.cmdline) {
    for (i = 0; i < CMDLINE_TECH.length; i++) if (CMDLINE_TECH[i][0].test(s.cmdline)) return CMDLINE_TECH[i][1]
  }
  if (s.process) {
    for (i = 0; i < PROCESS_TECH.length; i++) if (PROCESS_TECH[i][0].test(s.process)) return PROCESS_TECH[i][1]
  }
  if (s.container) return ""
  if (!s.process && PORT_TECH[s.port]) return PORT_TECH[s.port] + "?"
  return ""
}

function findContainerForPort(containers, port) {
  for (var i = 0; i < (containers || []).length; i++) {
    var c = containers[i]
    if (c.state !== "running") continue
    for (var j = 0; j < c.ports.length; j++) if (c.ports[j].host === port) return c
  }
  return null
}

function findRepoForPath(repos, path) {
  if (!path) return null
  var best = null
  for (var i = 0; i < (repos || []).length; i++) {
    var r = repos[i]
    if (path === r.path || path.indexOf(r.path + "/") === 0) {
      if (!best || r.path.length > best.path.length) best = r
    }
  }
  return best
}

function enrichServices(services, containers, repos, home) {
  return (services || []).map(function (raw) {
    var s = merge(raw, {})
    var container = findContainerForPort(containers, s.port)
    s.source = container ? "docker" : "process"
    s.container = container ? container.name : ""
    s.containerId = container ? container.id : ""
    s.image = container ? container.image : ""
    var repo = findRepoForPath(repos, s.cwd)
    s.project = repo ? repo.name : ""
    s.projectPath = repo ? repo.path : ""
    s.technology = detectTechnology(s)
    s.location = container ? "Docker" : collapseHome(s.projectPath || s.cwd, home)
    s.url = "http://localhost:" + s.port
    return s
  })
}

// A listener owned by another user shows no pid through /proc, so all this
// plugin knows about it is a number. Unless the port itself is conventional
// (5432 says PostgreSQL loudly enough) there is nothing to tell the user, and
// a list of bare numbers buries the services they actually started.
function isUnidentifiedPort(s) {
  if (s.source === "docker") return false
  if (s.pid > 0 || s.process) return false
  return !PORT_TECH[s.port]
}

function serviceIcon() {
  return "●"
}

function serviceSummary(s) {
  var parts = []
  if (s.technology) parts.push(s.technology)
  else if (s.process) parts.push(s.process)
  if (s.location) parts.push(s.location)
  if (parts.length === 0) parts.push(s.source === "docker" ? "Docker" : "unknown process")
  return parts.join(" · ")
}

function sortServices(services) {
  return (services || []).filter(function (s) { return !isUnidentifiedPort(s) }).sort(function (a, b) { return a.port - b.port })
}

// ---------------------------------------------------------------------------
// Machines (SSH hosts)
// ---------------------------------------------------------------------------

function isHostPattern(alias) {
  return /[*?!]/.test(alias)
}

// Only the keys needed to display and launch a connection are read; the rest
// of the file (identities, proxies, options) is deliberately ignored.
function parseSshConfig(text) {
  if (typeof text !== "string") return null
  var hosts = []
  var current = null
  var lines = text.split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/#.*$/, "").trim()
    if (line === "") continue
    var m = line.match(/^(\S+)\s*(?:=|\s)\s*(.*)$/)
    if (!m) continue
    var key = m[1].toLowerCase(), value = m[2].trim()
    if (key === "host") {
      current = { aliases: value.split(/\s+/), hostname: "", user: "", port: 22 }
      hosts.push(current)
      continue
    }
    if (key === "match") { current = null; continue }
    if (!current) continue
    if (key === "hostname") current.hostname = value
    else if (key === "user") current.user = value
    else if (key === "port") { var p = parseInt(value, 10); if (p > 0 && p < 65536) current.port = p }
  }
  var out = []
  // A single Host line can carry any number of aliases, so the cap is checked
  // on both loops rather than only on the number of blocks.
  for (var h = 0; h < hosts.length && out.length < MAX_HOSTS; h++) {
    for (var a = 0; a < hosts[h].aliases.length && out.length < MAX_HOSTS; a++) {
      var alias = hosts[h].aliases[a]
      if (alias === "" || isHostPattern(alias)) continue
      out.push({ alias: alias, hostname: hosts[h].hostname || alias, user: hosts[h].user, port: hosts[h].port, status: "unknown", latency: 0 })
    }
  }
  return out
}

// Lines of "alias<TAB>ok|fail<TAB>milliseconds"
function parseProbe(text) {
  var out = {}
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split("\t")
    if (parts.length < 2 || parts[0] === "") continue
    out[parts[0]] = { ok: parts[1] === "ok", ms: parseInt(parts[2], 10) || 0 }
  }
  return out
}

function applyProbe(hosts, probe) {
  return (hosts || []).map(function (h) {
    var result = probe ? probe[h.alias] : null
    if (!result) return merge(h, { status: "unknown", latency: 0 })
    return merge(h, { status: result.ok ? "up" : "down", latency: result.ok ? result.ms : 0 })
  })
}

function machineIcon(m) {
  return m.status === "up" ? "●" : "○"
}

function machineAddress(m) {
  return (m.user ? m.user + "@" : "") + m.hostname + (m.port && m.port !== 22 ? ":" + m.port : "")
}

function machineSummary(m) {
  var parts = [machineAddress(m)]
  if (m.status === "up") parts.push(m.latency + " ms")
  else if (m.status === "down") parts.push("unreachable")
  return parts.join(" · ")
}

// ---------------------------------------------------------------------------
// Developer tools
// ---------------------------------------------------------------------------

var TOOL_CATALOG = [
  { name: "lazygit", category: "Git", launch: "tui" },
  { name: "gh", category: "Git", launch: "cli" },
  { name: "git", category: "Git", launch: "cli" },
  { name: "lazydocker", category: "Containers", launch: "tui" },
  { name: "docker", category: "Containers", launch: "cli" },
  { name: "podman", category: "Containers", launch: "cli" },
  { name: "btop", category: "System", launch: "tui" },
  { name: "htop", category: "System", launch: "tui" },
  { name: "k9s", category: "Kubernetes", launch: "tui" },
  { name: "kubectl", category: "Kubernetes", launch: "cli" },
  { name: "nvim", category: "Editors", launch: "tui" },
  { name: "vim", category: "Editors", launch: "tui" },
  { name: "hx", category: "Editors", launch: "tui" },
  { name: "zed", category: "Editors", launch: "gui" },
  { name: "code", category: "Editors", launch: "gui" },
  { name: "jq", category: "CLI", launch: "cli" },
  { name: "fzf", category: "CLI", launch: "cli" },
  { name: "rg", category: "CLI", launch: "cli" },
  { name: "fd", category: "CLI", launch: "cli" }
]

function catalogEntry(name) {
  for (var i = 0; i < TOOL_CATALOG.length; i++) if (TOOL_CATALOG[i].name === name) return TOOL_CATALOG[i]
  return null
}

// Lines of "name<TAB>/path/to/binary" or "name<TAB>-"
function parseTools(text) {
  if (typeof text !== "string") return null
  var out = []
  var lines = text.split("\n")
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split("\t")
    var name = (parts[0] || "").trim()
    if (name === "") continue
    var path = (parts[1] || "").trim()
    var entry = catalogEntry(name)
    out.push({
      name: name,
      path: path === "-" ? "" : path,
      installed: path !== "" && path !== "-",
      category: entry ? entry.category : "Other",
      launch: entry ? entry.launch : "cli"
    })
  }
  return out
}

function toolCategories(tools, installedOnly) {
  var order = []
  var groups = {}
  var i
  for (i = 0; i < TOOL_CATALOG.length; i++) {
    if (order.indexOf(TOOL_CATALOG[i].category) < 0) order.push(TOOL_CATALOG[i].category)
  }
  order.push("Other")
  for (i = 0; i < (tools || []).length; i++) {
    var t = tools[i]
    if (installedOnly && !t.installed) continue
    if (!groups[t.category]) groups[t.category] = []
    groups[t.category].push(t)
  }
  var out = []
  for (i = 0; i < order.length; i++) if (groups[order[i]]) out.push({ name: order[i], items: groups[order[i]] })
  return out
}

function isLaunchable(tool) {
  return !!tool && tool.installed === true && (tool.launch === "tui" || tool.launch === "gui")
}

function toolInstalled(tools, name) {
  if (!Array.isArray(tools)) return true
  for (var i = 0; i < tools.length; i++) if (tools[i].name === name) return tools[i].installed === true
  return false
}

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

var KIND_ORDER = { project: 0, container: 1, service: 2, machine: 3, tool: 4, action: 5 }

function repoAttention(repo, rules) {
  if (!repo || repo.error) return null
  if (repo.conflicts > 0) return rules.gitConflict ? { severity: "error", detail: "merge conflict" } : null
  if (isDirty(repo)) {
    if (!rules.gitDirty) return null
    var detail = repo.modified > 0 ? plural(repo.modified, "modified file")
      : repo.staged > 0 ? plural(repo.staged, "staged file")
      : plural(repo.untracked, "untracked file")
    return { severity: "warning", detail: detail }
  }
  if (repo.behind > 0 && repo.behind >= rules.behindThreshold) {
    return rules.gitBehind ? { severity: "warning", detail: plural(repo.behind, "commit") + " behind " + (repo.upstream || "upstream") } : null
  }
  if (repo.ahead > 0) return rules.gitUnpushed ? { severity: "warning", detail: plural(repo.ahead, "commit") + " not pushed" } : null
  return null
}

function containerAttention(c, rules) {
  if (c.state === "running" && c.health === "unhealthy") {
    return rules.dockerUnhealthy ? { severity: "warning", detail: "container unhealthy" } : null
  }
  if (c.state !== "running" && c.exitCode !== null && c.exitCode !== 0) {
    return rules.dockerExited ? { severity: "error", detail: "container exited unexpectedly (" + c.exitCode + ")" } : null
  }
  return null
}

function serviceOwner(s) {
  if (s.project) return s.project
  if (s.container) return s.container
  if (s.cwd) return basename(s.cwd)
  return s.process || ""
}

function ownerMatches(owner, s, expected) {
  var want = String(expected).toLowerCase()
  var candidates = [owner, s.project, s.container, s.process, basename(s.cwd || "")]
  for (var i = 0; i < candidates.length; i++) {
    var c = String(candidates[i] || "").toLowerCase()
    if (c !== "" && (c === want || c.indexOf(want) === 0)) return true
  }
  return false
}

function computeAttention(data, config) {
  var rules = (config && config.attention) || DEFAULT_CONFIG.attention
  var items = []
  var i, key
  var repos = (data && data.repos) || []
  for (i = 0; i < repos.length; i++) {
    var ra = repoAttention(repos[i], rules)
    if (ra) items.push({ severity: ra.severity, kind: "project", id: repos[i].path, title: repos[i].name, detail: ra.detail, ref: repos[i] })
  }
  var docker = data && data.docker
  if (docker && docker.available) {
    for (i = 0; i < docker.containers.length; i++) {
      var ca = containerAttention(docker.containers[i], rules)
      if (ca) items.push({ severity: ca.severity, kind: "container", id: docker.containers[i].id, title: docker.containers[i].name, detail: ca.detail, ref: docker.containers[i] })
    }
  }
  var expected = (config && config.expectedPorts) || {}
  var services = (data && data.services) || []
  for (key in expected) {
    if (!Object.prototype.hasOwnProperty.call(expected, key)) continue
    var port = parseInt(key, 10)
    var found = null
    for (i = 0; i < services.length; i++) if (services[i].port === port) { found = services[i]; break }
    if (!found) {
      if (rules.serviceMissing && data && data.loaded && data.loaded.services) {
        items.push({ severity: "warning", kind: "service", id: port, title: "Port " + port, detail: "expected " + expected[key] + ", nothing listening", ref: null })
      }
      continue
    }
    var owner = serviceOwner(found)
    if (rules.portConflict && owner && !ownerMatches(owner, found, expected[key])) {
      var who = found.process || found.container || "unknown process"
      items.push({
        severity: "warning", kind: "service", id: port, title: "Port " + port,
        detail: "expected " + expected[key] + ", used by " + who + (found.pid ? " (PID " + found.pid + ")" : ""),
        ref: found
      })
    }
  }
  if (rules.machineUnreachable) {
    var machines = (data && data.machines) || []
    for (i = 0; i < machines.length; i++) {
      if (machines[i].status === "down") items.push({ severity: "warning", kind: "machine", id: machines[i].alias, title: machines[i].alias, detail: "unreachable", ref: machines[i] })
    }
  }
  var indexed = items.map(function (it, idx) { return { it: it, idx: idx } })
  indexed.sort(function (a, b) {
    var sa = a.it.severity === "error" ? 0 : 1, sb = b.it.severity === "error" ? 0 : 1
    if (sa !== sb) return sa - sb
    var ka = KIND_ORDER[a.it.kind], kb = KIND_ORDER[b.it.kind]
    if (ka !== kb) return ka - kb
    return a.idx - b.idx
  })
  return indexed.map(function (x) { return x.it })
}

function attentionSummary(items) {
  var errors = 0, warnings = 0
  for (var i = 0; i < (items || []).length; i++) {
    if (items[i].severity === "error") errors++
    else warnings++
  }
  return { errors: errors, warnings: warnings }
}

function activeCount(data) {
  var running = 0
  var docker = data && data.docker
  if (docker && docker.available) {
    for (var i = 0; i < docker.containers.length; i++) if (docker.containers[i].state === "running") running++
  }
  var local = sortServices((data && data.services) || []).filter(function (s) { return s.source !== "docker" }).length
  return running + local
}

function barState(items, data) {
  var summary = attentionSummary(items)
  var active = activeCount(data)
  if (summary.errors > 0) return { glyph: "✕", count: summary.errors, active: active, severity: "error" }
  if (summary.warnings > 0) return { glyph: "⚠", count: summary.warnings, active: active, severity: "warning" }
  return { glyph: "●", count: 0, active: active, severity: "healthy" }
}

function barText(state, config, vertical) {
  var label = (config && config.barLabel) || DEFAULT_CONFIG.barLabel
  var format = (config && config.barFormat) || "full"
  var countText = state.count > 0 ? " " + state.count : ""
  if (vertical) return state.count > 0 ? state.glyph + "\n" + state.count : state.glyph
  if (format === "compact") return state.glyph + countText
  if (format === "rich") return label + " " + state.active + " ●" + (state.count > 0 ? " " + state.count + " " + state.glyph : "")
  return label + " " + state.glyph + countText
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

var TERMINAL_EDITORS = ["nvim", "vim", "vi", "nano", "micro", "hx", "helix", "fresh", "emacs -nw"]
var LAUNCH_PREFIX = ["setsid", "uwsm-app", "--"]

function terminalCommand(path, terminal) {
  if (terminal) return { command: LAUNCH_PREFIX.concat([terminal]), cwd: path }
  return { command: LAUNCH_PREFIX.concat(["xdg-terminal-exec", "--dir=" + path]), cwd: "" }
}

function tuiCommand(argv, dir, opts) {
  var options = opts || {}
  var out = LAUNCH_PREFIX.concat(["xdg-terminal-exec", "--app-id=org.omarchy." + basename(argv[0])])
  if (dir) out.push("--dir=" + dir)
  if (options.hold) out.push("--hold")
  out.push("-e")
  return out.concat(argv)
}

function resolveEditor(configured, defaultFile) {
  var fromConfig = stringOr(configured, "")
  if (fromConfig) return fromConfig
  var fromFile = String(defaultFile || "").split("\n")[0].trim()
  return fromFile || "nvim"
}

function editorCommand(editor, path) {
  if (TERMINAL_EDITORS.indexOf(basename(editor)) >= 0) return tuiCommand([editor, "."], path, {})
  return LAUNCH_PREFIX.concat([editor, path])
}

function runAction(id, label, command, extra) {
  return merge({ id: id, label: label, command: command, cwd: "", destructive: false }, extra || {})
}

function projectActions(repo, config, env) {
  var actions = []
  if (!isSafeArg(repo.path)) return actions
  var term = terminalCommand(repo.path, config.terminal)
  actions.push(runAction("terminal", "Open terminal", term.command, { cwd: term.cwd }))
  var editor = resolveEditor(config.editor, env.defaultEditor)
  actions.push(runAction("editor", "Open editor (" + editor + ")", editorCommand(editor, repo.path)))
  if (toolInstalled(env.tools, config.gitUi)) {
    actions.push(runAction("gitui", "Open " + config.gitUi, tuiCommand([config.gitUi], repo.path, {})))
  }
  actions.push({ id: "copy-path", label: "Copy path", copy: repo.path, destructive: false })
  if (repo.remoteWebUrl) actions.push(runAction("remote", "Open remote repository", ["omarchy-launch-browser", repo.remoteWebUrl]))
  actions.push({ id: "refresh", label: "Refresh", refresh: "repos", destructive: false })
  return actions
}

var SHELL_PROBE = "command -v bash >/dev/null 2>&1 && exec bash || exec sh"

function containerActions(c, config, env) {
  var actions = []
  if (!isSafeArg(c.id)) return actions
  actions.push(runAction("logs", "Open logs", tuiCommand(["docker", "logs", "-f", "--tail", "200", c.id], "", {})))
  if (c.state === "running") {
    actions.push(runAction("shell", "Open shell", tuiCommand(["docker", "exec", "-it", c.id, "sh", "-c", SHELL_PROBE], "", {})))
    actions.push(runAction("restart", "Restart", ["docker", "restart", c.id], { destructive: true, refresh: "docker" }))
    actions.push(runAction("stop", "Stop", ["docker", "stop", c.id], { destructive: true, refresh: "docker" }))
  } else {
    actions.push(runAction("start", "Start", ["docker", "start", c.id], { refresh: "docker" }))
  }
  actions.push({ id: "copy-id", label: "Copy container ID", copy: c.id, destructive: false })
  if (toolInstalled(env.tools, config.containerUi)) {
    actions.push(runAction("lazydocker", "Open " + config.containerUi, ["omarchy-launch-or-focus-tui", config.containerUi]))
  }
  return actions
}

function serviceActions(s, config) {
  var actions = []
  var url = "http://localhost:" + s.port
  actions.push(runAction("open-url", "Open in browser", ["omarchy-launch-browser", url]))
  actions.push({ id: "copy-url", label: "Copy URL", copy: url, destructive: false })
  if (s.source === "docker") {
    actions.push({ id: "open-container", label: "Open container", navigate: { kind: "container", id: s.containerId }, destructive: false })
    return actions
  }
  if (s.projectPath) actions.push({ id: "open-project", label: "Open project", navigate: { kind: "project", id: s.projectPath }, destructive: false })
  var dir = s.projectPath || s.cwd
  if (dir && isSafeArg(dir)) {
    var term = terminalCommand(dir, config.terminal)
    actions.push(runAction("terminal", "Open terminal", term.command, { cwd: term.cwd }))
  }
  if (s.pid > 0) {
    var pid = String(s.pid)
    actions.push(runAction("inspect", "Show process", tuiCommand(["ps", "-o", "pid,ppid,user,%cpu,%mem,etime,args", "-p", pid], "", { hold: true })))
    actions.push(runAction("stop-process", "Stop process", ["kill", "-TERM", pid], { destructive: true, refresh: "services" }))
  }
  return actions
}

function machineActions(m, config, env) {
  var actions = []
  if (isSafeArg(m.alias)) actions.push(runAction("connect", "Connect with SSH", tuiCommand(["ssh", m.alias], "", {})))
  var term = terminalCommand(env.home || "", config.terminal)
  actions.push(runAction("terminal", "Open terminal", term.command, { cwd: term.cwd }))
  if (isSafeArg(m.hostname)) actions.push(runAction("ping", "Ping", tuiCommand(["ping", "-c", "4", m.hostname], "", { hold: true })))
  actions.push({ id: "copy-hostname", label: "Copy hostname", copy: m.hostname, destructive: false })
  actions.push({ id: "copy-address", label: "Copy address", copy: (m.user ? m.user + "@" : "") + m.hostname, destructive: false })
  return actions
}

function toolActions(t) {
  if (!isLaunchable(t) || !isSafeArg(t.name)) return []
  if (t.launch === "gui") return [runAction("launch", "Launch " + t.name, LAUNCH_PREFIX.concat([t.name]))]
  return [runAction("launch", "Launch " + t.name, ["omarchy-launch-or-focus-tui", t.name])]
}

function actionsFor(item, config, env, data) {
  var environment = env || {}
  var cfg = config || normalizeConfig({}, environment.home || "")
  if (!item || !item.ref) return []
  switch (item.kind) {
    case "project": return projectActions(item.ref, cfg, environment)
    case "container": return containerActions(item.ref, cfg, environment)
    case "service": return serviceActions(item.ref, cfg)
    case "machine": return machineActions(item.ref, cfg, environment)
    case "tool": return toolActions(item.ref)
    case "attention": {
      var target = findResource(item.ref.kind, item.ref.id, data)
      return target ? actionsFor({ kind: item.ref.kind, ref: target }, cfg, environment, data) : []
    }
  }
  return []
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function findResource(kind, id, data) {
  if (!data) return null
  var list, i
  if (kind === "project") {
    list = data.repos || []
    for (i = 0; i < list.length; i++) if (list[i].path === id) return list[i]
  } else if (kind === "container") {
    list = (data.docker && data.docker.containers) || []
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
  } else if (kind === "service") {
    list = data.services || []
    for (i = 0; i < list.length; i++) if (list[i].port === id) return list[i]
  } else if (kind === "machine") {
    list = data.machines || []
    for (i = 0; i < list.length; i++) if (list[i].alias === id) return list[i]
  } else if (kind === "tool") {
    list = data.tools || []
    for (i = 0; i < list.length; i++) if (list[i].name === id) return list[i]
  }
  return null
}

function header(label) {
  return { type: "header", label: label }
}

function emptyRow(label) {
  return { type: "empty", label: label }
}

function projectRow(repo) {
  return { type: "item", kind: "project", id: repo.path, icon: repoIcon(repo), title: repo.name, subtitle: repo.branch || "", meta: repoSummary(repo), ref: repo }
}

function containerRow(c) {
  return { type: "item", kind: "container", id: c.id, icon: containerIcon(c), title: c.name, subtitle: containerSummary(c), meta: c.compose || "", ref: c }
}

function serviceRow(s) {
  return { type: "item", kind: "service", id: s.port, icon: serviceIcon(s), title: ":" + s.port, subtitle: serviceSummary(s), meta: s.local ? "localhost" : "", ref: s }
}

function machineRow(m) {
  return { type: "item", kind: "machine", id: m.alias, icon: machineIcon(m), title: m.alias, subtitle: machineSummary(m), meta: "", ref: m }
}

function toolRow(t) {
  return { type: "item", kind: "tool", id: t.name, icon: t.installed ? "✓" : "○", title: t.name, subtitle: t.path || "not installed", meta: isLaunchable(t) ? "launch" : "", ref: t }
}

function attentionRow(item) {
  return { type: "item", kind: "attention", id: item.kind + ":" + item.id, icon: item.severity === "error" ? "✕" : "⚠", title: item.title, subtitle: item.detail, meta: item.kind, ref: item }
}

function isLoaded(data, key) {
  if (!data || !data.loaded) return false
  return data.loaded[key] === true
}

function emptyMessage(view, data, config) {
  switch (view) {
    case "projects":
      if (!isLoaded(data, "repos") || data.repos === null) return "Scanning project directories…"
      return "No projects found\n\nAdd a project directory in Developer Control Center settings.\n\nExample:\n~/Projects"
    case "containers":
      if (!isLoaded(data, "docker") || !data.docker) return "Checking Docker…"
      if (!data.docker.available) return "Docker not detected\n\nContainer monitoring is disabled." + (data.docker.reason ? "\n\n" + data.docker.reason : "")
      return "No containers found"
    case "services":
      if (!isLoaded(data, "services") || data.services === null) return "Scanning listening ports…"
      return "No development services listening"
    case "machines":
      if (!isLoaded(data, "machines") || data.machines === null) return "Reading SSH configuration…"
      return "No SSH hosts found\n\nHosts configured in ~/.ssh/config\nwill appear here automatically."
    case "attention":
      return "Nothing needs attention"
    case "tools":
      if (!isLoaded(data, "tools") || data.tools === null) return "Detecting developer tools…"
      return "No developer tools detected"
  }
  return "Nothing here"
}

// The one-line summary under the panel title. It counts what was actually
// discovered, and says so in the plural the number deserves.
function heroMeta(data) {
  if (!data || !data.loaded) return "starting…"
  var parts = []
  parts.push(data.loaded.repos ? plural(data.repos.length, "project") : "scanning projects")
  if (!data.loaded.docker) parts.push("checking Docker")
  else if (!data.docker.available) parts.push("no Docker")
  else parts.push(plural(data.docker.containers.length, "container"))
  parts.push(data.loaded.services ? plural(sortServices(data.services || []).length, "service") : "scanning ports")
  return parts.join(" · ")
}

function overviewSections() {
  return [
    { view: "attention", label: "Attention", cap: 5 },
    { view: "projects", label: "Projects", cap: 5 },
    { view: "containers", label: "Containers", cap: 5 },
    { view: "services", label: "Services", cap: 5 },
    { view: "machines", label: "Machines", cap: 4 }
  ]
}

function sectionItems(view, data, config) {
  switch (view) {
    case "attention": return computeAttention(data, config).map(attentionRow)
    case "projects": return sortRepos(data.repos || []).map(projectRow)
    case "containers": return sortContainers((data.docker && data.docker.containers) || []).map(containerRow)
    case "services": return sortServices(data.services || []).map(serviceRow)
    case "machines": return (data.machines || []).map(machineRow)
    case "tools": return (data.tools || []).filter(function (t) { return t.installed }).map(toolRow)
  }
  return []
}

function countLabel(label, n) {
  return label + " (" + n + ")"
}

function listRows(view, data, config) {
  var rows = []
  var items
  if (view === "containers" && data.docker && data.docker.available) {
    var groups = groupContainers(data.docker.containers)
    if (groups.length === 0) return [header("Containers"), emptyRow(emptyMessage(view, data, config))]
    for (var g = 0; g < groups.length; g++) {
      rows.push(header(countLabel(groups[g].name, groups[g].items.length)))
      items = sortContainers(groups[g].items).map(containerRow)
      for (var i = 0; i < items.length; i++) rows.push(items[i])
    }
    return rows
  }
  if (view === "tools") {
    var cats = toolCategories(data.tools || [], true)
    if (cats.length === 0) return [header("Developer Tools"), emptyRow(emptyMessage(view, data, config))]
    for (var c = 0; c < cats.length; c++) {
      rows.push(header(cats[c].name))
      for (var t = 0; t < cats[c].items.length; t++) rows.push(toolRow(cats[c].items[t]))
    }
    return rows
  }
  items = sectionItems(view, data, config)
  var label = view.charAt(0).toUpperCase() + view.slice(1)
  rows.push(header(items.length ? countLabel(label, items.length) : label))
  if (items.length === 0) rows.push(emptyRow(emptyMessage(view, data, config)))
  for (var k = 0; k < items.length; k++) rows.push(items[k])
  return rows
}

function overviewRows(data, config) {
  var rows = []
  var sections = overviewSections()
  for (var s = 0; s < sections.length; s++) {
    var items = sectionItems(sections[s].view, data, config)
    var total = items.length
    rows.push(header(total > 0 ? countLabel(sections[s].label, total) : sections[s].label))
    if (total === 0) {
      rows.push(emptyRow(sections[s].view === "attention" ? "● Nothing needs attention" : emptyMessage(sections[s].view, data, config).split("\n")[0]))
      continue
    }
    var shown = items.slice(0, sections[s].cap)
    for (var i = 0; i < shown.length; i++) rows.push(shown[i])
    if (total > shown.length) rows.push(emptyRow("+" + (total - shown.length) + " more · press " + sectionKeyFor(sections[s].view).toUpperCase()))
  }
  return rows
}

function info(label, value) {
  return { type: "info", label: label, value: String(value) }
}

function portsLabel(ports) {
  if (!ports || ports.length === 0) return "none published"
  return ports.map(function (p) { return p.host + " → " + p.container + "/" + p.proto }).join(", ")
}

function detailRows(detail, data, config, env) {
  var ref = findResource(detail.kind, detail.id, data)
  if (!ref) return [emptyRow("This item is no longer available.\nIt may have been removed or stopped.")]
  var rows = []
  var home = (env && env.home) || ""
  switch (detail.kind) {
    case "project":
      rows.push({ type: "hero", icon: repoIcon(ref), title: ref.name, subtitle: collapseHome(ref.path, home) })
      rows.push(header("Git"))
      if (ref.error) rows.push(info("Error", ref.error))
      rows.push(info("Branch", ref.branch || "—"))
      rows.push(info("Modified", ref.modified))
      rows.push(info("Staged", ref.staged))
      rows.push(info("Untracked", ref.untracked))
      if (ref.conflicts > 0) rows.push(info("Conflicts", ref.conflicts))
      rows.push(info("Upstream", ref.upstream || "none"))
      rows.push(info("Ahead", ref.ahead))
      rows.push(info("Behind", ref.behind))
      rows.push(info("Remote", ref.remoteUrl || "none"))
      break
    case "container":
      rows.push({ type: "hero", icon: containerIcon(ref), title: ref.name, subtitle: ref.image })
      rows.push(header("Status"))
      rows.push(info("State", containerSummary(ref)))
      rows.push(info("Image", ref.image))
      rows.push(info("Ports", portsLabel(ref.ports)))
      rows.push(info("Compose", ref.compose ? ref.compose + (ref.composeService ? " / " + ref.composeService : "") : "none"))
      rows.push(info("ID", ref.id))
      break
    case "service":
      rows.push({ type: "hero", icon: serviceIcon(ref), title: "localhost:" + ref.port, subtitle: ref.technology || ref.process || "" })
      rows.push(header("Process"))
      rows.push(info("Process", ref.process || (ref.source === "docker" ? "Docker" : "unknown")))
      if (ref.pid) rows.push(info("PID", ref.pid))
      if (ref.container) rows.push(info("Container", ref.container))
      rows.push(info("Project", ref.project ? collapseHome(ref.projectPath, home) : "—"))
      if (ref.cwd) rows.push(info("Working directory", collapseHome(ref.cwd, home)))
      if (ref.cmdline) rows.push(info("Command", ref.cmdline))
      rows.push(info("Bound to", ref.local ? "localhost only" : "all interfaces"))
      break
    case "machine":
      rows.push({ type: "hero", icon: machineIcon(ref), title: ref.alias, subtitle: machineAddress(ref) })
      rows.push(header("Host"))
      rows.push(info("Hostname", ref.hostname))
      rows.push(info("User", ref.user || "default"))
      rows.push(info("Port", ref.port))
      rows.push(info("Status", ref.status === "up" ? "reachable · " + ref.latency + " ms" : ref.status === "down" ? "unreachable" : "not probed"))
      break
    case "tool":
      rows.push({ type: "hero", icon: ref.installed ? "✓" : "○", title: ref.name, subtitle: ref.category })
      rows.push(header("Tool"))
      rows.push(info("Path", ref.path || "not installed"))
      rows.push(info("Category", ref.category))
      break
  }
  var actions = actionsFor({ kind: detail.kind, ref: ref }, config, env, data)
  rows.push(header("Actions"))
  if (actions.length === 0) rows.push(emptyRow("No actions available"))
  for (var i = 0; i < actions.length; i++) {
    rows.push({ type: "action", action: actions[i], title: actions[i].label, destructive: actions[i].destructive === true, ref: ref, kind: detail.kind })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function scoreMatch(query, text) {
  var q = String(query || "").toLowerCase().trim()
  if (q === "") return 0
  var t = String(text || "").toLowerCase()
  var idx = t.indexOf(q)
  if (idx < 0) return 0
  var base = idx === 0 ? 100 : /[^a-z0-9]/.test(t.charAt(idx - 1)) ? 80 : 60
  return base - Math.min(t.length, 40) / 100
}

function scoreWords(query, fields) {
  var words = String(query || "").toLowerCase().trim().split(/\s+/).filter(function (w) { return w !== "" })
  if (words.length === 0) return 0
  var total = 0
  for (var w = 0; w < words.length; w++) {
    var best = 0
    for (var f = 0; f < fields.length; f++) {
      var s = scoreMatch(words[w], fields[f])
      if (s > best) best = s
    }
    if (best === 0) return 0
    total += best
  }
  return total / words.length
}

function searchAction(score, item, action) {
  return { type: "item", kind: "action", id: item.kind + ":" + item.id + ":" + action.id, icon: "›", title: action.label, subtitle: item.kind + " · " + item.title, meta: "", ref: item.ref, action: action, score: score }
}

function searchResults(query, data, config) {
  var q = String(query || "").trim()
  if (q === "") return []
  var results = []
  var i, score, row
  var env = { tools: data.tools }

  var repos = data.repos || []
  for (i = 0; i < repos.length; i++) {
    score = scoreWords(q, [repos[i].name, repos[i].branch])
    if (score > 0) {
      row = projectRow(repos[i]); row.score = score; results.push(row)
    }
    var actions = projectActions(repos[i], config, env)
    for (var a = 0; a < actions.length; a++) {
      var label = actions[a].id === "terminal" ? "Open " + repos[i].name + " terminal"
        : actions[a].id === "gitui" ? "Open " + repos[i].name + " in " + config.gitUi
        : actions[a].id === "editor" ? "Open " + repos[i].name + " in editor"
        : ""
      if (label === "") continue
      var as = scoreWords(q, [label, repos[i].name])
      if (as > 0) {
        var withLabel = merge(actions[a], { label: label })
        results.push(searchAction(as - 5, { kind: "project", id: repos[i].path, title: repos[i].name, ref: repos[i] }, withLabel))
      }
    }
  }

  var containers = (data.docker && data.docker.containers) || []
  for (i = 0; i < containers.length; i++) {
    score = scoreWords(q, [containers[i].name, containers[i].image, containers[i].compose])
    if (score > 0) { row = containerRow(containers[i]); row.score = score; results.push(row) }
    var logsLabel = "Open " + containers[i].name + " logs"
    var ls = scoreWords(q, [logsLabel])
    if (ls > 0) {
      var logs = containerActions(containers[i], config, env)[0]
      if (logs) results.push(searchAction(ls - 5, { kind: "container", id: containers[i].id, title: containers[i].name, ref: containers[i] }, merge(logs, { label: logsLabel })))
    }
  }

  var services = sortServices(data.services || [])
  for (i = 0; i < services.length; i++) {
    score = scoreWords(q, [String(services[i].port), services[i].technology, services[i].process, services[i].project, services[i].container])
    if (score > 0) { row = serviceRow(services[i]); row.score = score; results.push(row) }
  }

  var machines = data.machines || []
  for (i = 0; i < machines.length; i++) {
    score = scoreWords(q, [machines[i].alias, machines[i].hostname])
    if (score > 0) { row = machineRow(machines[i]); row.score = score; results.push(row) }
    var connectLabel = "Connect to " + machines[i].alias
    var cs = scoreWords(q, [connectLabel])
    if (cs > 0) {
      var connect = machineActions(machines[i], config, env)[0]
      if (connect && connect.id === "connect") results.push(searchAction(cs - 5, { kind: "machine", id: machines[i].alias, title: machines[i].alias, ref: machines[i] }, merge(connect, { label: connectLabel })))
    }
  }

  var tools = (data.tools || []).filter(function (t) { return t.installed })
  for (i = 0; i < tools.length; i++) {
    score = scoreWords(q, [tools[i].name])
    if (score > 0) { row = toolRow(tools[i]); row.score = score; results.push(row) }
  }

  results.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score
    var ka = KIND_ORDER[a.kind], kb = KIND_ORDER[b.kind]
    if (ka !== kb) return ka - kb
    if (a.title.length !== b.title.length) return a.title.length - b.title.length
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0
  })
  return results.slice(0, 50)
}

// ---------------------------------------------------------------------------
// Navigation reducer
// ---------------------------------------------------------------------------

var SECTION_KEYS = { p: "projects", c: "containers", s: "services", m: "machines", a: "attention", t: "tools", o: "overview" }

function sectionForKey(key) {
  var k = String(key || "").toLowerCase()
  return SECTION_KEYS[k] || ""
}

function sectionKeyFor(view) {
  for (var k in SECTION_KEYS) if (Object.prototype.hasOwnProperty.call(SECTION_KEYS, k) && SECTION_KEYS[k] === view) return k
  return ""
}

// The section chips. Each label begins with its own shortcut key, so the
// panel can underline that first letter instead of spelling the shortcuts out
// again underneath — the hint line has no room for a list this long, and a
// key printed where the eye already is beats one printed in a footer.
function sectionChips() {
  return [
    { key: "o", label: "Overview" },
    { key: "p", label: "Projects" },
    { key: "c", label: "Containers" },
    { key: "s", label: "Services" },
    { key: "m", label: "Machines" },
    { key: "a", label: "Attention" },
    { key: "t", label: "Tools" }
  ]
}

// Only the keys that do something in the current state, so the line stays
// short enough to fit the panel.
function hintText(ui) {
  if (ui && ui.confirm) return "← → choose · ⏎ confirm · esc cancel"
  if (ui && ui.detail) return "↑↓ select · ⏎ run · r refresh · esc back"
  if (ui && ui.searching) return "↑↓ select · ⏎ open · esc clear"
  return "↑↓ select · ⏎ open · / search · r refresh · esc close"
}

function initialUi() {
  return { view: "overview", index: 0, query: "", searching: false, detail: null, confirm: null, returnIndex: 0 }
}

function rowsFor(ui, data, config, env) {
  if (ui.searching) {
    if (ui.query.trim() === "") return [emptyRow("Type to search projects, containers, services, machines, tools and actions")]
    var results = searchResults(ui.query, data, config)
    return results.length ? results : [emptyRow("No matches for \"" + ui.query + "\"")]
  }
  if (ui.detail) return detailRows(ui.detail, data, config, env)
  if (ui.view === "overview") return overviewRows(data, config)
  return listRows(ui.view, data, config)
}

function isSelectable(row) {
  return !!row && (row.type === "item" || row.type === "action")
}

function selectableIndexes(rows) {
  var out = []
  for (var i = 0; i < (rows || []).length; i++) if (isSelectable(rows[i])) out.push(i)
  return out
}

function moveSelection(ui, rows, delta) {
  var sel = selectableIndexes(rows)
  if (sel.length === 0) return merge(ui, { index: 0 })
  var cur = sel.indexOf(ui.index)
  if (cur < 0) return merge(ui, { index: sel[0] })
  var next = (cur + delta) % sel.length
  if (next < 0) next += sel.length
  return merge(ui, { index: sel[next] })
}

function jumpSection(ui, key) {
  if (ui.searching) return ui
  var view = sectionForKey(key)
  if (view === "") return ui
  return merge(ui, { view: view, index: 0, detail: null, confirm: null })
}

function typeSearch(ui, query) {
  return merge(ui, { searching: true, query: String(query || ""), index: 0, detail: null, confirm: null })
}

function clearSearch(ui) {
  return merge(ui, { searching: false, query: "", index: 0 })
}

function effectFor(action) {
  if (!action) return null
  if (action.command) return { type: "run", command: action.command, cwd: action.cwd || "", refresh: action.refresh || "" }
  if (typeof action.copy === "string") return { type: "copy", text: action.copy }
  if (action.refresh) return { type: "refresh", what: action.refresh }
  return null
}

function applyAction(ui, action) {
  if (action.navigate) {
    return { ui: merge(ui, { detail: action.navigate, searching: false, query: "", index: 0, confirm: null }), effect: null }
  }
  if (action.destructive) return { ui: merge(ui, { confirm: { action: action } }), effect: null }
  return { ui: merge(ui, { confirm: null }), effect: effectFor(action) }
}

function activate(ui, rows, data, config, env) {
  if (ui.confirm) {
    return { ui: merge(ui, { confirm: null }), effect: effectFor(ui.confirm.action) }
  }
  var row = rows[ui.index]
  if (!isSelectable(row)) return { ui: ui, effect: null }
  if (row.type === "action") return applyAction(ui, row.action)
  if (row.kind === "action") return applyAction(ui, row.action)
  var detail = row.kind === "attention" ? { kind: row.ref.kind, id: row.ref.id } : { kind: row.kind, id: row.id }
  if (row.kind === "attention" && !row.ref.ref) return { ui: ui, effect: null }
  var firstAction = selectableIndexes(detailRows(detail, data, config, env))[0] || 0
  return { ui: merge(ui, { detail: detail, returnIndex: ui.index, index: firstAction, searching: false, query: "", confirm: null }), effect: null }
}

function back(ui) {
  if (ui.confirm) return { ui: merge(ui, { confirm: null }), effect: null }
  if (ui.detail) return { ui: merge(ui, { detail: null, index: ui.returnIndex || 0 }), effect: null }
  if (ui.searching) return { ui: clearSearch(ui), effect: null }
  if (ui.view !== "overview") return { ui: merge(ui, { view: "overview", index: 0 }), effect: null }
  return { ui: ui, effect: { type: "close" } }
}
