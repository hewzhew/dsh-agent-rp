import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test, { type TestContext } from 'node:test'

const repositoryRoot = resolve(import.meta.dirname, '..')
const probeSource = resolve(repositoryRoot, 'scripts/check-dsh-alpha-session-events.mjs')

function writeModule(root: string, name: string, source: string): void {
  const moduleRoot = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(moduleRoot, { recursive: true })
  writeFileSync(join(moduleRoot, 'package.json'), JSON.stringify({
    name,
    type: 'module',
    exports: './index.js',
  }) + '\n')
  writeFileSync(join(moduleRoot, 'index.js'), source)
}

function createProbeFixture(
  context: TestContext,
  sessionModule: string,
): { readonly root: string; readonly probe: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-alpha-source-probe-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const probe = join(root, 'check-dsh-alpha-session-events.mjs')
  copyFileSync(probeSource, probe)
  writeModule(root, '@deepseek-ai/dsh-session', sessionModule)
  return { root, probe }
}

function runProbe(fixture: ReturnType<typeof createProbeFixture>) {
  return spawnSync(process.execPath, [fixture.probe], {
    cwd: fixture.root,
    env: process.env,
    encoding: 'utf8',
  })
}

test('alpha source probe verifies replay-safe plugin event appends', context => {
  const fixture = createProbeFixture(context, `
export const KNOWN_SESSION_EVENT_TYPES = new Set()
export function SessionId(value) { return value }
export class Session {
  constructor(id, events = []) {
    this.id = id
    this.events = events
  }
  static create(id, events = []) { return new Session(id, events) }
  appendIgnorable(type, data) {
    const event = { type, seq: this.events.length, time: 1, data, ignorable: true }
    this.events.push(event)
    return event
  }
}
`)
  const result = runProbe(fixture)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'ready')
})

test('alpha source probe rejects a Session without replay-safe plugin event appends', context => {
  const fixture = createProbeFixture(context, `
export const KNOWN_SESSION_EVENT_TYPES = new Set()
export function SessionId(value) { return value }
export class Session {
  constructor(id, events = []) { this.id = id; this.events = events }
  static create(id, events = []) { return new Session(id, events) }
}
`)
  const result = runProbe(fixture)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /appendIgnorable/u)
})
