import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test, { type TestContext } from 'node:test'

const repositoryRoot = resolve(import.meta.dirname, '..')
const installer = resolve(repositoryRoot, 'scripts/install-macos.sh')
const pluginPackageName = '@hewzhew/dsh-agent-rp'
const legacyPluginPackageName = '@dsh-external/dsh-agent-rp'
const defaultPluginSource = '@hewzhew/dsh-agent-rp@next'
const pluginSource = 'github:hewzhew/dsh-agent-rp#fixture'

interface InstallerFixtureOptions {
  readonly capability?: 'function' | 'missing'
  readonly system?: string
  readonly architecture?: string
  readonly listener?: string
}

interface InstallerFixture {
  readonly root: string
  readonly dshHome: string
  readonly runnerSource: string
  readonly log: string
  readonly env: NodeJS.ProcessEnv
}

function executable(path: string, source: string): void {
  writeFileSync(path, source)
  chmodSync(path, 0o755)
}

function createFixture(
  context: TestContext,
  options: InstallerFixtureOptions = {},
): InstallerFixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-macos-installer-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const home = join(root, 'home')
  const dshHome = join(root, 'DSH home')
  const runnerSource = join(root, 'runner-source')
  const fakeBin = join(root, 'bin')
  const fakeDsh = join(root, 'fake-dsh')
  const log = join(root, 'dsh-commands.jsonl')
  mkdirSync(home, { recursive: true })
  mkdirSync(fakeBin, { recursive: true })
  mkdirSync(join(runnerSource, 'patches'), { recursive: true })
  writeFileSync(join(runnerSource, 'package.json'), '{}\n')
  writeFileSync(join(runnerSource, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  writeFileSync(join(runnerSource, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  writeFileSync(
    join(runnerSource, 'patches/@deepseek-ai__dsh-session@0.1.1-rc.2.patch'),
    'fixture patch\n',
  )

  executable(join(fakeBin, 'uname'), `#!/bin/sh
if [ "$1" = "-s" ]; then
  printf '%s\\n' "\${FAKE_UNAME_SYSTEM}"
else
  printf '%s\\n' "\${FAKE_UNAME_ARCH}"
fi
`)
  executable(join(fakeBin, 'lsof'), `#!/bin/sh
if [ -n "\${FAKE_LSOF_OUTPUT:-}" ]; then
  printf '%s\\n' 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME'
  printf '%s\\n' "\${FAKE_LSOF_OUTPUT}"
fi
`)

  executable(fakeDsh, `#!${process.execPath}
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
if (args.includes('--version')) {
  process.stdout.write('0.1.1-rc.2\\n')
  process.exit(0)
}
appendFileSync(process.env.FAKE_DSH_LOG, JSON.stringify({
  args,
  dshHome: process.env.DSH_HOME,
}) + '\\n')
if (args[0] === 'plugin') {
  const action = args[3]
  const value = args[4]
  const profileRoot = join(process.env.DSH_HOME, 'profiles', 'web')
  const manifestPath = join(profileRoot, 'package.json')
  let manifest = { dependencies: {}, dsh: { profile: { bundles: [] } } }
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch {}
  if (action === 'add') manifest.dependencies['@hewzhew/dsh-agent-rp'] = value
  if (action === 'remove') {
    delete manifest.dependencies[value]
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(bundle => bundle !== value)
  }
  if (action !== 'remove' && !manifest.dsh.profile.bundles.includes('@hewzhew/dsh-agent-rp')) {
    manifest.dsh.profile.bundles.push('@hewzhew/dsh-agent-rp')
  }
  mkdirSync(profileRoot, { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n')
  const packageRoot = join(profileRoot, 'node_modules', '@hewzhew', 'dsh-agent-rp')
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@hewzhew/dsh-agent-rp',
    version: '0.0.0-test',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2) + '\\n')
  process.exit(0)
}
process.stdout.write('HOST_STARTED\\n')
`)

  executable(join(fakeBin, 'pnpm'), `#!${process.execPath}
const { chmodSync, copyFileSync, mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
if (args[0] === '--version') {
  process.stdout.write('11.16.0\\n')
  process.exit(0)
}
const directoryIndex = args.indexOf('--dir')
if (directoryIndex < 0 || args[directoryIndex + 2] !== 'install') process.exit(2)
const runner = args[directoryIndex + 1]
const sessionRoot = join(runner, 'node_modules', '@deepseek-ai', 'dsh-session')
mkdirSync(sessionRoot, { recursive: true })
writeFileSync(join(sessionRoot, 'package.json'), JSON.stringify({
  name: '@deepseek-ai/dsh-session',
  type: 'module',
  exports: './index.js',
}) + '\\n')
writeFileSync(
  join(sessionRoot, 'index.js'),
  process.env.FAKE_CAPABILITY === 'missing'
    ? 'export class Session {}\\n'
    : 'export class Session { appendIgnorable() {} }\\n',
)
const commandRoot = join(runner, 'node_modules', '.bin')
mkdirSync(commandRoot, { recursive: true })
copyFileSync(process.env.FAKE_DSH_COMMAND, join(commandRoot, 'dsh'))
chmodSync(join(commandRoot, 'dsh'), 0o755)
`)

  return {
    root,
    dshHome,
    runnerSource,
    log,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      HOME: home,
      DSH_HOME: dshHome,
      RUNNER_SOURCE_BASE: runnerSource,
      PLUGIN_SOURCE: pluginSource,
      FAKE_DSH_COMMAND: fakeDsh,
      FAKE_DSH_LOG: log,
      FAKE_CAPABILITY: options.capability ?? 'function',
      FAKE_UNAME_SYSTEM: options.system ?? 'Darwin',
      FAKE_UNAME_ARCH: options.architecture ?? 'arm64',
      FAKE_LSOF_OUTPUT: options.listener ?? '',
    },
  }
}

function runInstaller(fixture: InstallerFixture, arguments_: readonly string[] = []) {
  return spawnSync('/bin/bash', [installer, '--allow-root', ...arguments_], {
    cwd: repositoryRoot,
    env: fixture.env,
    encoding: 'utf8',
  })
}

function seedProfile(fixture: InstallerFixture, source: string): void {
  const profileRoot = join(fixture.dshHome, 'profiles', 'web')
  mkdirSync(profileRoot, { recursive: true })
  writeFileSync(join(profileRoot, 'package.json'), JSON.stringify({
    dependencies: { [pluginPackageName]: source },
    dsh: { profile: { bundles: [pluginPackageName] } },
  }, null, 2) + '\n')
}

function seedLegacyProfile(fixture: InstallerFixture, source: string): void {
  const profileRoot = join(fixture.dshHome, 'profiles', 'web')
  mkdirSync(profileRoot, { recursive: true })
  writeFileSync(join(profileRoot, 'package.json'), JSON.stringify({
    dependencies: { [legacyPluginPackageName]: source },
    dsh: { profile: { bundles: [legacyPluginPackageName] } },
  }, null, 2) + '\n')
}

function commandLog(fixture: InstallerFixture): Array<{
  readonly args: string[]
  readonly dshHome: string
}> {
  if (!existsSync(fixture.log)) return []
  return readFileSync(fixture.log, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line))
}

const skip = process.platform === 'win32'

test('desktop installers default to the npm next prerelease', () => {
  const windows = readFileSync(resolve(repositoryRoot, 'scripts/install-windows.ps1'), 'utf8')
  const macos = readFileSync(installer, 'utf8')
  const linux = readFileSync(resolve(repositoryRoot, 'scripts/install-linux.sh'), 'utf8')

  assert.match(windows, new RegExp(`PluginSource = '${defaultPluginSource}'`, 'u'))
  for (const source of [macos, linux]) {
    assert.match(source, new RegExp(`PLUGIN_SOURCE="\\$\\{PLUGIN_SOURCE:-${defaultPluginSource}\\}"`, 'u'))
  }
  for (const source of [windows, macos, linux]) {
    assert.match(source, /@dsh-external\/dsh-agent-rp/u)
    assert.match(source, /remove/u)
  }
})

test('shows macOS installer options without touching the host', { skip }, () => {
  const result = spawnSync('/bin/bash', [installer, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /install-macos\.sh/u)
  assert.doesNotMatch(result.stdout, /systemd/u)
})

test('rejects a non-macOS host before preparing the runner', { skip }, context => {
  const fixture = createFixture(context, { system: 'Linux' })
  const result = runInstaller(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /只支持 macOS/u)
  assert.equal(existsSync(join(fixture.dshHome, 'runners')), false)
})

test('rejects an unsupported macOS architecture before preparing the runner', { skip }, context => {
  const fixture = createFixture(context, { architecture: 'powerpc' })
  const result = runInstaller(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /架构尚未验收：powerpc/u)
  assert.equal(existsSync(join(fixture.dshHome, 'runners')), false)
})

test('rejects an unvalidated DSH version before installing dependencies', { skip }, context => {
  const fixture = createFixture(context)
  const result = runInstaller(fixture, ['--dsh-version', '0.1.2'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /不能套用未验收版本 0\.1\.2/u)
  assert.equal(existsSync(join(fixture.dshHome, 'runners')), false)
})

test('rejects conflicting registry options', { skip }, context => {
  const fixture = createFixture(context)
  const result = runInstaller(fixture, [
    '--china-mirror', '--registry', 'https://registry.npmjs.org',
  ])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /不能同时使用/u)
  assert.equal(existsSync(join(fixture.dshHome, 'runners')), false)
})

test('rejects an invalid trusted Host authority', { skip }, context => {
  const fixture = createFixture(context)
  const result = runInstaller(fixture, ['--trusted-host', 'https://agent.example/path'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /trusted-host 必须是规范的 host/u)
  assert.equal(existsSync(join(fixture.dshHome, 'runners')), false)
})

test('installs the patched Host and writes a DSH_HOME-preserving launcher', { skip }, context => {
  const fixture = createFixture(context)
  const result = runInstaller(fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /安全插件事件能力：已验证/u)
  const launcher = join(fixture.dshHome, 'bin', 'dsh-agent-rp')
  assert.equal(statSync(launcher).mode & 0o777, 0o700)
  assert.doesNotMatch(readFileSync(launcher, 'utf8'), /readlink -f/u)

  const manifest = JSON.parse(readFileSync(
    join(fixture.dshHome, 'profiles', 'web', 'package.json'),
    'utf8',
  ))
  assert.equal(manifest.dependencies[pluginPackageName], pluginSource)
  assert.deepEqual(manifest.dsh.profile.bundles, [pluginPackageName])
  assert.deepEqual(commandLog(fixture)[0]?.args, ['plugin', '--profile', 'web', 'add', pluginSource])

  const launch = spawnSync(launcher, ['--no-open'], {
    env: { ...fixture.env, DSH_HOME: join(fixture.root, 'wrong-home') },
    encoding: 'utf8',
  })
  assert.equal(launch.status, 0, launch.stderr)
  assert.match(launch.stdout, /HOST_STARTED/u)
  assert.deepEqual(commandLog(fixture).at(-1), {
    args: ['--profile', 'web', '--no-open'],
    dshHome: realpathSync(fixture.dshHome),
  })
})

test('updates an existing plugin installed from the requested source', { skip }, context => {
  const fixture = createFixture(context)
  seedProfile(fixture, pluginSource)
  const result = runInstaller(fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(commandLog(fixture)[0]?.args, [
    'plugin', '--profile', 'web', 'update', pluginPackageName,
  ])
})

test('synchronizes an existing plugin installed from another source', { skip }, context => {
  const fixture = createFixture(context)
  seedProfile(fixture, 'file:/old/agent-rp')
  const result = runInstaller(fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(commandLog(fixture)[0]?.args, [
    'plugin', '--profile', 'web', 'add', pluginSource,
  ])
})

test('installs the renamed package before removing the historical package', { skip }, context => {
  const fixture = createFixture(context)
  seedLegacyProfile(fixture, 'github:hewzhew/dsh-agent-rp#legacy')
  const result = runInstaller(fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(commandLog(fixture).map(command => command.args), [
    ['plugin', '--profile', 'web', 'add', pluginSource],
    ['plugin', '--profile', 'web', 'remove', legacyPluginPackageName],
  ])
  const manifest = JSON.parse(readFileSync(
    join(fixture.dshHome, 'profiles', 'web', 'package.json'),
    'utf8',
  ))
  assert.equal(manifest.dependencies[legacyPluginPackageName], undefined)
  assert.equal(manifest.dependencies[pluginPackageName], pluginSource)
  assert.deepEqual(manifest.dsh.profile.bundles, [pluginPackageName])
})

test('does not create a launcher when the Session patch is absent', { skip }, context => {
  const fixture = createFixture(context, { capability: 'missing' })
  const result = runInstaller(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /缺少安全插件事件能力/u)
  assert.equal(existsSync(join(fixture.dshHome, 'bin', 'dsh-agent-rp')), false)
  assert.deepEqual(commandLog(fixture), [])
})

test('does not start a second Host when port 3080 is occupied', { skip }, context => {
  const fixture = createFixture(context, {
    listener: 'node 4321 user 20u IPv4 0t0 TCP 127.0.0.1:3080 (LISTEN)',
  })
  const result = runInstaller(fixture, ['--start'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /端口 3080 已被占用/u)
  assert.equal(commandLog(fixture).some(command => command.args[0] === '--profile'), false)
})

test('forwards trusted hosts when starting the installed Host', { skip }, context => {
  const fixture = createFixture(context)
  const result = runInstaller(fixture, ['--start', '--trusted-host', 'agent.example:8443'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(commandLog(fixture).at(-1)?.args, [
    '--profile', 'web', '--trusted-host', 'agent.example:8443',
  ])
})
