import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const patchChecker = resolve(repositoryRoot, 'scripts/manage-dsh-alpha-host-patch.mjs')
const capabilityChecker = resolve(repositoryRoot, 'scripts/check-dsh-alpha-session-events.mjs')
const packageManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
const managedProfileFiles = new Map([
  ['cordis.yml', [
    '# dsh profile root — an empty entry list. The tree is composed as patches:',
    "# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any",
    '# --patch overlays. Edit cordis.patch.yml, not this file.',
    '[]',
    '',
  ].join('\n')],
  ['pnpm-workspace.yaml', [
    'packages:',
    '  - .',
    '',
    'nodeLinker: hoisted',
    'autoInstallPeers: false',
    '',
  ].join('\n')],
])

function fail(message) {
  throw new Error(`DSH alpha development setup failed: ${message}`)
}

function parseArguments(args) {
  const mode = args[0] ?? 'setup'
  if (!['check', 'setup', 'preview'].includes(mode)) {
    fail(`unknown mode ${JSON.stringify(mode)}; expected check, setup, or preview`)
  }
  let dshRoot = process.env.DSH_ALPHA_ROOT
  let home = process.env.DSH_ALPHA_HOME
  let host = '127.0.0.1'
  let port = 3181
  let open = false
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    if (arg === '--dsh-root') {
      dshRoot = args[index + 1]
      if (dshRoot === undefined) fail('--dsh-root requires a path')
      index += 1
      continue
    }
    if (arg === '--home') {
      home = args[index + 1]
      if (home === undefined) fail('--home requires a path')
      index += 1
      continue
    }
    if (arg === '--host') {
      host = args[index + 1]
      if (host === undefined || host.trim() === '') fail('--host requires a value')
      index += 1
      continue
    }
    if (arg === '--port') {
      const value = args[index + 1]
      if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) fail('--port requires a positive integer')
      port = Number(value)
      if (port > 65_535) fail('--port must not exceed 65535')
      index += 1
      continue
    }
    if (arg === '--open') {
      open = true
      continue
    }
    if (arg === '--no-open') {
      open = false
      continue
    }
    fail(`unknown argument ${JSON.stringify(arg)}`)
  }
  const fallbackRoot = resolve(repositoryRoot, '../dsh-alpha-agent-rp')
  const requestedRoot = dshRoot ?? (existsSync(fallbackRoot) ? fallbackRoot : undefined)
  if (requestedRoot === undefined) {
    fail('set DSH_ALPHA_ROOT or pass --dsh-root with the patched DSH alpha source checkout')
  }
  const resolvedRoot = realpathSync(resolve(requestedRoot))
  const resolvedHome = resolve(home ?? resolve(repositoryRoot, '.runtime/dsh-alpha-home'))
  return { mode, dshRoot: resolvedRoot, home: resolvedHome, host, port, open }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: options.shell ?? false,
    stdio: options.capture === true ? 'pipe' : 'inherit',
  })
  if (result.error !== undefined) fail(result.error.message)
  if (result.status !== 0) {
    const detail = options.capture === true
      ? [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      : ''
    fail(`${basename(command)} exited with ${String(result.status)}${detail === '' ? '' : `: ${detail}`}`)
  }
  return options.capture === true ? result.stdout.trim() : ''
}

function pnpm(args, cwd) {
  const pnpmEntry = process.env.npm_execpath
  if (pnpmEntry !== undefined && basename(pnpmEntry).toLocaleLowerCase().includes('pnpm')) {
    run(process.execPath, [pnpmEntry, ...args], { cwd })
    return
  }
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  run(command, args, { cwd, shell: process.platform === 'win32' })
}

function checkPatchedDshRoot(dshRoot) {
  return JSON.parse(run(process.execPath, [
    patchChecker,
    '--check',
    '--dsh-root',
    dshRoot,
  ], { capture: true }))
}

function discoverDshPackages(dshRoot) {
  const packagesRoot = resolve(dshRoot, 'packages')
  if (!existsSync(packagesRoot)) fail(`DSH package root does not exist: ${packagesRoot}`)
  const links = new Map()
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === 'lib') continue
      const child = resolve(directory, entry.name)
      const manifestPath = resolve(child, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/dsh-')) {
          if (links.has(manifest.name)) fail(`duplicate DSH package ${manifest.name}`)
          links.set(manifest.name, child.replaceAll('\\', '/'))
        }
      }
      visit(child)
    }
  }
  visit(packagesRoot)
  const required = new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap(field => Object.keys(packageManifest[field] ?? {}))
    .filter(name => name.startsWith('@deepseek-ai/dsh-')))
  const missing = [...required].filter(name => !links.has(name)).sort()
  if (missing.length > 0) fail(`DSH source does not provide: ${missing.join(', ')}`)
  return new Map([...links].filter(([name]) => required.has(name)))
}

function writePnpmfile(directory, links) {
  const serializedLinks = JSON.stringify(Object.fromEntries(links), null, 2)
  const content = [
    `'use strict'`,
    '',
    `const links = ${serializedLinks}`,
    `const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']`,
    '',
    'module.exports = {',
    '  hooks: {',
    '    readPackage(manifest) {',
    '      for (const field of dependencyFields) {',
    '        for (const name of Object.keys(manifest[field] ?? {})) {',
    '          if (links[name] !== undefined) manifest[field][name] = `link:${links[name]}`',
    '        }',
    '      }',
    '      return manifest',
    '    },',
    '  },',
    '}',
    '',
  ].join('\n')
  const path = resolve(directory, '.pnpmfile.cjs')
  writeFileSync(path, content)
  return path
}

function installEsbuildBinary() {
  const virtualStore = resolve(repositoryRoot, 'node_modules/.pnpm')
  const packageRoots = readdirSync(virtualStore, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('esbuild@'))
    .map(entry => resolve(virtualStore, entry.name, 'node_modules/esbuild'))
    .filter(path => existsSync(resolve(path, 'install.js')))
  if (packageRoots.length === 0) fail('installed dependency graph does not contain esbuild')
  for (const packageRoot of packageRoots) {
    run(process.execPath, ['install.js'], { cwd: packageRoot })
  }
}

function buildHost() {
  const tsdown = resolve(repositoryRoot, 'node_modules/tsdown/dist/run.mjs')
  if (!existsSync(tsdown)) fail('installed dependency graph does not contain tsdown')
  run(process.execPath, [tsdown, '--config', 'tsdown.host.config.ts'])
}

function installSourceDependencies(dshRoot, links) {
  pnpm(['install', '--frozen-lockfile'], dshRoot)
  const temporary = mkdtempSync(resolve(tmpdir(), 'dsh-agent-rp-alpha-'))
  try {
    const pnpmfile = writePnpmfile(temporary, links)
    pnpm([
      'install',
      '--ignore-workspace',
      '--no-lockfile',
      '--ignore-scripts',
      '--config.strict-dep-builds=false',
      `--config.pnpmfile=${pnpmfile}`,
    ], repositoryRoot)
    installEsbuildBinary()
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
  const capability = run(process.execPath, [capabilityChecker], { capture: true })
  if (capability !== 'ready') fail('linked DSH Session capability probe did not report ready')
}

function writeManagedFile(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') !== content) {
    fail(`refusing to replace unmanaged profile file ${path}`)
  }
  writeFileSync(path, content)
}

function prepareProfile(home) {
  const profileRoot = resolve(home, 'profiles/web')
  mkdirSync(profileRoot, { recursive: true })
  const packageJson = JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: {
      '@hewzhew/dsh-agent-rp': `link:${repositoryRoot.replaceAll('\\', '/')}`,
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          '@hewzhew/dsh-agent-rp',
        ],
        patchReload: 'live',
      },
    },
  }, null, 2) + '\n'
  writeManagedFile(resolve(profileRoot, 'package.json'), packageJson)
  for (const [name, content] of managedProfileFiles) {
    writeManagedFile(resolve(profileRoot, name), content)
  }
  return profileRoot
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const patch = checkPatchedDshRoot(options.dshRoot)
  const links = discoverDshPackages(options.dshRoot)
  if (options.mode === 'check') {
    process.stdout.write(JSON.stringify({ ready: true, patch, packages: links.size }) + '\n')
    return
  }
  installSourceDependencies(options.dshRoot, links)
  if (options.mode === 'setup') {
    process.stdout.write(JSON.stringify({ ready: true, patch, packages: links.size }) + '\n')
    return
  }
  buildHost()
  const profileRoot = prepareProfile(options.home)
  pnpm([
    'install',
    '--no-lockfile',
    '--ignore-scripts',
    '--config.strict-dep-builds=false',
  ], profileRoot)
  process.stdout.write(JSON.stringify({
    ready: true,
    patch,
    packages: links.size,
    home: options.home,
    profile: profileRoot,
    url: `http://${options.host}:${String(options.port)}/`,
  }) + '\n')
  run(process.execPath, [
    '--import',
    'tsx/esm',
    'apps/cli/src/bin.ts',
    '--profile',
    'web',
    '--host',
    options.host,
    '--port',
    String(options.port),
    options.open ? '--open' : '--no-open',
  ], {
    cwd: options.dshRoot,
    env: { ...process.env, DSH_HOME: options.home },
  })
}

main()
