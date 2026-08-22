// Model.js is loaded by QML, so it has no module system of its own. Reading
// and evaluating the source keeps the shipped file free of node-isms while
// still letting every parsing and navigation rule be tested outside a
// running shell.
import { readFileSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"

const source = readFileSync(new URL("../Model.js", import.meta.url), "utf8")
const Model = new Function(
  source + `
  return {
    DEFAULT_CONFIG, normalizeConfig, expandHome, collapseHome, isSafeArg,
    parseRepoScan, parsePorcelain, repoState, repoIcon, repoSummary, remoteWebUrl, sortRepos,
    parseDockerPs, parseHealth, parsePortMappings, parseComposeProject, parseExitCode,
    containerIcon, containerSummary, groupContainers, sortContainers,
    parsePorts, parseSsLine, parseProcLines, enrichServices, detectTechnology, serviceIcon,
    serviceSummary, isUnidentifiedPort, sortServices,
    parseSshConfig, parseProbe, applyProbe, machineIcon, machineSummary,
    parseTools, TOOL_CATALOG, toolCategories, isLaunchable,
    computeAttention, attentionSummary, barState, barText,
    initialUi, SECTION_KEYS, sectionForKey, rowsFor, selectableIndexes, moveSelection,
    jumpSection, activate, back, typeSearch, clearSearch, detailRows,
    searchResults, scoreMatch,
    actionsFor, terminalCommand, tuiCommand, editorCommand, resolveEditor,
    emptyMessage, overviewSections, heroMeta
  }`
)()

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOME = "/home/dev"

const repoScan = `===repo===
/home/dev/Projects/backend-api
===remote===
git@github.com:acme/backend-api.git
===status===
# branch.oid 0909bab6aebb1d140226ab35b4f34290b5e47a89
# branch.head feature/auth
# branch.upstream origin/feature/auth
# branch.ab +2 -0
1 .M N... 100644 100644 100644 abc def src/a.js
1 .M N... 100644 100644 100644 abc def src/b.js
1 MM N... 100644 100644 100644 abc def src/c.js
1 A. N... 000000 100644 100644 000 def src/new.js
? notes.txt
? tmp/
===end===
===repo===
/home/dev/Projects/frontend
===remote===
https://gitlab.com/acme/frontend
===status===
# branch.oid deadbeef
# branch.head develop
# branch.upstream origin/develop
# branch.ab +0 -4
===end===
===repo===
/home/dev/Projects/clean-lib
===remote===
===status===
# branch.oid deadbeef
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
===end===
===repo===
/home/dev/Projects/conflicted
===remote===
git@github.com:acme/conflicted.git
===status===
# branch.oid deadbeef
# branch.head feature/merge
# branch.ab +1 -0
u UU N... 100644 100644 100644 100644 a b c d src/x.js
===end===
===repo===
/home/dev/Projects/broken
===error===
fatal: not a git repository
===end===
`

const dockerPs = [
  JSON.stringify({
    Names: "backend-api-postgres-1", ID: "a1b2c3d4e5f6", Image: "postgres:17",
    State: "running", Status: "Up 2 hours (healthy)", RunningFor: "2 hours ago",
    Ports: "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp",
    Labels: "com.docker.compose.project=backend-api,com.docker.compose.service=postgres,foo=bar"
  }),
  JSON.stringify({
    Names: "backend-api-redis-1", ID: "b2c3d4e5f6a1", Image: "redis:7",
    State: "running", Status: "Up 2 hours (unhealthy)", RunningFor: "2 hours ago",
    Ports: "127.0.0.1:6379->6379/tcp",
    Labels: "com.docker.compose.project=backend-api,com.docker.compose.service=redis"
  }),
  JSON.stringify({
    Names: "integration-tests", ID: "c3d4e5f6a1b2", Image: "tests:latest",
    State: "exited", Status: "Exited (1) 3 minutes ago", RunningFor: "5 minutes ago",
    Ports: "", Labels: ""
  }),
  JSON.stringify({
    Names: "grafana", ID: "d4e5f6a1b2c3", Image: "grafana/grafana",
    State: "exited", Status: "Exited (0) 2 days ago", RunningFor: "3 days ago",
    Ports: "", Labels: "com.docker.compose.project=monitoring"
  }),
  "this is not json",
  JSON.stringify({
    Names: "starting-db", ID: "e5f6a1b2c3d4", Image: "mysql:8",
    State: "running", Status: "Up 3 seconds (health: starting)", RunningFor: "3 seconds ago",
    Ports: "3306/tcp", Labels: ""
  })
].join("\n")

const portScan = `===ss===
LISTEN 0      4096                 127.0.0.53%lo:53    0.0.0.0:*
LISTEN 0      4096                     127.0.0.1:3000  0.0.0.0:* users:(("node",pid=18342,fd=20),("node",pid=18342,fd=21))
LISTEN 0      4096                             *:3000  *:*       users:(("node",pid=18342,fd=22))
LISTEN 0      128                        0.0.0.0:22    0.0.0.0:*
LISTEN 0      4096                       0.0.0.0:5432  0.0.0.0:*
LISTEN 0      4096                          [::]:8080  [::]:*    users:(("python",pid=12491,fd=5))
LISTEN 0      4096                     127.0.0.1:5173  0.0.0.0:* users:(("node",pid=777,fd=30))
LISTEN 0      4096                     127.0.0.1:7437  0.0.0.0:* users:(("engram",pid=16276,fd=8))
===procs===
18342\t/home/dev/Projects/frontend\tnode /home/dev/Projects/frontend/node_modules/.bin/next dev
12491\t/home/dev/Projects/old-api\tpython -m uvicorn app:app --port 8080
777\t/home/dev/Projects/admin-ui\tnode /home/dev/Projects/admin-ui/node_modules/vite/bin/vite.js
`

const sshConfig = `# comment
Host dev-server
    HostName 192.168.1.40
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host homelab build-server
  hostname homelab.local

Host *
  ServerAliveInterval 60

Host git-?
  HostName example.com

Match host something
  User other
`

const toolScan = `lazygit\t/usr/bin/lazygit
lazydocker\t/usr/bin/lazydocker
btop\t/usr/bin/btop
htop\t-
k9s\t-
nvim\t/usr/bin/nvim
zed\t-
docker\t/usr/bin/docker
git\t/usr/bin/git
jq\t/usr/bin/jq
`

const config = Model.normalizeConfig({}, HOME)
const repos = Model.parseRepoScan(repoScan)
const docker = Model.parseDockerPs(dockerPs)
const rawServices = Model.parsePorts(portScan)
const services = Model.enrichServices(rawServices, docker.containers, repos, HOME)
const machines = Model.applyProbe(Model.parseSshConfig(sshConfig), Model.parseProbe("dev-server\tok\t18\nhomelab\tok\t31\nbuild-server\tfail\t0\n"))
const tools = Model.parseTools(toolScan)
const data = () => ({ repos, docker, services, machines, tools, loaded: { repos: true, docker: true, services: true, machines: true, tools: true } })

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

test("normalizeConfig fills defaults and keeps valid overrides", () => {
  const c = Model.normalizeConfig({ editor: "zed", gitRefreshInterval: 120, projectRoots: ["~/Work"] }, HOME)
  assert.equal(c.editor, "zed")
  assert.equal(c.gitRefreshInterval, 120)
  assert.deepEqual(c.projectRoots, ["/home/dev/Work"])
  assert.equal(c.gitUi, "lazygit")
  assert.equal(c.attention.gitDirty, true)
})

test("normalizeConfig rejects garbage without throwing", () => {
  const c = Model.normalizeConfig({ projectRoots: "nope", gitRefreshInterval: -5, attention: "x", editor: 42 }, HOME)
  assert.deepEqual(c.projectRoots, Model.DEFAULT_CONFIG.projectRoots.map(p => Model.expandHome(p, HOME)))
  assert.equal(c.gitRefreshInterval, Model.DEFAULT_CONFIG.gitRefreshInterval)
  assert.equal(c.attention.gitDirty, true)
  assert.equal(c.editor, "")
  assert.equal(Model.normalizeConfig(null, HOME).gitUi, "lazygit")
})

test("normalizeConfig clamps intervals to a sane minimum", () => {
  const c = Model.normalizeConfig({ serviceRefreshInterval: 1 }, HOME)
  assert.ok(c.serviceRefreshInterval >= 5)
})

test("expandHome and collapseHome are inverses for ~ paths", () => {
  assert.equal(Model.expandHome("~/Projects", HOME), "/home/dev/Projects")
  assert.equal(Model.expandHome("/abs", HOME), "/abs")
  assert.equal(Model.collapseHome("/home/dev/Projects/x", HOME), "~/Projects/x")
  assert.equal(Model.collapseHome("/opt/x", HOME), "/opt/x")
})

test("isSafeArg refuses option-looking and control-character arguments", () => {
  assert.equal(Model.isSafeArg("backend-api"), true)
  assert.equal(Model.isSafeArg("/home/dev/x y"), true)
  assert.equal(Model.isSafeArg("-rf"), false)
  assert.equal(Model.isSafeArg("--dir=/"), false)
  assert.equal(Model.isSafeArg("a\nb"), false)
  assert.equal(Model.isSafeArg(""), false)
  assert.equal(Model.isSafeArg(null), false)
})

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

test("parsePorcelain counts modified, staged, untracked, conflicts and ahead/behind", () => {
  const s = Model.parsePorcelain(`# branch.head main
# branch.upstream origin/main
# branch.ab +3 -1
1 .M N... 100644 100644 100644 a b x
1 M. N... 100644 100644 100644 a b y
1 MM N... 100644 100644 100644 a b z
2 R. N... 100644 100644 100644 a b R100 new\told
u UU N... 100644 100644 100644 100644 a b c d w
? u1
? u2
`)
  assert.equal(s.branch, "main")
  assert.equal(s.upstream, "origin/main")
  assert.equal(s.ahead, 3)
  assert.equal(s.behind, 1)
  assert.equal(s.modified, 2)
  assert.equal(s.staged, 3)
  assert.equal(s.untracked, 2)
  assert.equal(s.conflicts, 1)
})

test("parsePorcelain handles detached HEAD and missing upstream", () => {
  const s = Model.parsePorcelain("# branch.oid abc\n# branch.head (detached)\n")
  assert.equal(s.branch, "(detached)")
  assert.equal(s.upstream, "")
  assert.equal(s.ahead, 0)
  assert.equal(s.behind, 0)
})

test("parseRepoScan yields one repo per block including errored ones", () => {
  assert.equal(repos.length, 5)
  const api = repos.find(r => r.name === "backend-api")
  assert.equal(api.path, "/home/dev/Projects/backend-api")
  assert.equal(api.branch, "feature/auth")
  assert.equal(api.modified, 3)
  assert.equal(api.staged, 2)
  assert.equal(api.untracked, 2)
  assert.equal(api.ahead, 2)
  assert.equal(api.remoteUrl, "git@github.com:acme/backend-api.git")
  assert.equal(api.remoteWebUrl, "https://github.com/acme/backend-api")
  const broken = repos.find(r => r.name === "broken")
  assert.equal(broken.error, "fatal: not a git repository")
  assert.equal(Model.repoState(broken), "error")
})

test("parseRepoScan returns null for unreadable output and [] for none", () => {
  assert.equal(Model.parseRepoScan(null), null)
  assert.deepEqual(Model.parseRepoScan(""), [])
  assert.deepEqual(Model.parseRepoScan("===repo===\n/x\n"), [])
})

test("repoState ranks conflict over dirty over behind over ahead over clean", () => {
  const byName = Object.fromEntries(repos.map(r => [r.name, r]))
  assert.equal(Model.repoState(byName["conflicted"]), "conflict")
  assert.equal(Model.repoState(byName["backend-api"]), "dirty")
  assert.equal(Model.repoState(byName["frontend"]), "behind")
  assert.equal(Model.repoState(byName["clean-lib"]), "clean")
  assert.equal(Model.repoState({ ahead: 2, behind: 0, modified: 0, staged: 0, untracked: 0, conflicts: 0 }), "ahead")
})

test("repoIcon and repoSummary follow the PRD status language", () => {
  const byName = Object.fromEntries(repos.map(r => [r.name, r]))
  assert.equal(Model.repoIcon(byName["conflicted"]), "✕")
  assert.equal(Model.repoIcon(byName["backend-api"]), "⚠")
  assert.equal(Model.repoIcon(byName["frontend"]), "⚠")
  assert.equal(Model.repoIcon(byName["clean-lib"]), "●")
  assert.equal(Model.repoSummary(byName["clean-lib"]), "clean")
  assert.equal(Model.repoSummary(byName["conflicted"]), "merge conflict")
  assert.equal(Model.repoSummary(byName["frontend"]), "↓4")
  assert.equal(Model.repoSummary(byName["backend-api"]), "3 modified · 2 staged · 2 untracked · ↑2")
  assert.equal(Model.repoSummary(byName["broken"]), "unreadable")
})

test("remoteWebUrl converts ssh and scp-like remotes and strips .git", () => {
  assert.equal(Model.remoteWebUrl("git@github.com:a/b.git"), "https://github.com/a/b")
  assert.equal(Model.remoteWebUrl("ssh://git@gitlab.com:2222/a/b.git"), "https://gitlab.com/a/b")
  assert.equal(Model.remoteWebUrl("https://github.com/a/b"), "https://github.com/a/b")
  assert.equal(Model.remoteWebUrl("https://user:token@github.com/a/b.git"), "https://github.com/a/b")
  assert.equal(Model.remoteWebUrl(""), "")
  assert.equal(Model.remoteWebUrl("/local/path"), "")
})

test("sortRepos puts repositories needing attention first, then by name", () => {
  const names = Model.sortRepos(repos).map(r => r.name)
  assert.deepEqual(names, ["conflicted", "backend-api", "frontend", "broken", "clean-lib"])
})

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

test("parseDockerPs reads json lines, skips malformed ones", () => {
  assert.equal(docker.available, true)
  assert.equal(docker.containers.length, 5)
  const pg = docker.containers.find(c => c.name === "backend-api-postgres-1")
  assert.equal(pg.id, "a1b2c3d4e5f6")
  assert.equal(pg.image, "postgres:17")
  assert.equal(pg.state, "running")
  assert.equal(pg.health, "healthy")
  assert.equal(pg.compose, "backend-api")
  assert.equal(pg.composeService, "postgres")
  assert.deepEqual(pg.ports, [{ host: 5432, container: 5432, proto: "tcp" }])
  assert.equal(pg.uptime, "2 hours")
})

test("parseDockerPs reports unavailable docker distinctly from zero containers", () => {
  const off = Model.parseDockerPs("===docker-unavailable===\nCannot connect to the Docker daemon")
  assert.equal(off.available, false)
  assert.equal(off.reason, "Cannot connect to the Docker daemon")
  assert.deepEqual(off.containers, [])
  const none = Model.parseDockerPs("")
  assert.equal(none.available, true)
  assert.deepEqual(none.containers, [])
  assert.equal(Model.parseDockerPs(null), null)
})

test("parseHealth and parseExitCode read docker status strings", () => {
  assert.equal(Model.parseHealth("Up 2 hours (healthy)"), "healthy")
  assert.equal(Model.parseHealth("Up 2 hours (unhealthy)"), "unhealthy")
  assert.equal(Model.parseHealth("Up 3 seconds (health: starting)"), "starting")
  assert.equal(Model.parseHealth("Up 3 seconds"), "")
  assert.equal(Model.parseExitCode("Exited (1) 3 minutes ago"), 1)
  assert.equal(Model.parseExitCode("Exited (137) 3 minutes ago"), 137)
  assert.equal(Model.parseExitCode("Up 2 hours"), null)
})

test("parsePortMappings dedupes ipv4/ipv6 and ignores unpublished ports", () => {
  assert.deepEqual(Model.parsePortMappings("0.0.0.0:5432->5432/tcp, :::5432->5432/tcp"), [{ host: 5432, container: 5432, proto: "tcp" }])
  assert.deepEqual(Model.parsePortMappings("3306/tcp"), [])
  assert.deepEqual(Model.parsePortMappings("127.0.0.1:8081->80/tcp, 0.0.0.0:9000-9001->9000-9001/udp"), [
    { host: 8081, container: 80, proto: "tcp" }, { host: 9000, container: 9000, proto: "udp" }
  ])
  assert.deepEqual(Model.parsePortMappings(""), [])
})

test("containerIcon and containerSummary distinguish unhealthy and crashed containers", () => {
  const by = Object.fromEntries(docker.containers.map(c => [c.name, c]))
  assert.equal(Model.containerIcon(by["backend-api-postgres-1"]), "●")
  assert.equal(Model.containerIcon(by["backend-api-redis-1"]), "⚠")
  assert.equal(Model.containerIcon(by["integration-tests"]), "✕")
  assert.equal(Model.containerIcon(by["grafana"]), "○")
  assert.equal(Model.containerSummary(by["backend-api-postgres-1"]), "running · healthy · 2 hours")
  assert.equal(Model.containerSummary(by["backend-api-redis-1"]), "running · unhealthy · 2 hours")
  assert.equal(Model.containerSummary(by["integration-tests"]), "exited (1)")
  assert.equal(Model.containerSummary(by["grafana"]), "exited")
  assert.equal(Model.containerSummary(by["starting-db"]), "running · starting · 3 seconds")
})

test("groupContainers groups by compose project with Other last", () => {
  const groups = Model.groupContainers(docker.containers)
  assert.deepEqual(groups.map(g => g.name), ["backend-api", "monitoring", "Other"])
  assert.deepEqual(groups[0].items.map(c => c.name), ["backend-api-postgres-1", "backend-api-redis-1"])
  assert.deepEqual(groups[2].items.map(c => c.name), ["integration-tests", "starting-db"])
})

test("sortContainers puts problems first, then running, then stopped", () => {
  assert.deepEqual(Model.sortContainers(docker.containers).map(c => c.name),
    ["integration-tests", "backend-api-redis-1", "backend-api-postgres-1", "starting-db", "grafana"])
})

// ---------------------------------------------------------------------------
// Services / ports
// ---------------------------------------------------------------------------

test("parseSsLine reads address, port and owning process", () => {
  const l = Model.parseSsLine('LISTEN 0      4096                     127.0.0.1:3000  0.0.0.0:* users:(("node",pid=18342,fd=20),("node",pid=18342,fd=21))')
  assert.deepEqual(l, { address: "127.0.0.1", port: 3000, process: "node", pid: 18342 })
  assert.deepEqual(Model.parseSsLine("LISTEN 0      4096                          [::]:8080  [::]:*    users:((\"python\",pid=12491,fd=5))"),
    { address: "::", port: 8080, process: "python", pid: 12491 })
  assert.deepEqual(Model.parseSsLine("LISTEN 0      4096                 127.0.0.53%lo:53    0.0.0.0:*"),
    { address: "127.0.0.53", port: 53, process: "", pid: 0 })
  assert.deepEqual(Model.parseSsLine("LISTEN 0 4096 *:3000 *:*"), { address: "*", port: 3000, process: "", pid: 0 })
  assert.equal(Model.parseSsLine("garbage"), null)
})

test("parsePorts dedupes a port listening on several addresses and attaches cwd/cmdline", () => {
  assert.equal(Model.parsePorts(null), null)
  const ports = rawServices.map(s => s.port)
  assert.deepEqual(ports, [53, 3000, 22, 5432, 8080, 5173, 7437])
  const s3000 = rawServices.find(s => s.port === 3000)
  assert.equal(s3000.pid, 18342)
  assert.equal(s3000.cwd, "/home/dev/Projects/frontend")
  assert.match(s3000.cmdline, /next dev/)
  assert.equal(s3000.local, false)
  assert.equal(rawServices.find(s => s.port === 5173).local, true)
})

test("parseProcLines tolerates missing or malformed rows", () => {
  const procs = Model.parseProcLines("1\t/x\tcmd\nbad line\n\n2\t\t\n")
  assert.deepEqual(procs, { 1: { cwd: "/x", cmdline: "cmd" }, 2: { cwd: "", cmdline: "" } })
})

test("enrichServices links docker ports, projects and detects technology", () => {
  const by = Object.fromEntries(services.map(s => [s.port, s]))
  assert.equal(by[5432].source, "docker")
  assert.equal(by[5432].container, "backend-api-postgres-1")
  assert.equal(by[5432].technology, "PostgreSQL")
  assert.equal(by[3000].technology, "Next.js")
  assert.equal(by[3000].project, "frontend")
  assert.equal(by[3000].projectPath, "/home/dev/Projects/frontend")
  assert.equal(by[5173].technology, "Vite")
  assert.equal(by[8080].technology, "Uvicorn")
  assert.equal(by[8080].project, "")
  assert.equal(by[8080].cwd, "/home/dev/Projects/old-api")
  assert.equal(by[7437].technology, "")
})

test("detectTechnology is best effort and never claims certainty on bare ports", () => {
  assert.equal(Model.detectTechnology({ process: "postgres", cmdline: "", port: 1 }), "PostgreSQL")
  assert.equal(Model.detectTechnology({ process: "redis-server", cmdline: "", port: 1 }), "Redis")
  assert.equal(Model.detectTechnology({ process: "node", cmdline: "node x/.bin/next dev", port: 1 }), "Next.js")
  assert.equal(Model.detectTechnology({ process: "node", cmdline: "node server.js", port: 1 }), "Node.js")
  assert.equal(Model.detectTechnology({ process: "bun", cmdline: "bun run dev", port: 1 }), "Bun")
  assert.equal(Model.detectTechnology({ process: "python3", cmdline: "python3 manage.py runserver", port: 1 }), "Django")
  assert.equal(Model.detectTechnology({ process: "python3", cmdline: "flask run", port: 1 }), "Flask")
  assert.equal(Model.detectTechnology({ process: "java", cmdline: "java -jar app.jar", port: 1 }), "Java")
  assert.equal(Model.detectTechnology({ process: "dotnet", cmdline: "dotnet run", port: 1 }), ".NET")
  assert.equal(Model.detectTechnology({ process: "", cmdline: "", port: 5432 }), "PostgreSQL?")
  assert.equal(Model.detectTechnology({ process: "", cmdline: "", port: 6379 }), "Redis?")
  assert.equal(Model.detectTechnology({ process: "", cmdline: "", port: 9999 }), "")
  assert.equal(Model.detectTechnology({ process: "", cmdline: "", port: 1, container: "x", image: "mongo:7" }), "MongoDB")
})

test("isUnidentifiedPort hides listeners nothing can be said about", () => {
  // No visible owner and no conventional meaning: only a number.
  assert.equal(Model.isUnidentifiedPort({ port: 53, process: "", pid: 0, source: "process" }), true)
  assert.equal(Model.isUnidentifiedPort({ port: 22, process: "", pid: 0, source: "process" }), true)
  assert.equal(Model.isUnidentifiedPort({ port: 631, process: "", pid: 0, source: "process" }), true)
  assert.equal(Model.isUnidentifiedPort({ port: 47660, process: "", pid: 0, source: "process" }), true)
  // Owned by the user, published by a container, or a port that speaks for
  // itself — all worth showing.
  assert.equal(Model.isUnidentifiedPort({ port: 3000, process: "node", pid: 1, source: "process" }), false)
  assert.equal(Model.isUnidentifiedPort({ port: 80, process: "", pid: 0, source: "docker" }), false)
  assert.equal(Model.isUnidentifiedPort({ port: 5432, process: "", pid: 0, source: "process" }), false)
})

test("serviceIcon and serviceSummary describe services", () => {
  const by = Object.fromEntries(services.map(s => [s.port, s]))
  assert.equal(Model.serviceIcon(by[3000]), "●")
  assert.equal(Model.serviceSummary(by[3000]), "Next.js · ~/Projects/frontend")
  assert.equal(Model.serviceSummary(by[5432]), "PostgreSQL · Docker")
  assert.equal(Model.serviceSummary(by[7437]), "engram")
  assert.equal(Model.serviceSummary({ port: 1, process: "", pid: 0, technology: "", cwd: "", source: "process" }), "unknown process")
})

test("sortServices orders by port and hides system ports", () => {
  const ports = Model.sortServices(services).map(s => s.port)
  assert.deepEqual(ports, [3000, 5173, 5432, 7437, 8080])
})

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

test("parseSshConfig reads concrete hosts, skips patterns and Match blocks", () => {
  const hosts = Model.parseSshConfig(sshConfig)
  assert.deepEqual(hosts.map(h => h.alias), ["dev-server", "homelab", "build-server"])
  assert.equal(hosts[0].hostname, "192.168.1.40")
  assert.equal(hosts[0].user, "deploy")
  assert.equal(hosts[0].port, 2222)
  assert.equal(hosts[1].hostname, "homelab.local")
  assert.equal(hosts[1].port, 22)
  assert.equal(hosts[1].user, "")
  assert.equal("identityFile" in hosts[0], false)
})

test("parseSshConfig returns null when unreadable and [] when empty", () => {
  assert.equal(Model.parseSshConfig(null), null)
  assert.deepEqual(Model.parseSshConfig(""), [])
  assert.deepEqual(Model.parseSshConfig("Host *\n  User x\n"), [])
})

test("parseProbe and applyProbe attach availability and latency", () => {
  const by = Object.fromEntries(machines.map(m => [m.alias, m]))
  assert.equal(by["dev-server"].status, "up")
  assert.equal(by["dev-server"].latency, 18)
  assert.equal(by["build-server"].status, "down")
  const unprobed = Model.parseSshConfig(sshConfig)[0]
  assert.equal(unprobed.status, "unknown")
  assert.deepEqual(Model.parseProbe("garbage\n\n"), {})
})

test("machineIcon and machineSummary", () => {
  const by = Object.fromEntries(machines.map(m => [m.alias, m]))
  assert.equal(Model.machineIcon(by["dev-server"]), "●")
  assert.equal(Model.machineIcon(by["build-server"]), "○")
  assert.equal(Model.machineIcon({ status: "unknown" }), "○")
  assert.equal(Model.machineSummary(by["dev-server"]), "deploy@192.168.1.40:2222 · 18 ms")
  assert.equal(Model.machineSummary(by["homelab"]), "homelab.local · 31 ms")
  assert.equal(Model.machineSummary(by["build-server"]), "homelab.local · unreachable")
  assert.equal(Model.machineSummary({ alias: "x", hostname: "x", user: "", port: 22, status: "unknown" }), "x")
})

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

test("parseTools marks installed tools and keeps catalog categories", () => {
  assert.equal(Model.parseTools(null), null)
  const by = Object.fromEntries(tools.map(t => [t.name, t]))
  assert.equal(by.lazygit.installed, true)
  assert.equal(by.lazygit.path, "/usr/bin/lazygit")
  assert.equal(by.lazygit.category, "Git")
  assert.equal(by.k9s.installed, false)
  assert.equal(by.nvim.category, "Editors")
})

test("toolCategories lists installed tools grouped in catalog order", () => {
  const cats = Model.toolCategories(tools, true)
  assert.deepEqual(cats.map(c => c.name), ["Git", "Containers", "System", "Editors", "CLI"])
  assert.deepEqual(cats.find(c => c.name === "System").items.map(t => t.name), ["btop"])
  const all = Model.toolCategories(tools, false)
  assert.ok(all.find(c => c.name === "Kubernetes").items.some(t => t.name === "k9s"))
})

test("isLaunchable is true only for TUI/GUI tools", () => {
  assert.equal(Model.isLaunchable(tools.find(t => t.name === "lazygit")), true)
  assert.equal(Model.isLaunchable(tools.find(t => t.name === "jq")), false)
  assert.equal(Model.isLaunchable(tools.find(t => t.name === "k9s")), false)
})

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

test("computeAttention consolidates git, docker and machine problems, errors first", () => {
  const items = Model.computeAttention(data(), Model.normalizeConfig({ attention: { machineUnreachable: true } }, HOME))
  const titles = items.map(i => `${i.severity}:${i.kind}:${i.title}`)
  assert.deepEqual(titles, [
    "error:project:conflicted",
    "error:container:integration-tests",
    "warning:project:backend-api",
    "warning:project:frontend",
    "warning:container:backend-api-redis-1",
    "warning:machine:build-server"
  ])
  assert.equal(items[0].detail, "merge conflict")
  assert.equal(items[1].detail, "container exited unexpectedly (1)")
  assert.equal(items[2].detail, "3 modified files")
  assert.equal(items[3].detail, "4 commits behind origin/develop")
  assert.equal(items[4].detail, "container unhealthy")
  assert.equal(items[5].detail, "unreachable")
})

test("computeAttention honours disabled rules and thresholds", () => {
  const c = Model.normalizeConfig({ attention: { gitDirty: false, gitBehind: false, dockerUnhealthy: false, dockerExited: false } }, HOME)
  const items = Model.computeAttention(data(), c)
  assert.deepEqual(items.map(i => i.title), ["conflicted"])
  const c2 = Model.normalizeConfig({ attention: { behindThreshold: 10 } }, HOME)
  assert.equal(Model.computeAttention(data(), c2).some(i => i.title === "frontend"), false)
})

test("computeAttention reports unpushed commits when enabled", () => {
  const d = data()
  d.repos = [{ name: "lib", path: "/x", branch: "main", upstream: "origin/main", ahead: 2, behind: 0, modified: 0, staged: 0, untracked: 0, conflicts: 0, error: "" }]
  d.docker = { available: true, containers: [] }
  const items = Model.computeAttention(d, config)
  assert.equal(items.length, 1)
  assert.equal(items[0].detail, "2 commits not pushed")
  assert.equal(items[0].severity, "warning")
})

test("computeAttention flags configured port collisions", () => {
  const c = Model.normalizeConfig({ expectedPorts: { "8080": "backend-api" } }, HOME)
  const items = Model.computeAttention(data(), c)
  const hit = items.find(i => i.kind === "service")
  assert.ok(hit)
  assert.equal(hit.title, "Port 8080")
  assert.equal(hit.detail, "expected backend-api, used by python (PID 12491)")
})

test("computeAttention ignores unavailable docker and unprobed machines", () => {
  const d = data()
  d.docker = { available: false, reason: "x", containers: [] }
  d.machines = Model.parseSshConfig(sshConfig)
  const items = Model.computeAttention(d, Model.normalizeConfig({ attention: { machineUnreachable: true } }, HOME))
  assert.equal(items.some(i => i.kind === "container"), false)
  assert.equal(items.some(i => i.kind === "machine"), false)
})

test("attentionSummary and barState map to bar glyphs", () => {
  const items = Model.computeAttention(data(), config)
  assert.deepEqual(Model.attentionSummary(items), { errors: 2, warnings: 3 })
  // active = running containers (3) + local non-docker services (3000, 5173, 8080, 7437)
  assert.deepEqual(Model.barState(items, data()), { glyph: "✕", count: 2, active: 7, severity: "error" })
  assert.deepEqual(Model.barState([], data()), { glyph: "●", count: 0, active: 7, severity: "healthy" })
  const warn = items.filter(i => i.severity === "warning")
  assert.deepEqual(Model.barState(warn, data()), { glyph: "⚠", count: 3, active: 7, severity: "warning" })
})

test("barText renders full, rich and compact formats", () => {
  const s = { glyph: "⚠", count: 2, active: 5, severity: "warning" }
  assert.equal(Model.barText(s, { barLabel: "DEV", barFormat: "full" }, false), "DEV ⚠ 2")
  assert.equal(Model.barText({ glyph: "●", count: 0, active: 5, severity: "healthy" }, { barLabel: "DEV", barFormat: "full" }, false), "DEV ●")
  assert.equal(Model.barText(s, { barLabel: "DEV", barFormat: "rich" }, false), "DEV 5 ● 2 ⚠")
  assert.equal(Model.barText(s, { barLabel: "DEV", barFormat: "compact" }, false), "⚠ 2")
  assert.equal(Model.barText(s, { barLabel: "DEV", barFormat: "full" }, true), "⚠\n2")
  assert.equal(Model.barText({ glyph: "●", count: 0, active: 5, severity: "healthy" }, { barLabel: "DEV", barFormat: "full" }, true), "●")
})

// ---------------------------------------------------------------------------
// Navigation reducer
// ---------------------------------------------------------------------------

test("initialUi starts on the overview with nothing selected yet", () => {
  const ui = Model.initialUi()
  assert.equal(ui.view, "overview")
  assert.equal(ui.index, 0)
  assert.equal(ui.query, "")
  assert.equal(ui.detail, null)
})

test("overview rows show a capped number of important items per section", () => {
  const rows = Model.rowsFor(Model.initialUi(), data(), config)
  const headers = rows.filter(r => r.type === "header").map(r => r.label.replace(/ \(\d+\)$/, ""))
  assert.deepEqual(headers, ["Attention", "Projects", "Containers", "Services", "Machines"])
  const projects = rows.filter(r => r.type === "item" && r.kind === "project").map(r => r.title)
  assert.deepEqual(projects, ["conflicted", "backend-api", "frontend", "broken", "clean-lib"])
  assert.ok(rows.filter(r => r.type === "item" && r.kind === "attention").length === 5)
})

test("rowsFor explains empty and unloaded sections instead of hiding them", () => {
  const d = data()
  d.repos = []
  d.docker = { available: false, reason: "no docker", containers: [] }
  d.machines = []
  d.loaded.services = false
  d.services = null
  const rows = Model.rowsFor({ ...Model.initialUi(), view: "projects" }, d, config)
  assert.ok(rows.some(r => r.type === "empty" && /No projects found/.test(r.label)))
  const crows = Model.rowsFor({ ...Model.initialUi(), view: "containers" }, d, config)
  assert.ok(crows.some(r => r.type === "empty" && /Docker not detected/.test(r.label)))
  const srows = Model.rowsFor({ ...Model.initialUi(), view: "services" }, d, config)
  assert.ok(srows.some(r => r.type === "empty" && /Scanning/.test(r.label)))
  const mrows = Model.rowsFor({ ...Model.initialUi(), view: "machines" }, d, config)
  assert.ok(mrows.some(r => r.type === "empty" && /No SSH hosts found/.test(r.label)))
})

test("selectableIndexes and moveSelection skip headers and wrap", () => {
  const rows = [{ type: "header" }, { type: "item" }, { type: "item" }, { type: "header" }, { type: "item" }]
  assert.deepEqual(Model.selectableIndexes(rows), [1, 2, 4])
  let ui = { ...Model.initialUi(), index: 1 }
  ui = Model.moveSelection(ui, rows, 1); assert.equal(ui.index, 2)
  ui = Model.moveSelection(ui, rows, 1); assert.equal(ui.index, 4)
  ui = Model.moveSelection(ui, rows, 1); assert.equal(ui.index, 1)
  ui = Model.moveSelection(ui, rows, -1); assert.equal(ui.index, 4)
  assert.equal(Model.moveSelection({ ...Model.initialUi(), index: 0 }, rows, 0).index, 1)
  assert.equal(Model.moveSelection(Model.initialUi(), [], 1).index, 0)
})

test("jumpSection switches views on single keys and ignores them while searching", () => {
  assert.equal(Model.sectionForKey("p"), "projects")
  assert.equal(Model.sectionForKey("C"), "containers")
  assert.equal(Model.sectionForKey("s"), "services")
  assert.equal(Model.sectionForKey("m"), "machines")
  assert.equal(Model.sectionForKey("a"), "attention")
  assert.equal(Model.sectionForKey("t"), "tools")
  assert.equal(Model.sectionForKey("o"), "overview")
  assert.equal(Model.sectionForKey("x"), "")
  const ui = Model.jumpSection({ ...Model.initialUi(), index: 7, detail: { kind: "project" } }, "p")
  assert.equal(ui.view, "projects")
  assert.equal(ui.index, 0)
  assert.equal(ui.detail, null)
  const searching = Model.jumpSection({ ...Model.initialUi(), searching: true, query: "x" }, "p")
  assert.equal(searching.view, "overview")
})

test("activate on an item opens its detail; on an action returns a command effect", () => {
  const d = data()
  const listUi = { ...Model.initialUi(), view: "projects" }
  const rows = Model.rowsFor(listUi, d, config)
  const first = Model.selectableIndexes(rows)[0]
  const r1 = Model.activate({ ...listUi, index: first }, rows, d, config, { home: HOME })
  assert.equal(r1.ui.detail.kind, "project")
  assert.equal(r1.ui.detail.id, "/home/dev/Projects/conflicted")
  assert.equal(r1.effect, null)
  const drows = Model.rowsFor(r1.ui, d, config)
  const actionIdx = drows.findIndex(r => r.type === "action" && r.action.id === "terminal")
  assert.ok(actionIdx > 0)
  const r2 = Model.activate({ ...r1.ui, index: actionIdx }, drows, d, config, { home: HOME })
  assert.equal(r2.effect.type, "run")
  assert.deepEqual(r2.effect.command, ["setsid", "uwsm-app", "--", "xdg-terminal-exec", "--dir=/home/dev/Projects/conflicted"])
})

test("activate on a destructive action asks for confirmation first, then runs", () => {
  const d = data()
  const ui = { ...Model.initialUi(), view: "containers", detail: { kind: "container", id: "b2c3d4e5f6a1" } }
  const rows = Model.rowsFor(ui, d, config)
  const idx = rows.findIndex(r => r.type === "action" && r.action.id === "stop")
  const r = Model.activate({ ...ui, index: idx }, rows, d, config, { home: HOME })
  assert.equal(r.effect, null)
  assert.equal(r.ui.confirm.action.id, "stop")
  const r2 = Model.activate(r.ui, rows, d, config, { home: HOME })
  assert.deepEqual(r2.effect, { type: "run", command: ["docker", "stop", "b2c3d4e5f6a1"], cwd: "", refresh: "docker" })
  assert.equal(r2.ui.confirm, null)
})

test("back closes confirm, then detail, then search, then the panel", () => {
  let ui = { ...Model.initialUi(), view: "projects", detail: { kind: "project", id: "/x" }, confirm: { action: { id: "x" } } }
  let r = Model.back(ui); assert.equal(r.ui.confirm, null); assert.equal(r.effect, null)
  r = Model.back(r.ui); assert.equal(r.ui.detail, null); assert.equal(r.effect, null)
  r = Model.back({ ...r.ui, searching: true, query: "abc" }); assert.equal(r.ui.searching, false); assert.equal(r.ui.query, ""); assert.equal(r.effect, null)
  r = Model.back(r.ui); assert.equal(r.ui.view, "overview"); assert.equal(r.effect, null)
  r = Model.back(r.ui); assert.deepEqual(r.effect, { type: "close" })
})

test("typeSearch enters search mode and resets the selection", () => {
  const ui = Model.typeSearch({ ...Model.initialUi(), index: 4, detail: { kind: "project", id: "x" } }, "ba")
  assert.equal(ui.searching, true)
  assert.equal(ui.query, "ba")
  assert.equal(ui.index, 0)
  assert.equal(ui.detail, null)
  const cleared = Model.clearSearch(ui)
  assert.equal(cleared.searching, false)
  assert.equal(cleared.query, "")
})

test("detailRows for a project include git facts and every project action", () => {
  const d = data()
  const ui = { ...Model.initialUi(), view: "projects", detail: { kind: "project", id: "/home/dev/Projects/backend-api" } }
  const rows = Model.rowsFor(ui, d, config)
  const info = Object.fromEntries(rows.filter(r => r.type === "info").map(r => [r.label, r.value]))
  assert.equal(info.Branch, "feature/auth")
  assert.equal(info.Modified, "3")
  assert.equal(info.Staged, "2")
  assert.equal(info.Untracked, "2")
  assert.equal(info.Upstream, "origin/feature/auth")
  assert.equal(info.Ahead, "2")
  assert.equal(info.Behind, "0")
  const actions = rows.filter(r => r.type === "action").map(r => r.action.id)
  assert.deepEqual(actions, ["terminal", "editor", "gitui", "copy-path", "remote", "refresh"])
})

test("detailRows for a vanished item falls back to an explanation", () => {
  const ui = { ...Model.initialUi(), view: "containers", detail: { kind: "container", id: "gone" } }
  const rows = Model.rowsFor(ui, data(), config)
  assert.ok(rows.some(r => r.type === "empty" && /no longer/.test(r.label)))
})

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test("scoreMatch prefers prefix over word start over substring", () => {
  assert.ok(Model.scoreMatch("back", "backend-api") > Model.scoreMatch("back", "my-backend"))
  assert.ok(Model.scoreMatch("api", "backend-api") > Model.scoreMatch("api", "rapid"))
  assert.equal(Model.scoreMatch("zzz", "backend"), 0)
  assert.equal(Model.scoreMatch("", "backend"), 0)
})

test("searchResults spans projects, containers, services, machines, tools and actions", () => {
  const rows = Model.searchResults("back", data(), config)
  const kinds = rows.map(r => `${r.kind}:${r.title}`)
  assert.ok(kinds.includes("project:backend-api"))
  assert.ok(kinds.includes("container:backend-api-postgres-1"))
  assert.ok(kinds.includes("action:Open backend-api in lazygit"))
  assert.ok(kinds.includes("action:Open backend-api terminal"))
  assert.equal(kinds[0], "project:backend-api")
  assert.ok(rows.every(r => r.type === "item"))
})

test("searchResults finds ports by number and tools by name", () => {
  const rows = Model.searchResults("8080", data(), config)
  assert.equal(rows[0].kind, "service")
  assert.equal(rows[0].title, ":8080")
  const t = Model.searchResults("lazyd", data(), config)
  assert.equal(t[0].kind, "tool")
  assert.equal(t[0].title, "lazydocker")
  assert.deepEqual(Model.searchResults("", data(), config), [])
  assert.deepEqual(Model.searchResults("qqqqqq", data(), config), [])
})

test("search rows activate like list rows: items open detail, actions run", () => {
  const d = data()
  const ui = Model.typeSearch(Model.initialUi(), "lazyd")
  const rows = Model.rowsFor(ui, d, config)
  const r = Model.activate({ ...ui, index: 0 }, rows, d, config, { home: HOME })
  assert.equal(r.ui.detail.kind, "tool")
  const ui2 = Model.typeSearch(Model.initialUi(), "backend-api terminal")
  const rows2 = Model.rowsFor(ui2, d, config)
  const idx = rows2.findIndex(r => r.kind === "action" && /terminal/.test(r.title))
  const r2 = Model.activate({ ...ui2, index: idx }, rows2, d, config, { home: HOME })
  assert.equal(r2.effect.type, "run")
})

// ---------------------------------------------------------------------------
// Actions / commands
// ---------------------------------------------------------------------------

test("terminalCommand uses xdg-terminal-exec by default and a configured terminal otherwise", () => {
  assert.deepEqual(Model.terminalCommand("/p", ""), { command: ["setsid", "uwsm-app", "--", "xdg-terminal-exec", "--dir=/p"], cwd: "" })
  assert.deepEqual(Model.terminalCommand("/p", "kitty"), { command: ["setsid", "uwsm-app", "--", "kitty"], cwd: "/p" })
})

test("tuiCommand opens a command inside a terminal with an app id", () => {
  assert.deepEqual(Model.tuiCommand(["lazygit"], "/p", { hold: false }),
    ["setsid", "uwsm-app", "--", "xdg-terminal-exec", "--app-id=org.omarchy.lazygit", "--dir=/p", "-e", "lazygit"])
  assert.deepEqual(Model.tuiCommand(["ping", "-c", "4", "host"], "", { hold: true }),
    ["setsid", "uwsm-app", "--", "xdg-terminal-exec", "--app-id=org.omarchy.ping", "--hold", "-e", "ping", "-c", "4", "host"])
})

test("resolveEditor and editorCommand handle terminal and gui editors", () => {
  assert.equal(Model.resolveEditor("", "zed\n"), "zed")
  assert.equal(Model.resolveEditor("", ""), "nvim")
  assert.equal(Model.resolveEditor("code", "zed"), "code")
  assert.deepEqual(Model.editorCommand("nvim", "/p"), Model.tuiCommand(["nvim", "."], "/p", {}))
  assert.deepEqual(Model.editorCommand("zed", "/p"), ["setsid", "uwsm-app", "--", "zed", "/p"])
})

test("actionsFor project lists the PRD actions with safe argv commands", () => {
  const repo = repos.find(r => r.name === "backend-api")
  const actions = Model.actionsFor({ kind: "project", ref: repo }, config, { home: HOME, defaultEditor: "" })
  const by = Object.fromEntries(actions.map(a => [a.id, a]))
  assert.deepEqual(by.gitui.command, Model.tuiCommand(["lazygit"], repo.path, {}))
  assert.deepEqual(by.remote.command, ["omarchy-launch-browser", "https://github.com/acme/backend-api"])
  assert.deepEqual(by["copy-path"].copy, repo.path)
  assert.equal(by.refresh.refresh, "repos")
  assert.equal(by.editor.label, "Open editor (nvim)")
  const noRemote = Model.actionsFor({ kind: "project", ref: repos.find(r => r.name === "clean-lib") }, config, { home: HOME })
  assert.equal(noRemote.some(a => a.id === "remote"), false)
})

test("actionsFor container offers logs/shell/start|stop/restart/copy/lazydocker", () => {
  const running = docker.containers.find(c => c.name === "backend-api-postgres-1")
  const stopped = docker.containers.find(c => c.name === "grafana")
  const ra = Model.actionsFor({ kind: "container", ref: running }, config, { home: HOME })
  assert.deepEqual(ra.map(a => a.id), ["logs", "shell", "restart", "stop", "copy-id", "lazydocker"])
  assert.equal(ra.find(a => a.id === "stop").destructive, true)
  assert.equal(ra.find(a => a.id === "restart").destructive, true)
  assert.deepEqual(ra.find(a => a.id === "logs").command, Model.tuiCommand(["docker", "logs", "-f", "--tail", "200", running.id], "", {}))
  assert.deepEqual(ra.find(a => a.id === "shell").command, Model.tuiCommand(["docker", "exec", "-it", running.id, "sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"], "", {}))
  const sa = Model.actionsFor({ kind: "container", ref: stopped }, config, { home: HOME })
  assert.deepEqual(sa.map(a => a.id), ["logs", "start", "copy-id", "lazydocker"])
  assert.deepEqual(sa.find(a => a.id === "start").command, ["docker", "start", stopped.id])
})

test("actionsFor container omits lazydocker when it is not installed", () => {
  const c = Model.normalizeConfig({ containerUi: "lazydocker" }, HOME)
  const a = Model.actionsFor({ kind: "container", ref: docker.containers[0] }, c, { home: HOME, tools: [{ name: "lazydocker", installed: false }] })
  assert.equal(a.some(x => x.id === "lazydocker"), false)
})

test("actionsFor service offers url, copy, project, terminal, inspect, stop", () => {
  const s = services.find(x => x.port === 3000)
  const a = Model.actionsFor({ kind: "service", ref: s }, config, { home: HOME })
  assert.deepEqual(a.map(x => x.id), ["open-url", "copy-url", "open-project", "terminal", "inspect", "stop-process"])
  assert.deepEqual(a[0].command, ["omarchy-launch-browser", "http://localhost:3000"])
  assert.equal(a[1].copy, "http://localhost:3000")
  assert.deepEqual(a[2].navigate, { kind: "project", id: "/home/dev/Projects/frontend" })
  assert.deepEqual(a[3].command, Model.terminalCommand("/home/dev/Projects/frontend", "").command)
  assert.deepEqual(a[4].command, Model.tuiCommand(["ps", "-o", "pid,ppid,user,%cpu,%mem,etime,args", "-p", "18342"], "", { hold: true }))
  assert.deepEqual(a[5].command, ["kill", "-TERM", "18342"])
  assert.equal(a[5].destructive, true)
  const dockerSvc = services.find(x => x.port === 5432)
  const da = Model.actionsFor({ kind: "service", ref: dockerSvc }, config, { home: HOME })
  assert.deepEqual(da.map(x => x.id), ["open-url", "copy-url", "open-container"])
})

test("actionsFor machine offers connect, terminal, ping, copies", () => {
  const m = machines.find(x => x.alias === "dev-server")
  const a = Model.actionsFor({ kind: "machine", ref: m }, config, { home: HOME })
  assert.deepEqual(a.map(x => x.id), ["connect", "terminal", "ping", "copy-hostname", "copy-address"])
  assert.deepEqual(a[0].command, Model.tuiCommand(["ssh", "dev-server"], "", {}))
  assert.deepEqual(a[2].command, Model.tuiCommand(["ping", "-c", "4", "192.168.1.40"], "", { hold: true }))
  assert.equal(a[3].copy, "192.168.1.40")
  assert.equal(a[4].copy, "deploy@192.168.1.40")
})

test("actionsFor refuses to build commands from unsafe identifiers", () => {
  const a = Model.actionsFor({ kind: "machine", ref: { alias: "-oProxyCommand=x", hostname: "h", user: "", port: 22, status: "unknown" } }, config, { home: HOME })
  assert.equal(a.some(x => x.id === "connect"), false)
})

test("actionsFor tool launches TUIs in a terminal and GUIs directly", () => {
  const lg = Model.actionsFor({ kind: "tool", ref: tools.find(t => t.name === "lazygit") }, config, { home: HOME })
  assert.deepEqual(lg[0].command, ["omarchy-launch-or-focus-tui", "lazygit"])
  const zed = Model.actionsFor({ kind: "tool", ref: { name: "zed", installed: true, category: "Editors", launch: "gui" } }, config, { home: HOME })
  assert.deepEqual(zed[0].command, ["setsid", "uwsm-app", "--", "zed"])
  assert.deepEqual(Model.actionsFor({ kind: "tool", ref: tools.find(t => t.name === "jq") }, config, { home: HOME }), [])
})

test("actionsFor attention items delegate to the underlying resource", () => {
  const items = Model.computeAttention(data(), config)
  const a = Model.actionsFor({ kind: "attention", ref: items[0] }, config, { home: HOME }, data())
  assert.ok(a.some(x => x.id === "gitui"))
})

test("heroMeta counts what was found and pluralises honestly", () => {
  assert.equal(Model.heroMeta(data()), "5 projects · 5 containers · 5 services")
  const one = data()
  one.repos = [repos[0]]
  one.docker = { available: true, reason: "", containers: [] }
  one.services = [services.find(s => s.port === 3000)]
  assert.equal(Model.heroMeta(one), "1 project · 0 containers · 1 service")
  const loading = data()
  loading.loaded = { repos: false, docker: false, services: false, machines: false, tools: false }
  loading.docker = { available: false, reason: "", containers: [] }
  assert.equal(Model.heroMeta(loading), "scanning projects · checking Docker · scanning ports")
  const noDocker = data()
  noDocker.docker = { available: false, reason: "docker is not installed", containers: [] }
  assert.match(Model.heroMeta(noDocker), /no Docker/)
})

test("emptyMessage and overviewSections expose copy for the panel", () => {
  assert.match(Model.emptyMessage("projects", { loaded: { repos: true }, repos: [] }, config), /~\/Projects/)
  assert.deepEqual(Model.overviewSections().map(s => s.view), ["attention", "projects", "containers", "services", "machines"])
})
