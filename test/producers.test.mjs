import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const editorScript = fileURLToPath(new URL("../scripts/editor-path.sh", import.meta.url))
const sshScript = fileURLToPath(new URL("../scripts/ssh-config.sh", import.meta.url))

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

test("SSH producer snapshots and validates every source before Bash parses lines", () => {
  const source = readFileSync(sshScript, "utf8")
  const snapshot = shellFunction(source, "snapshot_source")
  const emit = shellFunction(source, "emit")

  const head = snapshot.indexOf('head -c $((max_bytes + 1)) -- "$file" > "$snapshot_path"')
  const measure = snapshot.indexOf('bytes=$(wc -c < "$snapshot_path")')
  const reject = snapshot.indexOf('(( bytes <= max_bytes )) || return "$overflow_exit"')
  assert.ok(head >= 0, "the source snapshot must be capped at max_bytes + 1")
  assert.ok(head < measure, "the bounded snapshot must exist before it is measured")
  assert.ok(measure < reject, "snapshot size must be measured before overflow rejection")

  const snapshotCall = emit.indexOf('snapshot_source "$file" "$depth"')
  const boundedSource = emit.indexOf('source="$snapshot_path"')
  const lineLoop = emit.indexOf("while IFS= read -r line")
  const boundedRedirect = emit.indexOf('done < "$source"')
  assert.ok(snapshotCall >= 0 && snapshotCall < boundedSource)
  assert.ok(boundedSource < lineLoop && lineLoop < boundedRedirect)
  assert.doesNotMatch(emit, /done < "\$file"/)
  assert.doesNotMatch(source, /emit "\$config" 0\s*\|\s*head/)
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

test("SSH producer follows symlinked regular files through an intermediate directory symlink", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  const realDirectory = join(dir, "real-includes")
  mkdirSync(ssh, { recursive: true })
  mkdirSync(realDirectory)
  writeFileSync(join(ssh, "config"), "Include linked-includes/*.conf\n")
  writeFileSync(join(dir, "target.conf"), "Host linked\n")
  symlinkSync(join(dir, "target.conf"), join(realDirectory, "linked.conf"))
  symlinkSync(realDirectory, join(ssh, "linked-includes"), "dir")

  const result = run(sshScript, { HOME: dir })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.toString(), "Host linked\n")
})
