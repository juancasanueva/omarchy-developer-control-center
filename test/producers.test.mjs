import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const editorScript = fileURLToPath(new URL("../scripts/editor-path.sh", import.meta.url))
const sshScript = fileURLToPath(new URL("../scripts/ssh-config.sh", import.meta.url))
const sshSnapshotHelper = fileURLToPath(new URL("../scripts/ssh-source-snapshot.py", import.meta.url))
const pythonLookup = spawnSync("bash", ["-c", "command -v python3"], { encoding: "utf8" })
assert.equal(pythonLookup.status, 0)
const python3 = pythonLookup.stdout.trim()

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "developer-control-center-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function run(script, env, options = {}) {
  return spawnSync("bash", [script], {
    env: { ...process.env, ...env },
    encoding: null,
    timeout: options.timeout ?? 5000
  })
}

function runSnapshot(source, destination, cap, options = {}) {
  return spawnSync(python3, ["-I", sshSnapshotHelper, source, destination, String(cap)], {
    encoding: null,
    timeout: options.timeout ?? 5000
  })
}

function makeFifo(path) {
  const result = spawnSync(
    python3,
    ["-I", "-c", "import os, sys; os.mkfifo(sys.argv[1])", path],
    { encoding: null }
  )
  assert.equal(result.status, 0)
}

function makeUnixSocket(path) {
  const result = spawnSync(
    python3,
    ["-I", "-c", "import socket, sys; sock = socket.socket(socket.AF_UNIX); sock.bind(sys.argv[1]); sock.close()", path],
    { encoding: null }
  )
  assert.equal(result.status, 0)
}

function installPythonBarrier(bin) {
  mkdirSync(bin)
  writeFileSync(
    join(bin, "python3"),
    `#!/usr/bin/env bash
set -u
if [[ "\${3-}" == "$BARRIER_SOURCE" ]]; then
  printf 'ready\\n' > "$BARRIER_READY"
  IFS= read -r _ < "$BARRIER_RELEASE"
fi
exec "$REAL_PYTHON3" "$@"
`,
    { mode: 0o755 }
  )
}

function runSshReplacementBarrier(dir, source, action, replacementTarget = source) {
  const bin = join(dir, "barrier-bin")
  const ready = join(dir, "barrier-ready")
  const release = join(dir, "barrier-release")
  makeFifo(ready)
  makeFifo(release)
  installPythonBarrier(bin)

  return spawnSync(
    "bash",
    ["-c", `
bash "$SSH_SCRIPT" &
producer=$!
trap 'kill "$producer" 2>/dev/null || true' EXIT
IFS= read -r _ < "$BARRIER_READY"
rm -rf -- "$BARRIER_REPLACEMENT_TARGET"
if [[ "$BARRIER_ACTION" == fifo ]]; then
  mkfifo -- "$BARRIER_REPLACEMENT_TARGET"
elif [[ "$BARRIER_ACTION" == regular ]]; then
  printf 'replacement\\n' > "$BARRIER_REPLACEMENT_TARGET"
fi
printf 'continue\\n' > "$BARRIER_RELEASE"
wait "$producer"
status=$?
trap - EXIT
exit "$status"
`],
    {
      env: {
        ...process.env,
        HOME: dir,
        PATH: `${bin}:${process.env.PATH}`,
        REAL_PYTHON3: python3,
        SSH_SCRIPT: sshScript,
        BARRIER_SOURCE: source,
        BARRIER_REPLACEMENT_TARGET: replacementTarget,
        BARRIER_ACTION: action,
        BARRIER_READY: ready,
        BARRIER_RELEASE: release
      },
      encoding: null,
      timeout: 8000
    }
  )
}

function shellFunction(source, name) {
  const start = source.indexOf(`${name}() {`)
  assert.notEqual(start, -1, `${name} must exist`)
  const end = source.indexOf("\n}\n", start)
  assert.notEqual(end, -1, `${name} must have a complete body`)
  return source.slice(start, end + 2)
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === "ESRCH") return false
    throw error
  }
}

test("editor producer accepts exactly 4096 UTF-8 bytes", t => {
  const dir = workspace(t)
  const state = join(dir, "state")
  const defaults = join(state, "omarchy", "defaults")
  mkdirSync(defaults, { recursive: true })
  const content = Buffer.from("€".repeat(1365) + "x")
  assert.equal(content.length, 4096)
  writeFileSync(join(defaults, "editor"), content)

  const result = run(editorScript, { HOME: dir, XDG_STATE_HOME: state })
  assert.equal(result.status, 0)
  assert.deepEqual(result.stdout, content)
})

test("editor producer reports exact cap plus one overflow without partial output", t => {
  const dir = workspace(t)
  const state = join(dir, "state")
  const defaults = join(state, "omarchy", "defaults")
  mkdirSync(defaults, { recursive: true })
  const content = Buffer.from("€".repeat(1365) + "xy")
  assert.equal(content.length, 4097)
  writeFileSync(join(defaults, "editor"), content)

  const result = run(editorScript, { HOME: dir, XDG_STATE_HOME: state })
  assert.equal(result.status, 65)
  assert.equal(result.stdout.length, 0)
})

test("SSH source snapshot helper accepts the exact cap and rejects cap plus one atomically", t => {
  const dir = workspace(t)
  const source = join(dir, "source")
  const destination = join(dir, "snapshot")
  const exact = Buffer.alloc(4096, "x")
  writeFileSync(source, exact)

  let result = runSnapshot(source, destination, exact.length)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 0)
  assert.equal(result.stderr.length, 0)
  assert.deepEqual(readFileSync(destination), exact)

  writeFileSync(source, Buffer.alloc(4097, "y"))
  result = runSnapshot(source, destination, exact.length)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 65)
  assert.equal(result.stdout.length, 0)
  assert.equal(result.stderr.length, 0)
  assert.deepEqual(readFileSync(destination), exact)
  assert.deepEqual(readdirSync(dir).filter(name => name.includes(".partial.")), [])
})

test("SSH source snapshot helper reserves exit 66 for ENOENT and maps ENOTDIR to 74", t => {
  const dir = workspace(t)
  const destination = join(dir, "snapshot")

  let result = runSnapshot(join(dir, "missing"), destination, 4096)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 66)
  assert.equal(result.stdout.length, 0)

  const intermediate = join(dir, "intermediate")
  writeFileSync(intermediate, "not a directory")
  result = runSnapshot(join(intermediate, "source"), destination, 4096)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 74)
  assert.equal(result.stdout.length, 0)
  assert.equal(result.stderr.length, 0)
})

test("SSH source snapshot helper maps deterministic permission denial to 74", t => {
  const dir = workspace(t)
  const result = spawnSync(
    python3,
    ["-B", "-I", "-c", `
import errno
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("ssh_snapshot", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def denied_open(*args, **kwargs):
    raise PermissionError(errno.EACCES, "permission denied")

module.os.open = denied_open
status = module.snapshot(sys.argv[2], sys.argv[3], 4096)
raise SystemExit(0 if status == 74 else 1)
`, sshSnapshotHelper, join(dir, "source"), join(dir, "snapshot")],
    { encoding: null, timeout: 5000 }
  )

  assert.equal(result.error, undefined)
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 0)
  assert.equal(result.stderr.length, 0)
})

test("SSH source snapshot helper removes its partial after a write failure", t => {
  const dir = workspace(t)
  const source = join(dir, "source")
  const destination = join(dir, "snapshot")
  writeFileSync(source, "content that reaches the partial file")

  const result = spawnSync(
    python3,
    ["-B", "-I", "-c", `
import errno
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("ssh_snapshot", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def failing_write(*args, **kwargs):
    raise OSError(errno.EIO, "injected write failure")

module.os.write = failing_write
status = module.snapshot(sys.argv[2], sys.argv[3], 4096)
raise SystemExit(0 if status == 74 else 1)
`, sshSnapshotHelper, source, destination],
    { encoding: null, timeout: 5000 }
  )

  assert.equal(result.error, undefined)
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 0)
  assert.equal(result.stderr.length, 0)
  assert.deepEqual(readdirSync(dir), ["source"])
})

test("SSH producer treats an absent top-level config as an empty successful result", t => {
  const dir = workspace(t)

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer fails closed when the top-level intermediate component is a regular file", t => {
  const dir = workspace(t)
  writeFileSync(join(dir, ".ssh"), "not a directory")

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 74)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer fails closed when a literal Include intermediate component is a regular file", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  mkdirSync(ssh)
  writeFileSync(join(ssh, "config"), "Host buffered\nInclude blocked/host.conf\n")
  writeFileSync(join(ssh, "blocked"), "not a directory")

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 74)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer rejects the /dev/null character device without hanging or output", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  mkdirSync(ssh)
  writeFileSync(join(ssh, "config"), "Host buffered\nInclude /dev/null\n")

  const result = run(sshScript, { HOME: dir }, { timeout: 5000 })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 74)
  assert.equal(result.stdout.length, 0)
  assert.equal(result.stderr.length, 0)
})

test("SSH producer propagates wildcard traversal failure for a replaced directory", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  mkdirSync(ssh)
  writeFileSync(join(ssh, "config"), "Host buffered\nInclude blocked/*.conf\n")
  writeFileSync(join(ssh, "blocked"), "not a directory")

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer rejects final symlinks, FIFOs, Unix sockets, and directories without hanging", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const config = join(ssh, "config")
  const target = join(dir, "target")
  mkdirSync(ssh)
  writeFileSync(target, "Host private-content-must-not-be-printed\n")

  const cases = [
    ["final symlink", () => symlinkSync(target, config)],
    ["FIFO", () => makeFifo(config)],
    ["Unix socket", () => makeUnixSocket(config)],
    ["directory", () => mkdirSync(config)]
  ]

  for (const [name, createSource] of cases) {
    rmSync(config, { recursive: true, force: true })
    createSource()
    const result = run(sshScript, { HOME: dir }, { timeout: 5000 })
    assert.equal(result.error, undefined, name)
    assert.equal(result.status, 74, name)
    assert.equal(result.stdout.length, 0, name)
  }
})

test("SSH producer rejects a top-level regular-file-to-FIFO replacement before helper open", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const config = join(ssh, "config")
  mkdirSync(ssh)
  writeFileSync(config, "Host replaced\n")

  const result = runSshReplacementBarrier(dir, config, "fifo")
  assert.equal(result.error, undefined)
  assert.equal(result.status, 74)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer rejects a top-level intermediate-directory replacement before helper open", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const config = join(ssh, "config")
  mkdirSync(ssh)
  writeFileSync(config, "Host replaced\n")

  const result = runSshReplacementBarrier(dir, config, "regular", ssh)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 74)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer rejects an Include regular-file-to-FIFO replacement before helper open", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const include = join(ssh, "included.conf")
  mkdirSync(ssh)
  writeFileSync(join(ssh, "config"), "Host buffered\nInclude included.conf\n")
  writeFileSync(include, "Host replaced\n")

  const result = runSshReplacementBarrier(dir, include, "fifo")
  assert.equal(result.error, undefined)
  assert.equal(result.status, 74)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer rejects an Include intermediate-directory replacement after candidate enumeration", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const includes = join(ssh, "includes")
  const include = join(includes, "included.conf")
  mkdirSync(includes, { recursive: true })
  writeFileSync(join(ssh, "config"), "Host buffered\nInclude includes/included.conf\n")
  writeFileSync(include, "Host replaced\n")

  const result = runSshReplacementBarrier(dir, include, "regular", includes)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 74)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer safely skips an Include that disappears before helper open", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const include = join(ssh, "included.conf")
  mkdirSync(ssh)
  writeFileSync(join(ssh, "config"), "Host before\nInclude included.conf\nHost after\n")
  writeFileSync(include, "Host disappearing\n")

  const result = runSshReplacementBarrier(dir, include, "disappear")
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0)
  assert.equal(result.stdout.toString(), "Host before\nHost after\n")
})

test("SSH producer escalates a blocking TERM-ignoring Python wrapper to KILL", t => {
  let wrapperPid = 0
  t.after(() => {
    if (wrapperPid && processIsAlive(wrapperPid)) process.kill(wrapperPid, "SIGKILL")
  })

  const source = readFileSync(sshScript, "utf8")
  assert.match(source, /timeout --signal=TERM --kill-after=1s 2s \\\n\s+python3 -I/)

  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const bin = join(dir, "blocking-bin")
  const pidFile = join(dir, "blocking-python.pid")
  const blockingFifo = join(dir, "blocking-python.fifo")
  mkdirSync(ssh)
  mkdirSync(bin)
  makeFifo(blockingFifo)
  writeFileSync(join(ssh, "config"), "Host never-read\n")
  writeFileSync(
    join(bin, "python3"),
    `#!/usr/bin/env bash
trap '' TERM
printf '%s\\n' "$$" > "$BLOCKING_PID_FILE"
IFS= read -r _ < "$BLOCKING_FIFO"
`,
    { mode: 0o755 }
  )

  const result = run(
    sshScript,
    {
      HOME: dir,
      PATH: `${bin}:${process.env.PATH}`,
      BLOCKING_PID_FILE: pidFile,
      BLOCKING_FIFO: blockingFifo
    },
    { timeout: 8000 }
  )
  wrapperPid = Number(readFileSync(pidFile, "utf8"))

  assert.equal(result.error, undefined)
  assert.equal(result.status, 137)
  assert.equal(result.stdout.length, 0)
  assert.equal(processIsAlive(wrapperPid), false)
})

test("SSH producer accepts the exact cap and rejects cap plus one wholesale", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const config = join(ssh, "config")
  mkdirSync(ssh, { recursive: true })

  const exact = `#${"x".repeat(262142)}\n`
  assert.equal(Buffer.byteLength(exact), 262144)
  writeFileSync(config, exact)
  let result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 262144)

  const prefix = "Host safe\n  HostName safe\n"
  const suffix = "Host partial"
  const fixedBytes = Buffer.byteLength(`${prefix}#\n${suffix}`)
  const overflow = `${prefix}#${"x".repeat(262145 - fixedBytes)}\n${suffix}`
  assert.equal(Buffer.byteLength(overflow), 262145)
  writeFileSync(config, overflow)
  result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 65)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer rejects a multi-megabyte newline-free source before line parsing", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  mkdirSync(ssh, { recursive: true })
  writeFileSync(join(ssh, "config"), Buffer.alloc(3 * 1024 * 1024, "x"))

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 65)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer uses only deadline-wrapped helper snapshots before Bash parses lines", () => {
  const source = readFileSync(sshScript, "utf8")
  const snapshot = shellFunction(source, "snapshot_source")
  const emit = shellFunction(source, "emit")

  assert.match(snapshot, /timeout --signal=TERM --kill-after=1s 2s/)
  assert.match(snapshot, /python3 -I "\$snapshot_helper" "\$file" "\$snapshot_path" "\$max_bytes"/)
  assert.doesNotMatch(snapshot, /head\s+-c/)
  assert.doesNotMatch(source, /\[\[\s+-r\s+"\$config"|\[\[\s+-r\s+"\$path"/)
  assert.doesNotMatch(source, /\[\[\s+-e\s+"\$candidate"|\[\[\s+-L\s+"\$candidate"/)
  assert.match(source, /search_parent="\$\{parent%\/\}\/"/)

  const snapshotCall = emit.indexOf('snapshot_source "$file" "$depth"')
  const boundedSource = emit.indexOf('source="$snapshot_path"')
  const lineLoop = emit.indexOf("while IFS= read -r line")
  const boundedRedirect = emit.indexOf('done < "$source"')
  assert.ok(snapshotCall >= 0 && snapshotCall < boundedSource)
  assert.ok(boundedSource < lineLoop && lineLoop < boundedRedirect)
  assert.doesNotMatch(emit, /done < "\$file"/)
  assert.doesNotMatch(source, /head\s+-c[^\n]*"\$file"/)
})

test("SSH producer caps an unbounded NUL Include stream before materializing matches", t => {
  let fakeFindPid = 0
  t.after(() => {
    if (fakeFindPid && processIsAlive(fakeFindPid)) process.kill(fakeFindPid, "SIGKILL")
  })

  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const includes = join(ssh, "includes")
  const bin = join(dir, "bin")
  const pidFile = join(dir, "fake-find.pid")
  mkdirSync(includes, { recursive: true })
  mkdirSync(bin)
  writeFileSync(join(ssh, "config"), "Include includes/*\n")
  writeFileSync(
    join(bin, "find"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$$\" > \"$FAKE_FIND_PID_FILE\"\nwhile :; do printf '/fake/match\\0'; done\n",
    { mode: 0o755 }
  )

  const result = run(
    sshScript,
    {
      HOME: dir,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_FIND_PID_FILE: pidFile
    },
    { timeout: 2000 }
  )
  fakeFindPid = Number(readFileSync(pidFile, "utf8"))

  assert.equal(result.error, undefined)
  assert.equal(result.status, 65)
  assert.equal(result.stdout.length, 0)
  assert.equal(processIsAlive(fakeFindPid), false)
})

test("SSH producer rejects bounded Include metadata overflow without partial output", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const includes = join(ssh, "includes")
  mkdirSync(includes, { recursive: true })
  writeFileSync(join(ssh, "config"), "Include includes/*\n")

  for (let index = 0; index < 1100; index += 1) {
    const name = `${String(index).padStart(4, "0")}-${"x".repeat(215)}`
    writeFileSync(join(includes, name), "")
  }

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 65)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer processes glob matches containing spaces in lexical order", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const includes = join(ssh, "includes")
  mkdirSync(includes, { recursive: true })
  writeFileSync(join(ssh, "config"), "Include includes/*.conf\n")
  writeFileSync(join(includes, "20 second.conf"), "Host second\n")
  writeFileSync(join(includes, "15 line\nbreak.conf"), "Host newline\n")
  writeFileSync(join(includes, "10 first.conf"), "Host first\n")

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.toString(), "Host first\nHost newline\nHost second\n")
})

test("SSH producer preserves relative, home, absolute, question, and bracket Include patterns", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const relative = join(ssh, "relative")
  const home = join(dir, "home-includes")
  const absolute = join(dir, "absolute-includes")
  mkdirSync(relative, { recursive: true })
  mkdirSync(home)
  mkdirSync(absolute)
  writeFileSync(
    join(ssh, "config"),
    `Include relative/host?.conf ~/home-includes/[bc].conf ${absolute}/*.conf\n`
  )
  writeFileSync(join(relative, "host1.conf"), "Host relative\n")
  writeFileSync(join(home, "b.conf"), "Host home-b\n")
  writeFileSync(join(home, "c.conf"), "Host home-c\n")
  writeFileSync(join(absolute, "host.conf"), "Host absolute\n")

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 0)
  assert.equal(
    result.stdout.toString(),
    "Host relative\nHost home-b\nHost home-c\nHost absolute\n"
  )
})

test("SSH producer accepts the output cap and rejects Include-output cap plus one", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  mkdirSync(ssh, { recursive: true })
  writeFileSync(join(ssh, "config"), "Include first.conf second.conf\n")
  const first = `#${"x".repeat(131070)}\n`
  const second = `#${"y".repeat(131070)}\n`
  assert.equal(Buffer.byteLength(first), 131072)
  assert.equal(Buffer.byteLength(second), 131072)
  writeFileSync(join(ssh, "first.conf"), first)
  writeFileSync(join(ssh, "second.conf"), second)

  let result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 262144)

  writeFileSync(join(ssh, "second.conf"), `${second.slice(0, -1)}y\n`)
  result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 65)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer preserves Include expansion through depth two", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  mkdirSync(ssh, { recursive: true })
  writeFileSync(join(ssh, "config"), "Include one.conf\n")
  writeFileSync(join(ssh, "one.conf"), "Host one\nInclude two.conf\n")
  writeFileSync(join(ssh, "two.conf"), "Host two\nInclude three.conf\n")
  writeFileSync(join(ssh, "three.conf"), "Host three\n")

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.toString(), "Host one\nHost two\nInclude three.conf\n")
})

test("SSH producer rejects a final-component Include symlink without partial output", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  mkdirSync(ssh)
  writeFileSync(join(ssh, "config"), "Host buffered\nInclude linked.conf\n")
  writeFileSync(join(dir, "target.conf"), "Host linked\n")
  symlinkSync(join(dir, "target.conf"), join(ssh, "linked.conf"))

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 74)
  assert.equal(result.stdout.length, 0)
})

test("SSH producer supports a regular file through an intermediate directory symlink", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const realDirectory = join(dir, "real-includes")
  mkdirSync(ssh, { recursive: true })
  mkdirSync(realDirectory)
  writeFileSync(join(ssh, "config"), "Include linked-includes/*.conf\n")
  writeFileSync(join(realDirectory, "linked.conf"), "Host linked\n")
  symlinkSync(realDirectory, join(ssh, "linked-includes"), "dir")

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.toString(), "Host linked\n")
})
