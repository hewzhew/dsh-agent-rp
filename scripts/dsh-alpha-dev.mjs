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
  if (!['check', 'setup', 'verify', 'preview'].includes(mode)) {
    fail(`unknown mode ${JSON.stringify(mode)}; expected check, setup, verify, or preview`)
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
  const fallbackRoot = resolve(repositoryRoot, '../dsh-alpha5-host')
  const requestedRoot = dshRoot ?? (existsSync(fallbackRoot) ? fallbackRoot : undefined)
  if (requestedRoot === undefined) {
    fail('set DSH_ALPHA_ROOT or pass --dsh-root with the compatible DSH alpha source checkout')
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
  const sourceRoots = ['packages', 'vendor'].map(name => resolve(dshRoot, name))
  for (const sourceRoot of sourceRoots) {
    if (!existsSync(sourceRoot)) fail(`DSH source root does not exist: ${sourceRoot}`)
  }
  const links = new Map()
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === 'lib') continue
      const child = resolve(directory, entry.name)
      const manifestPath = resolve(child, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/')) {
          if (links.has(manifest.name)) fail(`duplicate DSH package ${manifest.name}`)
          links.set(manifest.name, child.replaceAll('\\', '/'))
        }
      }
      visit(child)
    }
  }
  for (const sourceRoot of sourceRoots) visit(sourceRoot)
  const required = new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap(field => Object.keys(packageManifest[field] ?? {}))
    .filter(name => name.startsWith('@deepseek-ai/')))
  const missing = [...required].filter(name => !links.has(name)).sort()
  if (missing.length > 0) fail(`DSH source does not provide: ${missing.join(', ')}`)
  return links
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

function buildPlugin() {
  const tsdown = resolve(repositoryRoot, 'node_modules/tsdown/dist/run.mjs')
  if (!existsSync(tsdown)) fail('installed dependency graph does not contain tsdown')
  run(process.execPath, [tsdown])
}

function typecheckPlugin() {
  const tsc = resolve(repositoryRoot, 'node_modules/typescript/bin/tsc')
  if (!existsSync(tsc)) fail('installed dependency graph does not contain TypeScript')
  for (const config of ['tsconfig.host.json', 'tsconfig.client.json']) {
    run(process.execPath, [tsc, '-p', config, '--noEmit'])
  }
}

function checkLinkedSessionCapability() {
  const capability = run(process.execPath, [capabilityChecker], { capture: true })
  if (capability !== 'ready') fail('linked DSH Session capability probe did not report ready')
}

function missingDshBuildArtifacts(links) {
  const missing = []
  for (const [name, packageRoot] of links) {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
    for (const field of ['main', 'types']) {
      const relative = manifest[field]
      if (typeof relative === 'string' && !existsSync(resolve(packageRoot, relative))) {
        missing.push(`${name}:${field}`)
      }
    }
  }
  return missing
}

function ensureDshBuildArtifacts(dshRoot, links) {
  const missing = missingDshBuildArtifacts(links)
  if (missing.length === 0) return
  pnpm(['run', 'build:lib'], dshRoot)
  const remaining = missingDshBuildArtifacts(links)
  if (remaining.length > 0) {
    fail(`DSH build did not produce required package artifacts: ${remaining.join(', ')}`)
  }
}

function ensureDshWebArtifacts(dshRoot) {
  const index = resolve(dshRoot, 'apps/web/dist/index.html')
  if (existsSync(index)) return
  pnpm(['run', 'build:web'], dshRoot)
  if (!existsSync(index)) fail(`DSH Web build did not produce ${index}`)
}

function installSourceDependencies(dshRoot, links) {
  pnpm(['install', '--frozen-lockfile'], dshRoot)
  ensureDshBuildArtifacts(dshRoot, links)
  const temporary = mkdtempSync(resolve(tmpdir(), 'dsh-agent-rp-alpha-'))
  try {
    const pnpmfile = writePnpmfile(temporary, links)
    pnpm([
      'install',
      '--ignore-workspace',
      '--no-lockfile',
      `--lockfile-dir=${temporary}`,
      `--virtual-store-dir=${resolve(repositoryRoot, 'node_modules/.pnpm')}`,
      '--ignore-scripts',
      '--config.strict-dep-builds=false',
      `--config.pnpmfile=${pnpmfile}`,
    ], repositoryRoot)
    installEsbuildBinary()
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
  checkLinkedSessionCapability()
}

function assertManagedFileAvailable(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') !== content) {
    fail(`refusing to replace unmanaged profile file ${path}; choose an empty --home directory`)
  }
}

function writeManagedFile(path, content) {
  assertManagedFileAvailable(path, content)
  writeFileSync(path, content)
}

function profilePlan(home) {
  const profileRoot = resolve(home, 'profiles/web')
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
  return {
    profileRoot,
    files: new Map([
      ['package.json', packageJson],
      ...managedProfileFiles,
    ]),
  }
}

function assertProfilePlanAvailable(plan) {
  for (const [name, content] of plan.files) {
    assertManagedFileAvailable(resolve(plan.profileRoot, name), content)
  }
}

function prepareProfile(plan) {
  mkdirSync(plan.profileRoot, { recursive: true })
  for (const [name, content] of plan.files) {
    writeManagedFile(resolve(plan.profileRoot, name), content)
  }
  return plan.profileRoot
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const patch = checkPatchedDshRoot(options.dshRoot)
  const links = discoverDshPackages(options.dshRoot)
  const plannedProfile = options.mode === 'preview' ? profilePlan(options.home) : undefined
  if (plannedProfile !== undefined) assertProfilePlanAvailable(plannedProfile)
  if (options.mode === 'check') {
    process.stdout.write(JSON.stringify({ ready: true, patch, packages: links.size }) + '\n')
    return
  }
  installSourceDependencies(options.dshRoot, links)
  if (options.mode === 'setup') {
    process.stdout.write(JSON.stringify({ ready: true, patch, packages: links.size }) + '\n')
    return
  }
  if (options.mode === 'verify') {
    buildPlugin()
    typecheckPlugin()
    checkLinkedSessionCapability()
    process.stdout.write(JSON.stringify({ ready: true, patch, packages: links.size, verified: true }) + '\n')
    return
  }
  ensureDshWebArtifacts(options.dshRoot)
  buildPlugin()
  const profileRoot = prepareProfile(plannedProfile)
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
