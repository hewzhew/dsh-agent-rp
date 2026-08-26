import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { CharacterLibrary } from '../src/character-library.ts'
import type { AgentRpHttpServer } from '../src/host-http.ts'
import type { ImportedTavernHelperScript } from '../src/import/types.ts'
import type { PresetLibrary } from '../src/preset-library.ts'
import { RoleplayResourceCatalog } from '../src/roleplay-resource-catalog.ts'
import { tavernResourceLibraryPreflightContributors } from '../src/tavern-resource-library-preflight.ts'
import { TavernResourcePreflightRegistry } from '../src/tavern-resource-preflight.ts'
import { TavernExecutionPlanCache } from '../src/tavern-preflight.ts'
import { installTavernExecutionHttp, installTavernPreflightHttp } from '../src/tavern-preflight-http.ts'
import { TAVERN_EXECUTION_PATH, TAVERN_PREFLIGHT_PATH } from '../src/tavern-preflight-protocol.ts'
import type { TavernScriptExecution } from '../src/tavern-script-resolver.ts'

type RegisteredRoute = Parameters<AgentRpHttpServer['register']>[0]

interface HttpResult {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly json: unknown
}

interface InvokeOptions {
  readonly method?: string
  readonly headers?: IncomingHttpHeaders
  readonly body?: string | Uint8Array | readonly Uint8Array[]
  readonly stream?: Readable
}

const PRIVATE_SCRIPT_SOURCE = 'PRIVATE_SCRIPT_SOURCE_MUST_NOT_LEAK'
const PRIVATE_CARD_BODY = 'PRIVATE_CARD_BODY_MUST_NOT_LEAK'
const PRIVATE_PROMPT = 'PRIVATE_PROMPT_MUST_NOT_LEAK'
const PRIVATE_PATH = 'C:\\private\\cards\\secret.json'

function script(id: string, content = `window.__private=${JSON.stringify(PRIVATE_SCRIPT_SOURCE)};`): ImportedTavernHelperScript {
  return {
    id,
    name: `script-${id}`,
    content,
    info: PRIVATE_PROMPT,
    enabled: true,
    buttonEnabled: false,
    buttons: [],
    data: { privateCardBody: PRIVATE_CARD_BODY },
  }
}

function testLibraries(
  characterScripts: readonly ImportedTavernHelperScript[] = [script('character-script')],
  presetScripts: readonly ImportedTavernHelperScript[] = [script('preset-script')],
): {
  readonly characters: CharacterLibrary
  readonly presets: PresetLibrary
} {
  const characters = {
    resolve(id: string) {
      if (id !== 'character-ok') throw new Error(`cannot read ${PRIVATE_PATH}`)
      return { card: { frontend: { tavernHelperScripts: characterScripts } } }
    },
  } as unknown as CharacterLibrary
  const presets = {
    get(id: string) {
      if (id !== 'preset-ok') throw new Error(`cannot read ${PRIVATE_PATH}`)
      return { preset: { tavernHelperScripts: presetScripts } }
    },
  } as unknown as PresetLibrary
  return { characters, presets }
}

function testResourceCatalog(): RoleplayResourceCatalog {
  const catalog = new RoleplayResourceCatalog()
  catalog.register({
    id: 'agent-rp:character-library',
    list: () => [{
      kind: 'actor', id: 'character:library:character-ok', name: '测试角色', availability: 'available',
    }],
  })
  catalog.register({
    id: 'agent-rp:preset-library',
    list: () => [{
      kind: 'prompt-policy', id: 'preset:library:preset-ok', name: '测试预设', availability: 'available',
    }],
  })
  catalog.register({
    id: 'test:peer-resources',
    list: () => [{
      kind: 'persona', id: 'persona-ok', name: '测试身份', availability: 'available',
    }, {
      kind: 'world', id: 'standalone:library:world-ok', name: '测试世界', availability: 'available',
    }],
  })
  return catalog
}

function testResourcePreflight(
  libraries: { readonly characters: CharacterLibrary; readonly presets: PresetLibrary },
): TavernResourcePreflightRegistry {
  const registry = new TavernResourcePreflightRegistry()
  for (const contributor of tavernResourceLibraryPreflightContributors(libraries)) registry.register(contributor)
  return registry
}

function registeredRoute(
  libraries: { readonly characters: CharacterLibrary; readonly presets: PresetLibrary } = testLibraries(),
  plans = new TavernExecutionPlanCache(),
  resources = testResourceCatalog(),
  resourcePreflight = testResourcePreflight(libraries),
): RegisteredRoute {
  let route: RegisteredRoute | undefined
  const ctx = {
    effect(register: () => unknown) { register() },
  } as unknown as Context
  const server: AgentRpHttpServer = {
    register(next) {
      route = next
      return () => {}
    },
  }
  installTavernPreflightHttp(
    ctx, libraries.characters, libraries.presets, resources, resourcePreflight, server, plans,
  )
  assert.ok(route)
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, TAVERN_PREFLIGHT_PATH)
  return route
}

function registeredExecutionRoute(
  libraries: { readonly characters: CharacterLibrary; readonly presets: PresetLibrary } = testLibraries(),
  plans = new TavernExecutionPlanCache(),
): RegisteredRoute {
  let route: RegisteredRoute | undefined
  const ctx = {
    effect(register: () => unknown) { register() },
  } as unknown as Context
  const server: AgentRpHttpServer = {
    register(next) {
      route = next
      return () => {}
    },
  }
  installTavernExecutionHttp(ctx, libraries.characters, libraries.presets, server, plans)
  assert.ok(route)
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, TAVERN_EXECUTION_PATH)
  return route
}

function responseCapture(): { readonly response: ServerResponse; readonly result: () => HttpResult } {
  let status: number | undefined
  let body = Buffer.alloc(0)
  const headers = new Map<string, string>()
  const target = {
    destroyed: false,
    writableEnded: false,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value))
      return target
    },
    writeHead(nextStatus: number, nextHeaders?: Readonly<Record<string, string | number | readonly string[]>>) {
      status = nextStatus
      for (const [name, value] of Object.entries(nextHeaders ?? {})) {
        headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value))
      }
      return target
    },
    end(chunk?: string | Uint8Array) {
      if (chunk !== undefined) body = Buffer.from(chunk)
      return target
    },
  }
  return {
    response: target as unknown as ServerResponse,
    result() {
      if (status === undefined) throw new Error('HTTP route did not write a status')
      const text = body.toString('utf8')
      return { status, headers: Object.fromEntries(headers), body: text, json: JSON.parse(text) as unknown }
    },
  }
}

function bodyChunks(body: InvokeOptions['body']): readonly Uint8Array[] {
  if (body === undefined) return []
  if (typeof body === 'string') return [Buffer.from(body)]
  if (body instanceof Uint8Array) return [body]
  return body
}

async function invoke(route: RegisteredRoute, options: InvokeOptions = {}): Promise<HttpResult> {
  const request = Object.assign(options.stream ?? Readable.from(bodyChunks(options.body)), {
    method: options.method ?? 'POST',
    headers: {
      host: '127.0.0.1:3091',
      origin: 'http://127.0.0.1:3091',
      'sec-fetch-site': 'same-origin',
      ...options.headers,
    } satisfies IncomingHttpHeaders,
  }) as unknown as IncomingMessage
  const capture = responseCapture()
  await route.handler(request, capture.response)
  return capture.result()
}

function request(overrides: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({ format: 0, characterId: 'character-ok', scriptApprovals: [], ...overrides })
}

function experienceRequest(overrides: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    format: 1,
    resources: [{ kind: 'actor', id: 'character:library:character-ok', variant: 'greeting:0' }],
    scriptApprovals: [],
    ...overrides,
  })
}

function executionRequest(overrides: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    format: 0,
    characterId: 'character-ok',
    scope: 'character',
    scriptId: 'character-script',
    approvedOrigins: [],
    ...overrides,
  })
}

function executionBatchRequest(
  entries: readonly Readonly<Record<string, unknown>>[],
  overrides: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    format: 1,
    characterId: 'character-ok',
    entries,
    ...overrides,
  })
}

function execution(source: string): TavernScriptExecution {
  return {
    source,
    mode: 'classic',
    inlineDependencies: [],
    preloads: [],
    needsDomPurify: false,
    needsFuse: false,
    moduleDependencies: [],
    compatibilityMarkers: [],
    remoteImageOrigins: [],
    remoteStyleOrigins: [],
    remoteStylesheetUrls: [],
    remoteFontOrigins: [],
    stylesheetDependencies: [],
    remoteFrameOrigins: [],
  }
}

test('registers a same-origin POST-only Tavern preflight route', async () => {
  const route = registeredRoute()
  const method = await invoke(route, { method: 'GET' })
  assert.equal(method.status, 405)
  assert.equal(method.headers.allow, 'POST')
  assert.deepEqual(method.json, { error: 'method not allowed' })

  for (const headers of [
    { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    { origin: 'https://attacker.example', 'sec-fetch-site': 'same-origin' },
    { host: '', origin: undefined },
  ]) {
    const forbidden = await invoke(route, { body: request(), headers })
    assert.equal(forbidden.status, 403)
    assert.deepEqual(forbidden.json, { error: 'forbidden' })
  }
})

test('returns and caches a Host-resolved execution graph without browser-side module fetching', async () => {
  const origin = 'https://execution-plan.example'
  const entry = `${origin}/entry.js`
  const libraries = testLibraries([script('character-script', `import value from '${entry}'; window.value=value;`)])
  const route = registeredExecutionRoute(libraries)
  const originalFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async input => {
    assert.equal(String(input), entry)
    fetches += 1
    return new Response('export default 42', {
      status: 200,
      headers: { 'content-type': 'text/javascript', 'content-length': '17' },
    })
  }
  try {
    const body = executionRequest({ approvedOrigins: [origin] })
    const first = await invoke(route, { body })
    const second = await invoke(route, { body })
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(fetches, 1)
    const result = first.json as {
      readonly format: number
      readonly execution: { readonly source: string; readonly moduleDependencies: readonly unknown[] }
    }
    assert.equal(result.format, 0)
    assert.doesNotMatch(result.execution.source, new RegExp(entry, 'u'))
    assert.equal(result.execution.moduleDependencies.length, 1)

    const approval = await invoke(route, { body: executionRequest() })
    assert.equal(approval.status, 409)
    assert.deepEqual(approval.json, { error: '脚本来源需要授权', requestedOrigin: origin })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('returns stable local details for expected script-resolution failures only', async () => {
  const libraries = testLibraries([
    script('character-script', 'const specifier = location.hash; import(specifier);'),
  ])
  const rejected = await invoke(registeredExecutionRoute(libraries), { body: executionRequest() })
  assert.equal(rejected.status, 422)
  assert.deepEqual(rejected.json, {
    error: '远程模块的动态 import 必须使用固定 HTTPS 地址',
    failure: 'dynamic-import-not-static',
  })

  const plans = new TavernExecutionPlanCache(async () => {
    throw new Error(PRIVATE_PATH)
  })
  const unexpected = await invoke(registeredExecutionRoute(libraries, plans), { body: executionRequest() })
  assert.equal(unexpected.status, 502)
  assert.deepEqual(unexpected.json, { error: '脚本执行计划暂时不可用' })
  assert.doesNotMatch(unexpected.body, /private|secret|stack|\\cards\\/iu)
})

test('preflights independent scripts concurrently while preserving library order', async () => {
  let active = 0
  let maximumActive = 0
  const plans = new TavernExecutionPlanCache(async source => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise(resolve => setTimeout(resolve, 15))
    active -= 1
    return execution(source)
  })
  const libraries = testLibraries([
    script('first', 'window.first=true'),
    script('second', 'window.second=true'),
    script('third', 'window.third=true'),
  ])
  const result = await invoke(registeredRoute(libraries, plans), { body: request() })
  assert.equal(result.status, 200)
  assert.equal(maximumActive, 3)
  assert.deepEqual((result.json as { readonly entries: readonly { readonly scriptId: string }[] }).entries
    .map(entry => entry.scriptId), ['first', 'second', 'third'])
})

test('resolves approved stylesheet fetches on the Host and discovers fonts before runtime', async () => {
  const stylesheetUrl = 'https://styles.example.test/theme.css'
  const stylesheetOrigin = 'https://styles.example.test'
  const fontOrigin = 'https://fonts.example.test'
  let reads = 0
  const plans = new TavernExecutionPlanCache(undefined, 64, {
    stylesheetReader: async url => {
      assert.equal(url.href, stylesheetUrl)
      reads += 1
      return {
        source: `@font-face{font-family:test;src:url("${fontOrigin}/test.woff2") format("woff2")}`,
        status: 200,
      }
    },
  })
  const libraries = testLibraries([
    script('character-script', `fetch(${JSON.stringify(stylesheetUrl)}).then(response=>response.text())`),
  ])
  const pending = await invoke(registeredRoute(libraries, plans), { body: request() })
  assert.equal(pending.status, 200)
  assert.equal(reads, 0)
  assert.deepEqual((pending.json as { readonly entries: readonly Record<string, unknown>[] }).entries[0], {
    scope: 'character', scriptId: 'character-script', scriptName: 'script-character-script', status: 'ready',
    remoteImageOrigins: [], remoteStyleOrigins: [stylesheetOrigin], remoteFontOrigins: [], remoteFrameOrigins: [],
  })

  const approved = await invoke(registeredRoute(libraries, plans), { body: request({
    scriptApprovals: [{
      scope: 'character', scriptId: 'character-script', origins: [], styleOrigins: [stylesheetOrigin],
    }],
  }) })
  assert.equal(approved.status, 200)
  assert.equal(reads, 1)
  assert.deepEqual((approved.json as { readonly entries: readonly Record<string, unknown>[] }).entries[0], {
    scope: 'character', scriptId: 'character-script', scriptName: 'script-character-script', status: 'ready',
    remoteImageOrigins: [], remoteStyleOrigins: [stylesheetOrigin], remoteFontOrigins: [fontOrigin],
    remoteFrameOrigins: [],
  })

  const executionResult = await invoke(registeredExecutionRoute(libraries, plans), {
    body: executionRequest({ approvedStyleOrigins: [stylesheetOrigin] }),
  })
  assert.equal(executionResult.status, 200)
  const resolved = (executionResult.json as { readonly execution: TavernScriptExecution }).execution
  assert.deepEqual(resolved.stylesheetDependencies, [{
    url: stylesheetUrl,
    source: `@font-face{font-family:test;src:url("${fontOrigin}/test.woff2") format("woff2")}`,
    status: 200,
  }])
})

test('keeps an approved HTTP stylesheet failure inside the script fallback path', async () => {
  const stylesheetUrl = 'https://styles.example.test/missing.css'
  const stylesheetOrigin = 'https://styles.example.test'
  const plans = new TavernExecutionPlanCache(undefined, 64, {
    stylesheetReader: async () => ({ source: 'not found', status: 404 }),
  })
  const libraries = testLibraries([
    script('character-script', `fetch(${JSON.stringify(stylesheetUrl)}).then(response=>response.ok)`),
  ])
  const approved = await invoke(registeredRoute(libraries, plans), { body: request({
    scriptApprovals: [{
      scope: 'character', scriptId: 'character-script', origins: [], styleOrigins: [stylesheetOrigin],
    }],
  }) })
  assert.equal(approved.status, 200)
  assert.deepEqual((approved.json as { readonly entries: readonly Record<string, unknown>[] }).entries[0], {
    scope: 'character', scriptId: 'character-script', scriptName: 'script-character-script', status: 'ready',
    remoteImageOrigins: [], remoteStyleOrigins: [stylesheetOrigin], remoteFontOrigins: [], remoteFrameOrigins: [],
  })
  const executionResult = await invoke(registeredExecutionRoute(libraries, plans), {
    body: executionRequest({ approvedStyleOrigins: [stylesheetOrigin] }),
  })
  assert.equal(executionResult.status, 200)
  assert.deepEqual(
    (executionResult.json as { readonly execution: TavernScriptExecution }).execution.stylesheetDependencies,
    [{ url: stylesheetUrl, source: 'not found', status: 404 }],
  )
})

test('reuses successful preflight plans for runtime despite explicit built-in origins', async () => {
  const calls: { readonly source: string; readonly origins: readonly string[] }[] = []
  const plans = new TavernExecutionPlanCache(async (source, _signal, origins = []) => {
    calls.push({ source, origins })
    return execution(source)
  })
  let characterReads = 0
  let cacheHitRequired = true
  const base = testLibraries()
  const libraries = {
    characters: {
      resolve(id: string) {
        characterReads += 1
        if (cacheHitRequired && characterReads > 1) {
          throw new Error('runtime must reuse the preflight plan before reading the card')
        }
        return base.characters.resolve(id)
      },
    } as unknown as CharacterLibrary,
    presets: base.presets,
  }
  const preflight = await invoke(registeredRoute(libraries, plans), { body: request() })
  assert.equal(preflight.status, 200)
  const runtime = await invoke(registeredExecutionRoute(libraries, plans), {
    body: executionRequest({
      approvedOrigins: ['https://testingcf.jsdelivr.net', 'https://cdn.jsdelivr.net'],
    }),
  })
  assert.equal(runtime.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(characterReads, 1)
  assert.deepEqual(calls[0]?.origins, ['https://cdn.jsdelivr.net', 'https://testingcf.jsdelivr.net'])

  cacheHitRequired = false
  const expandedGrant = await invoke(registeredExecutionRoute(libraries, plans), {
    body: executionRequest({ approvedOrigins: ['https://additional.example'] }),
  })
  assert.equal(expandedGrant.status, 200)
  assert.equal(calls.length, 2)
  assert.equal(characterReads, 2)
  assert.deepEqual(calls[1]?.origins, [
    'https://additional.example', 'https://cdn.jsdelivr.net', 'https://testingcf.jsdelivr.net',
  ])
})

test('keeps equal script ids isolated between character and preset owners', async () => {
  const calls: string[] = []
  const plans = new TavernExecutionPlanCache(async source => {
    calls.push(source)
    return execution(source)
  })
  const libraries = testLibraries(
    [script('shared-script', 'window.owner="character"')],
    [script('shared-script', 'window.owner="preset"')],
  )
  const preflight = await invoke(registeredRoute(libraries, plans), {
    body: request({ presetId: 'preset-ok' }),
  })
  assert.equal(preflight.status, 200)
  assert.deepEqual(calls, ['window.owner="character"', 'window.owner="preset"'])

  const character = await invoke(registeredExecutionRoute(libraries, plans), {
    body: executionRequest({ scriptId: 'shared-script' }),
  })
  const preset = await invoke(registeredExecutionRoute(libraries, plans), {
    body: executionRequest({
      characterId: undefined,
      presetId: 'preset-ok',
      scope: 'preset',
      scriptId: 'shared-script',
    }),
  })
  assert.equal(character.status, 200)
  assert.equal(preset.status, 200)
  assert.equal(calls.length, 2)
  assert.equal((character.json as { readonly execution: TavernScriptExecution }).execution.source, 'window.owner="character"')
  assert.equal((preset.json as { readonly execution: TavernScriptExecution }).execution.source, 'window.owner="preset"')
})

test('returns an exact preflight cache batch through one execution request', async () => {
  let resolutions = 0
  const plans = new TavernExecutionPlanCache(async source => {
    resolutions += 1
    return execution(source)
  })
  const libraries = testLibraries([
    script('first', 'window.first=true'),
    script('second', 'window.second=true'),
  ])
  const preflight = await invoke(registeredRoute(libraries, plans), { body: request() })
  assert.equal(preflight.status, 200)
  assert.equal(resolutions, 2)

  const entries = [
    { scope: 'character', scriptId: 'first', approvedOrigins: ['https://cdn.jsdelivr.net'] },
    { scope: 'character', scriptId: 'second', approvedOrigins: ['https://testingcf.jsdelivr.net'] },
  ]
  const batch = await invoke(registeredExecutionRoute(libraries, plans), {
    body: executionBatchRequest(entries),
  })
  assert.equal(batch.status, 200)
  assert.deepEqual(batch.json, {
    format: 1,
    status: 'hit',
    entries: [{
      scope: 'character', scriptId: 'first', execution: execution('window.first=true'),
    }, {
      scope: 'character', scriptId: 'second', execution: execution('window.second=true'),
    }],
  })
  assert.equal(resolutions, 2)

  const miss = await invoke(registeredExecutionRoute(libraries, plans), {
    body: executionBatchRequest([
      entries[0]!,
      { ...entries[1]!, approvedOrigins: ['https://additional.example'] },
    ]),
  })
  assert.equal(miss.status, 200)
  assert.deepEqual(miss.json, { format: 1, status: 'miss', entries: [] })
  assert.equal(resolutions, 2)
})

test('does not retain failed execution resolutions', async () => {
  let calls = 0
  const plans = new TavernExecutionPlanCache(async source => {
    calls += 1
    if (calls === 1) throw new Error('temporary resolution failure')
    return execution(source)
  })
  const libraries = testLibraries()
  const first = await invoke(registeredExecutionRoute(libraries, plans), { body: executionRequest() })
  const second = await invoke(registeredExecutionRoute(libraries, plans), { body: executionRequest() })
  assert.equal(first.status, 502)
  assert.equal(second.status, 200)
  assert.equal(calls, 2)
})

test('invalidates an older successful plan when the source changes under one owner id', async () => {
  let calls = 0
  const plans = new TavernExecutionPlanCache(async source => {
    calls += 1
    if (source === 'window.version=3') throw new Error('new source is invalid')
    return execution(source)
  })
  const identity = {
    scope: 'character' as const,
    ownerId: 'character-ok',
    scriptId: 'mutable-script',
    approvedOrigins: [] as readonly string[],
  }
  const signal = AbortSignal.timeout(5_000)
  assert.equal((await plans.resolve(identity, 'window.version=1', signal)).source, 'window.version=1')
  assert.equal((await plans.resolve(identity, 'window.version=1', signal)).source, 'window.version=1')
  assert.equal(calls, 1)
  assert.equal((await plans.resolve(identity, 'window.version=2', signal)).source, 'window.version=2')
  assert.equal(calls, 2)
  await assert.rejects(plans.resolve(identity, 'window.version=3', signal), /new source is invalid/u)
  assert.equal(calls, 3)
  assert.equal(plans.get(identity), undefined)
})

test('reuses an exact successful execution plan across fresh Host cache instances', async context => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-tavern-plan-cache-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  let resolutions = 0
  const resolver = async (source: string): Promise<TavernScriptExecution> => {
    resolutions += 1
    return execution(source)
  }
  const identity = {
    scope: 'character' as const,
    ownerId: 'persistent-character',
    scriptId: 'persistent-script',
    approvedOrigins: ['https://modules.example'] as readonly string[],
  }
  const cacheOptions = { persistentRoot: root, maximumEntries: 2 }
  const first = new TavernExecutionPlanCache(resolver, 64, cacheOptions)
  assert.equal((await first.resolve(identity, 'window.persisted=true', AbortSignal.timeout(5_000))).source,
    'window.persisted=true')
  assert.equal(resolutions, 1)
  assert.equal(readdirSync(root).filter(name => name.endsWith('.json')).length, 1)

  const afterRestart = new TavernExecutionPlanCache(resolver, 64, cacheOptions)
  assert.equal((await afterRestart.resolve(identity, 'window.persisted=true', AbortSignal.timeout(5_000))).source,
    'window.persisted=true')
  assert.equal(resolutions, 1)

  await afterRestart.resolve({ ...identity, approvedOrigins: ['https://expanded.example'] },
    'window.persisted=true', AbortSignal.timeout(5_000))
  await afterRestart.resolve(identity, 'window.persisted="changed"', AbortSignal.timeout(5_000))
  assert.equal(resolutions, 3)
  assert.equal(readdirSync(root).filter(name => name.endsWith('.json')).length, 2)
})

test('expires and repairs disposable execution-plan files without blocking script resolution', async context => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-tavern-plan-repair-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  let now = 1_000
  let resolutions = 0
  const resolver = async (source: string): Promise<TavernScriptExecution> => {
    resolutions += 1
    return execution(source)
  }
  const options = { persistentRoot: root, maxAgeMs: 100, now: () => now }
  const identity = {
    scope: 'preset' as const,
    ownerId: 'persistent-preset',
    scriptId: 'repair-script',
    approvedOrigins: [] as readonly string[],
  }
  await new TavernExecutionPlanCache(resolver, 64, options)
    .resolve(identity, 'window.repair=true', AbortSignal.timeout(5_000))
  const [cacheFile] = readdirSync(root).filter(name => name.endsWith('.json'))
  assert.ok(cacheFile)
  writeFileSync(join(root, cacheFile), '{broken', 'utf8')
  await new TavernExecutionPlanCache(resolver, 64, options)
    .resolve(identity, 'window.repair=true', AbortSignal.timeout(5_000))
  assert.equal(resolutions, 2)

  now = 1_101
  await new TavernExecutionPlanCache(resolver, 64, options)
    .resolve(identity, 'window.repair=true', AbortSignal.timeout(5_000))
  assert.equal(resolutions, 3)
})

test('preflights and executes a preset without requiring a character card', async () => {
  const preflight = await invoke(registeredRoute(), {
    body: request({ characterId: undefined, presetId: 'preset-ok' }),
  })
  assert.equal(preflight.status, 200)
  assert.deepEqual(preflight.json, {
    format: 0,
    scripts: 1,
    ready: 1,
    permissionRequired: 0,
    failed: 0,
    entries: [{
      scope: 'preset', scriptId: 'preset-script', scriptName: 'script-preset-script',
      status: 'ready', remoteImageOrigins: [], remoteStyleOrigins: [], remoteFontOrigins: [], remoteFrameOrigins: [],
    }],
  })

  const execution = await invoke(registeredExecutionRoute(), {
    body: executionRequest({
      characterId: undefined,
      presetId: 'preset-ok',
      scope: 'preset',
      scriptId: 'preset-script',
    }),
  })
  assert.equal(execution.status, 200)
  assert.equal((execution.json as { readonly format: number }).format, 0)
})

test('preflights one native experience through its complete source-neutral resource selection', async () => {
  const result = await invoke(registeredRoute(), {
    body: experienceRequest({
      resources: [
        { kind: 'actor', id: 'character:library:character-ok', variant: 'greeting:2' },
        { kind: 'persona', id: 'persona-ok' },
        { kind: 'world', id: 'standalone:library:world-ok' },
        { kind: 'prompt-policy', id: 'preset:library:preset-ok' },
      ],
    }),
  })
  assert.equal(result.status, 200)
  assert.deepEqual(result.json, {
    format: 0,
    scripts: 2,
    ready: 2,
    permissionRequired: 0,
    failed: 0,
    entries: [{
      scope: 'character', scriptId: 'character-script', scriptName: 'script-character-script',
      status: 'ready', remoteImageOrigins: [], remoteStyleOrigins: [], remoteFontOrigins: [], remoteFrameOrigins: [],
    }, {
      scope: 'preset', scriptId: 'preset-script', scriptName: 'script-preset-script',
      status: 'ready', remoteImageOrigins: [], remoteStyleOrigins: [], remoteFontOrigins: [], remoteFrameOrigins: [],
    }],
  })
})

test('dispatches native preflight by resource provider ownership without inspecting opaque ids', async () => {
  const catalog = new RoleplayResourceCatalog()
  catalog.register({
    id: 'community:actor-provider',
    list: () => [{ kind: 'actor', id: 'opaque-community-actor', name: '社区角色', availability: 'available' }],
  })
  const registry = new TavernResourcePreflightRegistry()
  registry.register({
    providerId: 'community:actor-provider',
    resolve: input => {
      assert.equal(Object.isFrozen(input), true)
      assert.deepEqual(input.selection, { kind: 'actor', id: 'opaque-community-actor', variant: 'opening:night' })
      return { scope: 'character', ownerId: 'community-owner', scripts: [script('community-script')] }
    },
  })
  const result = await invoke(registeredRoute(
    testLibraries(), new TavernExecutionPlanCache(), catalog, registry,
  ), {
    body: experienceRequest({ resources: [{
      kind: 'actor', id: 'opaque-community-actor', variant: 'opening:night',
    }] }),
  })
  assert.equal(result.status, 200)
  assert.deepEqual(result.json, {
    format: 0,
    scripts: 1,
    ready: 1,
    permissionRequired: 0,
    failed: 0,
    entries: [{
      scope: 'character', scriptId: 'community-script', scriptName: 'script-community-script',
      status: 'ready', remoteImageOrigins: [], remoteStyleOrigins: [], remoteFontOrigins: [], remoteFrameOrigins: [],
    }],
  })
})

test('revokes provider adapters safely and rejects ambiguous Tavern scopes', () => {
  const catalog = new RoleplayResourceCatalog()
  catalog.register({
    id: 'community:actor-provider',
    list: () => [{ kind: 'actor', id: 'actor-a', name: '角色 A', availability: 'available' }],
  })
  catalog.register({
    id: 'community:actor-provider-b',
    list: () => [{ kind: 'actor', id: 'actor-b', name: '角色 B', availability: 'available' }],
  })
  catalog.register({
    id: 'community:world-provider',
    list: () => [{ kind: 'world', id: 'world-a', name: '世界 A', availability: 'available' }],
  })
  const registry = new TavernResourcePreflightRegistry()
  const first = registry.register({
    providerId: 'community:actor-provider',
    resolve: () => ({ scope: 'character', ownerId: 'actor-owner', scripts: [] }),
  })
  assert.throws(() => registry.register({
    providerId: 'community:actor-provider', resolve: () => undefined,
  }), /already registered/u)
  first()
  registry.register({
    providerId: 'community:actor-provider',
    resolve: () => ({ scope: 'character', ownerId: 'actor-owner-next', scripts: [] }),
  })
  first()
  assert.equal(registry.resolve(catalog, [{ kind: 'actor', id: 'actor-a' }])[0]?.ownerId, 'actor-owner-next')
  registry.register({
    providerId: 'community:actor-provider-b',
    resolve: () => ({ scope: 'character', ownerId: 'actor-owner-b', scripts: [] }),
  })
  assert.throws(() => registry.resolve(catalog, [
    { kind: 'actor', id: 'actor-a' }, { kind: 'actor', id: 'actor-b' },
  ]), /More than one selected Roleplay resource contributes Tavern scope "character"/u)
  registry.register({
    providerId: 'community:world-provider',
    resolve: () => ({ scope: 'preset', ownerId: 'world-owner', scripts: [] }),
  })
  assert.throws(() => registry.resolve(catalog, [
    { kind: 'world', id: 'world-a' },
  ]), /returned scope "preset" for "world"/u)
})

test('rejects malformed, duplicate, unavailable, and mismatched experience resources', async () => {
  const route = registeredRoute()
  const cases = [{
    body: experienceRequest({ resources: [] }), error: '权限预检请求无效',
  }, {
    body: experienceRequest({ resources: [
      { kind: 'actor', id: 'character:library:character-ok' },
      { kind: 'actor', id: 'character:library:other' },
    ] }), error: '权限预检包含多个 actor 资源',
  }, {
    body: experienceRequest({ resources: [
      { kind: 'world', id: 'standalone:library:world-ok' },
      { kind: 'world', id: 'standalone:library:world-ok' },
    ] }), error: '权限预检包含重复资源',
  }, {
    body: experienceRequest({ resources: Array.from({ length: 17 }, (_, index) => ({
      kind: 'world', id: `standalone:library:world-${index}`,
    })) }), error: '权限预检包含过多 world 资源',
  }, {
    body: experienceRequest({ resources: [
      { kind: 'world', id: 'standalone:library:missing' },
    ] }), error: '体验资源不可用：world',
  }, {
    body: experienceRequest({
      resources: [{ kind: 'world', id: 'standalone:library:world-ok' }],
      scriptApprovals: [{ scope: 'preset', scriptId: 'preset-script', origins: [] }],
    }), error: '脚本授权 1 不属于所选资源',
  }, {
    body: experienceRequest({ resources: [{
      kind: 'actor', id: 'character:library:character-ok', privateField: true,
    }] }), error: '体验资源 1 无效',
  }]
  for (const item of cases) {
    const result = await invoke(route, { body: item.body })
    assert.equal(result.status, 400)
    assert.deepEqual(result.json, { error: item.error })
  }
})

test('rejects empty preflight selections and approvals outside the selected resources', async () => {
  const route = registeredRoute()
  const empty = await invoke(route, { body: request({ characterId: undefined }) })
  assert.equal(empty.status, 400)
  assert.deepEqual(empty.json, { error: '权限预检没有可检查的资源' })

  const foreignApproval = await invoke(route, {
    body: request({
      characterId: undefined,
      presetId: 'preset-ok',
      scriptApprovals: [{ scope: 'character', scriptId: 'character-script', origins: [] }],
    }),
  })
  assert.equal(foreignApproval.status, 400)
  assert.deepEqual(foreignApproval.json, { error: '脚本授权 1 不属于所选资源' })

  const characterExecution = await invoke(registeredExecutionRoute(), {
    body: executionRequest({ characterId: undefined }),
  })
  assert.equal(characterExecution.status, 400)
  assert.deepEqual(characterExecution.json, { error: '角色卡 id 无效' })
})

test('bounds declared and streamed Tavern preflight request bodies', async () => {
  const route = registeredRoute()
  const declared = await invoke(route, {
    body: request(),
    headers: { 'content-length': String(64 * 1024 + 1) },
  })
  assert.equal(declared.status, 413)
  assert.deepEqual(declared.json, { error: '权限预检请求过大' })

  const streamed = await invoke(route, { body: Buffer.alloc(64 * 1024 + 1, 0x20) })
  assert.equal(streamed.status, 413)
  assert.deepEqual(streamed.json, { error: '权限预检请求过大' })
})

test('rejects malformed requests before accessing character or preset content', async () => {
  const route = registeredRoute()
  const cases = [
    { body: '{', error: '权限预检请求不是有效 JSON' },
    { body: JSON.stringify([]), error: '权限预检请求无效' },
    { body: request({ format: 1 }), error: '权限预检请求无效' },
    { body: request({ characterId: '../secret' }), error: '角色卡 id 无效' },
    { body: request({ presetId: 'folder/secret' }), error: '预设 id 无效' },
  ]
  for (const item of cases) {
    const result = await invoke(route, { body: item.body })
    assert.equal(result.status, 400)
    assert.deepEqual(result.json, { error: item.error })
  }
})

test('bounds approval counts and origins per script', async () => {
  const route = registeredRoute()
  const approval = (index: number, origins: readonly string[] = []) => ({
    scope: index % 2 === 0 ? 'character' : 'preset',
    scriptId: `script-${index}`,
    origins,
  })
  const accepted = await invoke(route, {
    body: request({
      scriptApprovals: Array.from({ length: 256 }, (_, index) => approval(index)),
      presetId: 'preset-ok',
    }),
  })
  assert.equal(accepted.status, 200)

  const tooManyApprovals = await invoke(route, {
    body: request({ scriptApprovals: Array.from({ length: 257 }, (_, index) => approval(index)) }),
  })
  assert.equal(tooManyApprovals.status, 400)
  assert.deepEqual(tooManyApprovals.json, { error: '权限预检请求无效' })

  const acceptedOrigins = await invoke(route, {
    body: request({ scriptApprovals: [approval(0, Array.from(
      { length: 32 }, (_, index) => `https://origin-${index}.example`,
    ))] }),
  })
  assert.equal(acceptedOrigins.status, 200)

  const tooManyOrigins = await invoke(route, {
    body: request({ scriptApprovals: [approval(0, Array.from(
      { length: 33 }, (_, index) => `https://origin-${index}.example`,
    ))] }),
  })
  assert.equal(tooManyOrigins.status, 400)
  assert.deepEqual(tooManyOrigins.json, { error: '脚本授权 1 无效' })
})

test('accepts only exact credential-free HTTPS origins', async () => {
  const route = registeredRoute()
  const exact = await invoke(route, {
    body: request({ scriptApprovals: [{
      scope: 'character', scriptId: 'character-script', origins: ['https://modules.example:8443'],
    }] }),
  })
  assert.equal(exact.status, 200)

  for (const origin of [
    'http://modules.example',
    'https://user:secret@modules.example',
    'https://modules.example/',
    'https://modules.example/path',
    'https://modules.example?query=1',
    'not a URL',
  ]) {
    const invalid = await invoke(route, {
      body: request({ scriptApprovals: [{ scope: 'character', scriptId: 'character-script', origins: [origin] }] }),
    })
    assert.equal(invalid.status, 400)
    assert.deepEqual(invalid.json, { error: '脚本来源授权无效' })
  }
})

test('uses stable library and request-stream errors without exposing local details', async () => {
  const route = registeredRoute()
  const missingCharacter = await invoke(route, { body: request({ characterId: 'missing-character' }) })
  assert.equal(missingCharacter.status, 400)
  assert.deepEqual(missingCharacter.json, { error: '角色卡不可用' })

  const missingPreset = await invoke(route, { body: request({ presetId: 'missing-preset' }) })
  assert.equal(missingPreset.status, 400)
  assert.deepEqual(missingPreset.json, { error: '预设不可用' })

  const failedStream = Readable.from((async function* () {
    yield Buffer.from('{')
    throw new Error(`aborted while reading ${PRIVATE_PATH}`)
  })())
  const interrupted = await invoke(route, { stream: failedStream })
  assert.equal(interrupted.status, 400)
  assert.deepEqual(interrupted.json, { error: '权限预检请求读取失败' })

  for (const result of [missingCharacter, missingPreset, interrupted]) {
    assert.doesNotMatch(result.body, /private|secret|stack|\\cards\\/iu)
  }
})

test('returns only the static resource plan, never script source, card content, prompts, or resolver errors', async () => {
  const resolverError = 'PRIVATE_RESOLVER_ERROR_MUST_NOT_LEAK'
  const route = registeredRoute(testLibraries([
    script('ready-script'),
    script('failed-script', 'const specifier=location.hash; import(specifier);'),
    script('remote-failed-script', "import 'https://cdn.jsdelivr.net/gh/dsh-agent-rp/preflight-private-error@0.0.0/bundle.js';"),
  ]))
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error(resolverError))
  let result: HttpResult
  try {
    result = await invoke(route, { body: request() })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(result.status, 200)
  assert.deepEqual(result.json, {
    format: 0,
    scripts: 3,
    ready: 1,
    permissionRequired: 0,
    failed: 2,
    entries: [{
      scope: 'character', scriptId: 'ready-script', scriptName: 'script-ready-script',
      status: 'ready', remoteImageOrigins: [], remoteStyleOrigins: [], remoteFontOrigins: [], remoteFrameOrigins: [],
    }, {
      scope: 'character', scriptId: 'failed-script', scriptName: 'script-failed-script',
      status: 'resolution-error', failure: 'script-resolution-failed', detail: '脚本无法完成静态解析',
      remoteImageOrigins: [], remoteStyleOrigins: [], remoteFontOrigins: [], remoteFrameOrigins: [],
    }, {
      scope: 'character', scriptId: 'remote-failed-script', scriptName: 'script-remote-failed-script',
      status: 'resolution-error', failure: 'script-resolution-failed', detail: '脚本无法完成静态解析',
      remoteImageOrigins: [], remoteStyleOrigins: [], remoteFontOrigins: [], remoteFrameOrigins: [],
    }],
  })
  for (const privateValue of [PRIVATE_SCRIPT_SOURCE, PRIVATE_CARD_BODY, PRIVATE_PROMPT, resolverError, PRIVATE_PATH]) {
    assert.doesNotMatch(result.body, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
})

test('hides unexpected implementation errors behind a stable server response', async () => {
  const characters = {
    resolve() {
      return Object.defineProperty({}, 'card', {
        get() { throw new Error(`unexpected failure in ${PRIVATE_PATH}`) },
      })
    },
  } as unknown as CharacterLibrary
  const result = await invoke(registeredRoute({ characters, presets: testLibraries().presets }), { body: request() })
  assert.equal(result.status, 500)
  assert.deepEqual(result.json, { error: '权限预检暂时不可用' })
  assert.doesNotMatch(result.body, /private|secret|stack|\\cards\\/iu)
})
