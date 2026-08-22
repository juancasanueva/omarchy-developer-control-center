import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
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

function run(script, env) {
  return spawnSync("bash", [script], {
    env: { ...process.env, ...env },
    encoding: null
  })
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

test("SSH producer rejects exact cap plus one after Include expansion", t => {
  const dir = workspace(t)
  const ssh = join(dir, ".ssh")
  mkdirSync(ssh, { recursive: true })
  writeFileSync(join(ssh, "config"), "Include oversized.conf\n")
  const expanded = `#${"x".repeat(262143)}\n`
  assert.equal(Buffer.byteLength(expanded), 262145)
  writeFileSync(join(ssh, "oversized.conf"), expanded)

  const result = run(sshScript, { HOME: dir })
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
