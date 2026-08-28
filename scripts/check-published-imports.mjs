import { builtinModules } from 'node:module'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
])
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)])
const missing = new Map()
const clientBuiltins = new Set()
let hostSource

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

for (const file of [
  '../lib/index.js',
  '../lib/extension-v0.js',
  '../lib/client-extension-v0.js',
  '../lib/repair-session.js',
  '../lib/client.js',
]) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  if (file === '../lib/index.js') hostSource = source
  const specifiers = [
    // Generated static imports/exports occupy complete lines. Anchoring keeps
    // documentation examples inside bundled dependency comments out of the
    // published dependency graph.
    ...source.matchAll(/^[ \t]*(?:import|export)\s+(?:[^'"\r\n]*?\s+from\s+)?["']([^"']+)["']/gmu),
    ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gu),
  ].map(match => match[1])

  for (const specifier of specifiers) {
    if (builtins.has(specifier)) {
      if (file === '../lib/client.js') clientBuiltins.add(specifier)
      continue
    }
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue
    const dependency = packageName(specifier)
    if (declared.has(dependency)) continue
    const locations = missing.get(dependency) ?? []
    locations.push(file.slice(3))
    missing.set(dependency, locations)
  }
}

if (hostSource === undefined || !/\bfrom\s+["']es-module-lexer\/js["']/u.test(hostSource)) {
  throw new Error('Published Host bundle must retain es-module-lexer/js as a declared runtime import')
}
if (hostSource.includes('"use asm"')) {
  throw new Error('Published Host bundle must not transform the es-module-lexer asm.js implementation')
}

const extension = await import('@hewzhew/dsh-agent-rp/extension/v0')
for (const name of [
  'AGENT_RP_EXTENSION_API_VERSION',
  'PLAY_WORLD_REGISTRY_KEY',
  'registerPlayWorldModule',
  'registerRoleplayResourceProvider',
  'registerRoleplayRuntimeExtension',
  'roleplayToolArtifactPresentationMeta',
]) {
  if (!(name in extension)) throw new Error(`Published extension/v0 export is missing ${name}`)
}
if (extension.AGENT_RP_EXTENSION_API_VERSION !== 0) {
  throw new Error('Published extension/v0 reports the wrong API version')
}

const clientExtension = await import('@hewzhew/dsh-agent-rp/client-extension/v0')
for (const name of ['AGENT_RP_CLIENT_EXTENSION_API_VERSION', 'AGENT_RP_WORKBENCH_SECTION_SLOT']) {
  if (!(name in clientExtension)) throw new Error(`Published client-extension/v0 export is missing ${name}`)
}
if (clientExtension.AGENT_RP_CLIENT_EXTENSION_API_VERSION !== 0
  || clientExtension.AGENT_RP_WORKBENCH_SECTION_SLOT !== 'agent-rp.workbench.section') {
  throw new Error('Published client-extension/v0 reports the wrong contract')
}

if (clientBuiltins.size > 0) {
  throw new Error(`Published client bundle imports Node builtins:\n${[...clientBuiltins].sort().join('\n')}`)
}

if (missing.size > 0) {
  const details = [...missing]
    .map(([dependency, files]) => `${dependency} (${[...new Set(files)].join(', ')})`)
    .join('\n')
  throw new Error(`Published bundles import undeclared packages:\n${details}`)
}

console.log('Published bundle imports are declared.')
