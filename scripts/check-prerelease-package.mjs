import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PACKAGE_NAME = '@hewzhew/dsh-agent-rp'
const REGISTRY = 'https://registry.npmjs.org/'
const VERSION_PATTERN = /^0\.0\.0-rc\.(?:0|[1-9]\d*)$/u
const EXPECTED_FILES = [
  'LICENSE',
  'lib/index.js',
  'lib/extension-v0.js',
  'lib/extension-v0.d.ts',
  'lib/client-extension-v0.js',
  'lib/client-extension-v0.d.ts',
  'lib/repair-session.js',
  'lib/client.js',
  'lib/client.js.map',
  'cordis.patch.yml',
  'docs',
  'preset',
]
const REQUIRED_TARBALL_FILES = [
  'package/LICENSE',
  'package/README.md',
  'package/cordis.patch.yml',
  'package/docs/troubleshooting.md',
  'package/lib/client-extension-v0.d.ts',
  'package/lib/client-extension-v0.js',
  'package/lib/client.js',
  'package/lib/client.js.map',
  'package/lib/extension-v0.d.ts',
  'package/lib/extension-v0.js',
  'package/lib/index.js',
  'package/lib/repair-session.js',
  'package/package.json',
  'package/preset/agent.cordis.yml',
  'package/preset/preset.yml',
]

function fail(message) {
  throw new Error(`Prerelease package check failed: ${message}`)
}

function parseArguments(arguments_) {
  const result = {}
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument !== '--tag' && argument !== '--tarball') fail(`unknown argument ${JSON.stringify(argument)}`)
    const value = arguments_[index + 1]
    if (value === undefined || value.startsWith('--')) fail(`${argument} requires a value`)
    result[argument.slice(2)] = value
    index += 1
  }
  return result
}

function validateManifest(manifest) {
  if (manifest.name !== PACKAGE_NAME) fail(`package name must be ${PACKAGE_NAME}`)
  if (!VERSION_PATTERN.test(manifest.version)) fail('version must match 0.0.0-rc.N')
  if (manifest.private !== false) fail('private must be explicitly false')
  if (manifest.license !== 'MIT') fail('license must be MIT')
  if (manifest.repository?.url !== 'git+https://github.com/hewzhew/dsh-agent-rp.git') {
    fail('repository must identify the public source repository')
  }
  if (manifest.publishConfig?.access !== 'public') fail('publishConfig.access must be public')
  if (manifest.publishConfig?.provenance !== true) fail('publishConfig.provenance must be true')
  if (manifest.publishConfig?.registry !== REGISTRY) fail(`publishConfig.registry must be ${REGISTRY}`)
  if (manifest.publishConfig?.tag !== 'next') fail('publishConfig.tag must be next')
  if (JSON.stringify(manifest.files) !== JSON.stringify(EXPECTED_FILES)) {
    fail('files must remain the reviewed package allowlist')
  }
}

function validateTag(version, tag) {
  if (tag !== undefined && tag !== `v${version}`) fail(`release tag must be v${version}, received ${tag}`)
}

function tar(arguments_) {
  const result = spawnSync('tar', arguments_, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error !== undefined) fail(`could not run tar: ${result.error.message}`)
  if (result.status !== 0) fail(`tar exited with ${String(result.status)}: ${result.stderr.trim()}`)
  return result.stdout
}

function validateTarball(tarball, sourceManifest, tag) {
  const archive = resolve(tarball)
  const entries = tar(['-tzf', archive]).split(/\r?\n/u).filter(Boolean)
  const uniqueEntries = new Set(entries)
  if (uniqueEntries.size !== entries.length) fail('tarball contains duplicate paths')
  for (const entry of entries) {
    if (!entry.startsWith('package/') || entry.includes('/../') || entry.includes('\\')) {
      fail(`tarball contains unsafe path ${JSON.stringify(entry)}`)
    }
    const allowed = REQUIRED_TARBALL_FILES.includes(entry)
      || /^package\/docs\/[^/]+\.md$/u.test(entry)
    if (!allowed) fail(`tarball contains unreviewed file ${JSON.stringify(entry)}`)
  }
  for (const required of REQUIRED_TARBALL_FILES) {
    if (!uniqueEntries.has(required)) fail(`tarball is missing ${required}`)
  }
  const packedManifest = JSON.parse(tar(['-xOzf', archive, 'package/package.json']))
  validateManifest(packedManifest)
  validateTag(packedManifest.version, tag)
  if (packedManifest.name !== sourceManifest.name || packedManifest.version !== sourceManifest.version) {
    fail('packed manifest identity differs from the source manifest')
  }
}

const options = parseArguments(process.argv.slice(2))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
validateManifest(manifest)
validateTag(manifest.version, options.tag)
if (options.tarball !== undefined) validateTarball(options.tarball, manifest, options.tag)

console.log(options.tarball === undefined
  ? `Prerelease manifest ${manifest.name}@${manifest.version} is publishable on the next tag.`
  : `Prerelease tarball ${manifest.name}@${manifest.version} matches the reviewed package policy.`)
