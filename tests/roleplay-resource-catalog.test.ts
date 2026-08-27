import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CharacterLibrary } from '../src/character-library.ts'
import type { AgentRpHttpServer } from '../src/host-http.ts'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import type { ImportedSillyTavernPreset } from '../src/import/sillytavern-preset.ts'
import { PersonaLibrary } from '../src/persona-library.ts'
import { PresetLibrary } from '../src/preset-library.ts'
import {
  registerRoleplayResourceProvider,
  ROLEPLAY_RESOURCE_CATALOG_KEY,
  RoleplayResourceCatalog,
} from '../src/roleplay-resource-catalog.ts'
import { installRoleplayResourceCatalogHttp } from '../src/roleplay-resource-catalog-http.ts'
import {
  characterLibraryRoleplayResourceId,
  presetLibraryRoleplayResourceId,
  roleplayLibraryResourceProviders,
  worldInfoLibraryRoleplayResourceId,
} from '../src/roleplay-resource-library-providers.ts'
import { ROLEPLAY_RESOURCE_CATALOG_PATH } from '../src/roleplay-resource-catalog-protocol.ts'
import { prepareAgentRpSession } from '../src/session-launch.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import { SillyTavernChatLibrary } from '../src/sillytavern-chat-library.ts'
import { resolveConfig } from '../src/config.ts'
import { WorldInfoLibrary } from '../src/world-info-library.ts'

type RegisteredRoute = Parameters<AgentRpHttpServer['register']>[0]

function fixtureRoot(context: test.TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-resource-catalog-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  return root
}

test('orders providers deterministically, rejects collisions, and follows Cordis ownership', async () => {
  const root = new Context()
  const catalog = new RoleplayResourceCatalog()
  root.provide(ROLEPLAY_RESOURCE_CATALOG_KEY, catalog)
  registerRoleplayResourceProvider(root, {
    id: 'fixture:z',
    list: () => [{
      id: 'world:z', kind: 'world', name: '终点世界', availability: 'available',
    }],
  })
  registerRoleplayResourceProvider(root, {
    id: 'fixture:a',
    list: () => [{
      id: 'actor:a', kind: 'actor', name: '起点角色', availability: 'available', updatedAt: 1,
    }],
  })
  assert.deepEqual(catalog.list().map(value => [value.kind, value.id]), [
    ['actor', 'actor:a'], ['world', 'world:z'],
  ])
  assert.deepEqual(catalog.get('actor', 'actor:a'), {
    id: 'actor:a', kind: 'actor', name: '起点角色', availability: 'available', updatedAt: 1,
  })
  assert.deepEqual(catalog.locate('actor', 'actor:a'), {
    providerId: 'fixture:a',
    descriptor: {
      id: 'actor:a', kind: 'actor', name: '起点角色', availability: 'available', updatedAt: 1,
    },
  })
  assert.equal(catalog.locate('actor', 'actor:missing'), undefined)

  const duplicate = catalog.register({
    id: 'fixture:duplicate',
    list: () => [{
      id: 'world:z', kind: 'world', name: '冲突世界', availability: 'available',
    }],
  })
  assert.throws(() => catalog.list(), /published by both/u)
  duplicate()
  await root.fiber.dispose()
  assert.deepEqual(catalog.list(), [])
})

test('dispatches materialization to the owner while enforcing append-only Session logs', () => {
  const catalog = new RoleplayResourceCatalog()
  catalog.register({
    id: 'fixture:actor-materializer',
    list: () => [{ id: 'actor:seed', kind: 'actor', name: '种子角色', availability: 'available' }],
    materialize: () => ({
      title: '种子角色',
      events: [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }, {
        type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
      }],
    }),
  })
  const first = catalog.materialize(
    { kind: 'actor', id: 'actor:seed' },
    [],
    { mode: 'character', participantName: '旅人' },
  )
  assert.equal(first.title, '种子角色')
  assert.deepEqual(first.events.map(event => event.seq), [0, 1])

  catalog.register({
    id: 'fixture:world-no-op',
    list: () => [{ id: 'world:existing', kind: 'world', name: '已有世界', availability: 'available' }],
    materialize: input => ({ events: input.events }),
  })
  assert.deepEqual(catalog.materialize(
    { kind: 'world', id: 'world:existing' },
    first.events,
    { mode: 'character' },
  ).events, first.events)

  catalog.register({
    id: 'fixture:world-rewriter',
    list: () => [{ id: 'world:rewrite', kind: 'world', name: '错误世界', availability: 'available' }],
    materialize: input => ({ events: input.events.slice(1) }),
  })
  assert.throws(() => catalog.materialize(
    { kind: 'world', id: 'world:rewrite' },
    first.events,
    { mode: 'character' },
  ), /must only append/u)
})

test('rejects provider detail payloads that try to escape the bounded protocol', () => {
  const catalog = new RoleplayResourceCatalog()
  catalog.register({
    id: 'fixture:leaky-details',
    list: () => [{ id: 'actor:leaky', kind: 'actor', name: '泄漏角色', availability: 'available' }],
    inspect: () => ({
      kind: 'actor', openings: [], rawCharacterCard: { secret: true },
    } as unknown as import('../src/roleplay-resource-catalog-protocol.ts').RoleplayResourceDetail),
  })
  assert.throws(() => catalog.inspect('actor', 'actor:leaky'), /invalid openings/u)
})

test('maps all reusable Host libraries onto the exact references written into a Session', (context) => {
  const root = fixtureRoot(context)
  const characters = new CharacterLibrary({ root: join(root, 'characters') })
  const personas = new PersonaLibrary({ root: join(root, 'personas') })
  const presets = new PresetLibrary({ root: join(root, 'presets') })
  const worlds = new WorldInfoLibrary({ root: join(root, 'worlds') })
  const chats = new SillyTavernChatLibrary({ root: join(root, 'chats') })

  const cardSource = JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '白露', description: '钟表匠', personality: '沉静', scenario: '海城',
      first_mes: '门还没锁。', mes_example: '', creator_notes: '', system_prompt: '',
      post_history_instructions: '', alternate_greetings: [], tags: [], creator: 'fixture',
      character_version: '1', extensions: {},
    },
  })
  const cardBytes = new TextEncoder().encode(cardSource)
  const card = characters.import({
    data: cardBytes,
    filename: '白露.json',
    mediaType: 'application/json',
    card: parseCharacterCardJson(cardSource),
    transport: { transport: 'json' },
  })
  const persona = personas.save({ format: 0, name: '小满', description: '刚到海城的旅人。' })
  const presetValue: ImportedSillyTavernPreset = {
    format: 0,
    name: '潮汐策略',
    prompts: [{
      identifier: 'chatHistory', name: '历史', role: 'system', content: '', marker: true,
      systemPrompt: true, forbidOverrides: false,
    }],
    order: [{ identifier: 'chatHistory', enabled: true }],
    generation: {},
    formats: { worldInfo: '{0}', scenario: '{{scenario}}', personality: '{{personality}}' },
    regexScripts: [],
    extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: false },
  }
  const preset = presets.import(presetValue)
  const world = worlds.importFile({
    filename: '海城.json',
    data: new TextEncoder().encode(JSON.stringify({
      name: '海城',
      entries: {
        0: {
          uid: 0, key: [], keysecondary: [], content: '海城终年多雾。', constant: true,
          selective: false, order: 1, position: 0, disable: false,
        },
      },
    })),
  })

  const catalog = new RoleplayResourceCatalog()
  for (const provider of roleplayLibraryResourceProviders({ characters, personas, presets, worldInfos: worlds })) {
    catalog.register(provider)
  }
  const prepared = prepareAgentRpSession(characters, chats, presets, worlds, {
    format: 0,
    sourceSessionId: 'fixture-source',
    kind: 'character',
    characterId: card.id,
    greetingIndex: 0,
    persona: { id: persona.id, name: persona.name, description: persona.description },
    presetId: preset.id,
    worldInfoIds: [world.id],
  })
  const runtime = resolveSessionRoleplayRuntime({
    session: Session.create(SessionId('resource-catalog-runtime'), prepared.seed),
    deployment: resolveConfig({ characterName: 'fallback' }),
  }).snapshot

  assert.equal(runtime.actor?.id, characterLibraryRoleplayResourceId(card.id))
  assert.equal(runtime.participant?.id, persona.id)
  assert.equal(runtime.prompt.resource?.id, presetLibraryRoleplayResourceId(preset.id))
  assert.equal(runtime.world.bindings.some(value => value.id === worldInfoLibraryRoleplayResourceId(world.id)), true)
  assert.equal(catalog.get('actor', runtime.actor!.id)?.name, card.displayName)
  assert.equal(catalog.get('persona', runtime.participant!.id)?.name, persona.name)
  assert.equal(catalog.get('prompt-policy', runtime.prompt.resource!.id)?.name, preset.name)
  assert.equal(catalog.get('world', worldInfoLibraryRoleplayResourceId(world.id))?.name, world.name)
  assert.deepEqual(catalog.inspect('actor', characterLibraryRoleplayResourceId(card.id)), {
    kind: 'actor',
    openings: [{ id: 'greeting:0', label: '默认开场', preview: '门还没锁。', truncated: false }],
  })
  const actorProjection = catalog.projectActor({ kind: 'actor', id: characterLibraryRoleplayResourceId(card.id) })
  assert.equal(actorProjection.name, '白露')
  assert.match(actorProjection.persona, /角色描述：钟表匠/u)
  assert.match(actorProjection.persona, /性格：沉静/u)
  assert.deepEqual(catalog.inspect('persona', persona.id), {
    kind: 'persona', description: '刚到海城的旅人。',
  })
  assert.deepEqual(catalog.inspect('prompt-policy', presetLibraryRoleplayResourceId(preset.id)), {
    kind: 'prompt-policy', moduleCount: 1, enabledModuleCount: 1,
  })
  assert.deepEqual(catalog.inspect('world', worldInfoLibraryRoleplayResourceId(world.id)), {
    kind: 'world', entryCount: 1,
  })

  characters.archive(card.id)
  assert.equal(catalog.get('actor', characterLibraryRoleplayResourceId(card.id))?.availability, 'archived')
})

function catalogRoute(catalog: RoleplayResourceCatalog): RegisteredRoute {
  let route: RegisteredRoute | undefined
  const ctx = { effect(register: () => unknown) { register() } } as unknown as Context
  const server: AgentRpHttpServer = { register(value) { route = value; return () => {} } }
  installRoleplayResourceCatalogHttp(ctx, catalog, server)
  assert.ok(route)
  assert.equal(route.path, ROLEPLAY_RESOURCE_CATALOG_PATH)
  return route
}

async function invoke(
  route: RegisteredRoute,
  method = 'GET',
  headers: IncomingHttpHeaders = {},
  url = ROLEPLAY_RESOURCE_CATALOG_PATH,
): Promise<{ readonly status: number; readonly body: unknown; readonly headers: Readonly<Record<string, string>> }> {
  const request = Object.assign(Readable.from([]), {
    method,
    url,
    headers: {
      host: '127.0.0.1:3091', origin: 'http://127.0.0.1:3091', 'sec-fetch-site': 'same-origin',
      ...headers,
    } satisfies IncomingHttpHeaders,
  }) as unknown as IncomingMessage
  let status = 0
  let body = Buffer.alloc(0)
  const responseHeaders = new Map<string, string>()
  const response = {
    setHeader(name: string, value: string | number | readonly string[]) {
      responseHeaders.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value))
      return response
    },
    writeHead(value: number, values?: Readonly<Record<string, string | number | readonly string[]>>) {
      status = value
      for (const [name, header] of Object.entries(values ?? {})) {
        responseHeaders.set(name.toLowerCase(), Array.isArray(header) ? header.join(', ') : String(header))
      }
      return response
    },
    end(value?: string | Uint8Array) {
      if (value !== undefined) body = Buffer.from(value)
      return response
    },
  } as unknown as ServerResponse
  await route.handler(request, response)
  return {
    status,
    body: JSON.parse(body.toString('utf8')) as unknown,
    headers: Object.fromEntries(responseHeaders),
  }
}

test('serves only a same-origin content-free catalog snapshot', async () => {
  const catalog = new RoleplayResourceCatalog()
  catalog.register({
    id: 'fixture:http',
    list: () => [{
      id: 'actor:http', kind: 'actor', name: 'HTTP 角色', availability: 'available',
    }],
    inspect: () => ({
      kind: 'actor',
      openings: [{ id: 'opening:default', label: '默认开场', preview: '你好。', truncated: false }],
    }),
  })
  const route = catalogRoute(catalog)
  const result = await invoke(route)
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { format: 0, entries: [{
    id: 'actor:http', kind: 'actor', name: 'HTTP 角色', availability: 'available',
  }] })
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.deepEqual((await invoke(
    route,
    'GET',
    {},
    `${ROLEPLAY_RESOURCE_CATALOG_PATH}?kind=actor&id=actor%3Ahttp`,
  )).body, {
    format: 0,
    descriptor: { id: 'actor:http', kind: 'actor', name: 'HTTP 角色', availability: 'available' },
    detail: {
      kind: 'actor',
      openings: [{ id: 'opening:default', label: '默认开场', preview: '你好。', truncated: false }],
    },
  })
  assert.equal((await invoke(
    route,
    'GET',
    {},
    `${ROLEPLAY_RESOURCE_CATALOG_PATH}?kind=world&id=world%3Amissing`,
  )).status, 404)
  assert.equal((await invoke(route, 'POST')).status, 405)
  assert.equal((await invoke(route, 'GET', {
    origin: 'https://example.test', 'sec-fetch-site': 'cross-site',
  })).status, 403)
})
