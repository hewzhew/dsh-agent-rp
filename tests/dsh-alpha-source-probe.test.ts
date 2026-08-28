import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
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
): { readonly root: string; readonly probe: string; readonly disposeMarker: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-alpha-source-probe-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const probe = join(root, 'check-dsh-alpha-session-events.mjs')
  const disposeMarker = join(root, 'fiber-disposed')
  copyFileSync(probeSource, probe)
  writeModule(root, '@deepseek-ai/cordis', `
import { writeFileSync } from 'node:fs'

export class Context {
  async plugin(Plugin) {
    this.sessions = new Plugin(this)
    return {
      dispose: async () => {
        writeFileSync(process.env.FAKE_DISPOSE_MARKER, 'disposed\\n')
      },
    }
  }
}
`)
  writeModule(root, '@deepseek-ai/dsh-session', sessionModule)
  return { root, probe, disposeMarker }
}

function runProbe(fixture: ReturnType<typeof createProbeFixture>) {
  return spawnSync(process.execPath, [fixture.probe], {
    cwd: fixture.root,
    env: { ...process.env, FAKE_DISPOSE_MARKER: fixture.disposeMarker },
    encoding: 'utf8',
  })
}

test('alpha source probe verifies registration and releases its Cordis fiber', context => {
  const fixture = createProbeFixture(context, `
export default class SessionStore {
  types = new Set()

  registerEventType(type) {
    this.types.add(type)
    return () => this.types.delete(type)
  }

  recognizesEventType(type) {
    return this.types.has(type)
  }
}
`)
  const result = runProbe(fixture)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'ready')
  assert.equal(existsSync(fixture.disposeMarker), true)
})

test('alpha source probe rejects a SessionStore without external event registration', context => {
  const fixture = createProbeFixture(context, 'export default class SessionStore {}\n')
  const result = runProbe(fixture)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /registerEventType/u)
  assert.equal(existsSync(fixture.disposeMarker), true)
})
