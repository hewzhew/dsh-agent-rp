import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createFlyingChessWorldModule } from '../src/flying-chess-world.ts'
import { FLYING_CHESS_WORLD_MODULE_ID, type FlyingChessWorldState } from '../src/flying-chess-protocol.ts'
import { PlayWorldRegistry, type PlayWorldModule } from '../src/play-world.ts'
import { RoleplayResourceCatalog } from '../src/roleplay-resource-catalog.ts'
import {
  FLYING_CHESS_WORLD_CAST_SLOTS,
  FLYING_CHESS_WORLD_RESOURCE_ID,
  flyingChessWorldResourceProvider,
} from '../src/play-world-resource-provider.ts'
import type { AgentRpHttpServer } from '../src/host-http.ts'
import { installStoryWorkspaceHttp } from '../src/story-workspace-http.ts'
import { parseAgentRpSessionLaunchRequest } from '../src/session-launch.ts'
import { createStoryWorkspaceSessionSeed, readSessionStoryWorkspaceId } from '../src/session-story-workspace.ts'
import { acceptStorySuggestionBatch } from '../src/story-suggestion-batch.ts'
import { advanceStoryWorldByCharacter, materializeStoryTurn, runStoryTurnPipeline } from '../src/story-turn-pipeline.ts'
import type { StoryCharacter, StoryWorkspaceSaveRequest, StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import {
  compileStoryCharacterContext,
  compileStoryDirectorWorldContext,
  createStoryCharacterId,
  createStoryCitationId,
  createStoryFactId,
  createStoryNodeId,
  createStoryOutputId,
  createStorySourceId,
  resolveStoryPlayWorldContext,
  StoryWorkspaceStore,
} from '../src/story-workspace.ts'

function editable(snapshot: StoryWorkspaceSnapshot): StoryWorkspaceSaveRequest {
  return {
    format: 2,
    id: snapshot.id,
    revision: snapshot.revision,
    name: snapshot.name,
    pipeline: snapshot.pipeline,
    graph: snapshot.graph,
    characters: snapshot.characters,
    facts: snapshot.facts,
    events: snapshot.events,
    outputs: snapshot.outputs,
    sources: snapshot.sources,
    citations: snapshot.citations,
    researchInbox: snapshot.researchInbox,
  }
}

function character(id: string, name: string, description = ''): StoryCharacter {
  return {
    id,
    name,
    profile: { description, personality: '', scenario: '', exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '' },
    state: { location: '', condition: '', objective: '', notes: '' },
  }
}

function counterWorldModule(name = '计数世界'): PlayWorldModule {
  return {
    descriptor: {
      id: 'fixture/counter',
      name,
      summary: '验证第三方世界模块的安全动作投影。',
      category: 'simulation',
      minCharacters: 1,
      maxCharacters: 2,
    },
    create(context) {
      const characterId = context.characters[0]?.id
      if (characterId === undefined) throw new Error('计数世界需要人物')
      return {
        format: 0,
        instanceId: 'world-counter-fixture',
        moduleId: 'fixture/counter',
        moduleVersion: 0,
        title: name,
        state: { step: 0, characterId },
        events: [{ id: 'counter-event-0', sequence: 0, type: 'counter.started', title: '开始', summary: '计数开始。' }],
      }
    },
    normalize(value, context) {
      const snapshot = value as {
        readonly format?: unknown
        readonly instanceId?: unknown
        readonly moduleId?: unknown
        readonly moduleVersion?: unknown
        readonly title?: unknown
        readonly state?: { readonly step?: unknown; readonly characterId?: unknown }
        readonly events?: unknown
      }
      if (snapshot.format !== 0 || snapshot.instanceId !== 'world-counter-fixture'
        || snapshot.moduleId !== 'fixture/counter' || snapshot.moduleVersion !== 0 || snapshot.title !== name
        || !Number.isSafeInteger(snapshot.state?.step) || (snapshot.state?.step as number) < 0
        || typeof snapshot.state?.characterId !== 'string'
        || !context.characters.some(character => character.id === snapshot.state?.characterId)
        || !Array.isArray(snapshot.events)) throw new Error('计数世界快照无效')
      return value as ReturnType<PlayWorldModule['create']>
    },
    dispatch(snapshot, action, context) {
      const current = this.normalize(snapshot, context)
      const state = current.state as { readonly step: number; readonly characterId: string }
      const value = action as { readonly expectedStep?: unknown; readonly hostOnlyToken?: unknown }
      if (value.expectedStep !== state.step || value.hostOnlyToken !== `secret-${String(state.step)}` || state.step >= 2) {
        throw new Error('计数世界动作无效')
      }
      const next = state.step + 1
      return {
        ...current,
        state: { ...state, step: next },
        events: [...current.events, {
          id: `counter-event-${String(next)}`,
          sequence: current.events.length,
          type: 'counter.advanced',
          title: `推进到 ${String(next)}`,
          summary: `计数值变为 ${String(next)}。`,
          actorId: state.characterId,
        }],
      }
    },
    characterTurn(snapshot, context) {
      const current = this.normalize(snapshot, context)
      const state = current.state as { readonly step: number; readonly characterId: string }
      if (state.step >= 2) return undefined
      return {
        id: `counter:${String(state.step)}`,
        characterId: state.characterId,
        instruction: `请选择第 ${String(state.step + 1)} 次推进。`,
        actions: [{
          id: `advance:${String(state.step)}`,
          label: '推进',
          description: '让 Host 将计数增加一。',
          action: { expectedStep: state.step, hostOnlyToken: `secret-${String(state.step)}` },
        }],
      }
    },
    projectForCharacter(snapshot, _characterId, context) {
      const state = this.normalize(snapshot, context).state as { readonly step: number }
      return { title: name, text: `计数为 ${String(state.step)}。` }
    },
    projectForDirector(snapshot, context) {
      const state = this.normalize(snapshot, context).state as { readonly step: number }
      return { title: name, text: `权威计数为 ${String(state.step)}。` }
    },
    renderEventNarrative(snapshot, eventSequences, context) {
      const events = this.normalize(snapshot, context).events.filter(event => eventSequences.includes(event.sequence))
      return events.map(event => `${event.title}。`).join('')
    },
  }
}

function fixtureWorldResourceId(moduleId: string): string {
  return moduleId === FLYING_CHESS_WORLD_MODULE_ID
    ? FLYING_CHESS_WORLD_RESOURCE_ID
    : `world:${moduleId}`
}

function fixtureWorldResources(worlds: PlayWorldRegistry): RoleplayResourceCatalog {
  const catalog = new RoleplayResourceCatalog()
  catalog.register({
    id: 'fixture:play-world-resources',
    list: () => worlds.list().map(module => ({
      id: fixtureWorldResourceId(module.id),
      kind: 'world',
      name: module.name,
      availability: 'available',
    })),
    inspect: descriptor => {
      const moduleId = descriptor.id === FLYING_CHESS_WORLD_RESOURCE_ID
        ? FLYING_CHESS_WORLD_MODULE_ID
        : descriptor.id.slice('world:'.length)
      const module = worlds.list().find(candidate => candidate.id === moduleId)
      if (module === undefined) throw new Error('测试世界模块不存在')
      return {
        kind: 'world',
        entryCount: 0,
        playWorld: {
          moduleId: module.id,
          summary: module.summary,
          category: module.category,
          minCharacters: module.minCharacters,
          maxCharacters: module.maxCharacters,
          castSlots: [],
        },
      }
    },
    projectWorld: selection => ({
      moduleId: selection.id === FLYING_CHESS_WORLD_RESOURCE_ID
        ? FLYING_CHESS_WORLD_MODULE_ID
        : selection.id.slice('world:'.length),
      configuration: {},
      sources: [],
      castSlots: [],
    }),
  })
  return catalog
}

function fixtureFlyingChessCastResources(): RoleplayResourceCatalog {
  const catalog = new RoleplayResourceCatalog()
  catalog.register(flyingChessWorldResourceProvider())
  catalog.register({
    id: 'fixture:flying-chess-actors',
    list: () => [{
      id: 'actor:reimu', kind: 'actor', name: '博丽灵梦', availability: 'available',
    }, {
      id: 'actor:marisa', kind: 'actor', name: '雾雨魔理沙', availability: 'available',
    }],
    projectActor: selection => {
      const name = selection.id === 'actor:reimu' ? '博丽灵梦' : selection.id === 'actor:marisa' ? '雾雨魔理沙' : undefined
      if (name === undefined) throw new Error('测试角色不存在')
      return {
        name,
        voiceAliases: selection.id === 'actor:reimu'
          ? ['博麗霊夢', '霊夢']
          : ['霧雨魔理沙', '魔理沙'],
        profile: {
          description: `${name}的测试角色卡描述。`,
          personality: `${name}的测试角色卡性格。`,
          scenario: '',
          exampleDialogue: `${name}：“测试台词。”`,
          systemPrompt: '',
          postHistoryInstructions: '',
        },
      }
    },
  })
  return catalog
}

type RegisteredRoute = Parameters<AgentRpHttpServer['register']>[0]

function storyWorkspaceRoute(store: StoryWorkspaceStore, resources?: RoleplayResourceCatalog): RegisteredRoute {
  const routes: RegisteredRoute[] = []
  const ctx = { effect(register: () => unknown) { register() } } as unknown as Context
  const server: AgentRpHttpServer = { register(route) { routes.push(route); return () => {} } }
  installStoryWorkspaceHttp(ctx, store, server, resources)
  const route = routes.find(candidate => candidate.kind === 'prefix')
  assert.ok(route)
  return route
}

async function invokeStoryWorkspaceRoute(
  route: RegisteredRoute,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const request = Object.assign(Readable.from(payload), {
    method,
    url,
    headers: {
      host: '127.0.0.1:3181',
      origin: 'http://127.0.0.1:3181',
      'sec-fetch-site': 'same-origin',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  }) as unknown as IncomingMessage
  let status = 0
  let responseBody = Buffer.alloc(0)
  const response = {
    setHeader() { return response },
    writeHead(value: number) { status = value; return response },
    end(value?: string | Uint8Array) {
      if (value !== undefined) responseBody = Buffer.from(value)
      return response
    },
  } as unknown as ServerResponse
  await route.handler(request, response)
  return { status, body: JSON.parse(responseBody.toString('utf8')) as unknown }
}

test('revokes play-world registrations without deleting a newer owner', () => {
  const worlds = new PlayWorldRegistry()
  const first = counterWorldModule('第一版')
  const disposeFirst = worlds.register(first)
  assert.equal(worlds.get(first.descriptor.id), first)
  assert.throws(() => worlds.register(counterWorldModule('重复版')), /重复注册/u)
  disposeFirst()
  const second = counterWorldModule('第二版')
  const disposeSecond = worlds.register(second)
  disposeFirst()
  assert.equal(worlds.get(second.descriptor.id), second)
  disposeSecond()
  assert.throws(() => worlds.get(second.descriptor.id), /未安装/u)
})

test('runs an unrecognized world through browser-safe action ids', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-custom-play-world-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(counterWorldModule())
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '第三方世界' })
  const actorId = createStoryCharacterId()
  const prepared = store.save({ ...editable(created), characters: [character(actorId, '测试人物')] })
  const installed = store.installWorld(prepared.id, {
    format: 0,
    revision: prepared.revision,
    resource: { kind: 'world', id: fixtureWorldResourceId('fixture/counter') },
    cast: [],
  })
  const firstTurn = store.worldTurn(installed.id)
  assert.deepEqual(firstTurn, {
    cycleId: 'counter:0',
    characterId: actorId,
    instruction: '请选择第 1 次推进。',
    actions: [{ id: 'advance:0', label: '推进', description: '让 Host 将计数增加一。' }],
  })
  assert.doesNotMatch(JSON.stringify(firstTurn), /hostOnlyToken|secret-/u)
  assert.throws(() => store.dispatchWorldAction(installed.id, {
    format: 0, revision: installed.revision, cycleId: firstTurn!.cycleId, actionId: 'not-advertised',
  }), /动作不再合法/u)
  const once = store.dispatchWorldAction(installed.id, {
    format: 0, revision: installed.revision, cycleId: firstTurn!.cycleId, actionId: 'advance:0',
  })
  assert.equal((once.world?.state as { readonly step: number }).step, 1)
  assert.throws(() => store.dispatchWorldAction(once.id, {
    format: 0, revision: once.revision, cycleId: firstTurn!.cycleId, actionId: 'advance:0',
  }), /回合已经变化/u)
  const secondTurn = store.worldTurn(once.id)
  const finished = store.dispatchWorldAction(once.id, {
    format: 0, revision: once.revision, cycleId: secondTurn!.cycleId, actionId: 'advance:1',
  })
  assert.equal((finished.world?.state as { readonly step: number }).step, 2)
  assert.equal(store.worldTurn(finished.id), undefined)
})

test('assembles declared world cast slots from actor resources without leaking unrelated characters into rules', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-world-cast-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule())
  const resources = fixtureFlyingChessCastResources()
  const store = new StoryWorkspaceStore({ root, worlds, resources })
  const created = store.create({ format: 2, name: '人物槽位场地' })
  const reimuId = createStoryCharacterId()
  const observerId = createStoryCharacterId()
  const prepared = store.save({
    ...editable(created),
    characters: [character(reimuId, '博丽灵梦'), character(observerId, '旁观者')],
  })
  assert.deepEqual(store.worldResources()[0]?.castSlots, FLYING_CHESS_WORLD_CAST_SLOTS)
  assert.throws(() => store.installWorld(prepared.id, {
    format: 0,
    revision: prepared.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [{ slotId: 'reimu', actor: { kind: 'actor', id: 'actor:reimu' }, characterId: reimuId }],
  }), /雾雨魔理沙/u)

  const installed = store.installWorld(prepared.id, {
    format: 0,
    revision: prepared.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [{
      slotId: 'reimu', actor: { kind: 'actor', id: 'actor:reimu' }, characterId: reimuId,
    }, {
      slotId: 'marisa', actor: { kind: 'actor', id: 'actor:marisa' },
    }],
  })
  const marisa = installed.characters.find(candidate => candidate.actor?.id === 'actor:marisa')
  assert.ok(marisa)
  assert.equal(installed.characters.length, 3)
  assert.equal(installed.characters.find(candidate => candidate.id === reimuId)?.profile.description, '博丽灵梦的测试角色卡描述。')
  assert.deepEqual(installed.characters.find(candidate => candidate.id === reimuId)?.voiceAliases, ['博麗霊夢', '霊夢'])
  assert.equal(installed.characters.find(candidate => candidate.id === observerId)?.name, '旁观者')
  assert.deepEqual(installed.worldBinding?.cast, [{ slotId: 'reimu', characterId: reimuId }, {
    slotId: 'marisa', characterId: marisa.id,
  }])
  assert.deepEqual(resolveStoryPlayWorldContext(installed).characters.map(candidate => candidate.id), [reimuId, marisa.id])
  assert.deepEqual((installed.world?.state as FlyingChessWorldState).playerOrder, [reimuId, marisa.id])
  assert.equal(installed.outputs.some(output => output.characterId === observerId), false)
  assert.deepEqual(new StoryWorkspaceStore({ root, worlds, resources }).get(installed.id), installed)
})

test('upgrades a legacy cast binding through HTTP without resetting world state or character ids', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-world-cast-upgrade-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule())
  const resources = fixtureFlyingChessCastResources()
  const store = new StoryWorkspaceStore({ root, worlds, resources })
  const created = store.create({ format: 2, name: '旧阵容升级' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const prepared = store.save({
    ...editable(created),
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
  })
  const installed = store.installWorld(prepared.id, {
    format: 0,
    revision: prepared.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [{
      slotId: 'reimu', actor: { kind: 'actor', id: 'actor:reimu' }, characterId: reimuId,
    }, {
      slotId: 'marisa', actor: { kind: 'actor', id: 'actor:marisa' }, characterId: marisaId,
    }],
  })
  assert.throws(() => store.updateWorldCast(installed.id, {
    format: 0,
    revision: installed.revision,
    cast: [{
      slotId: 'reimu', actor: { kind: 'actor', id: 'actor:reimu' }, characterId: marisaId,
    }, {
      slotId: 'marisa', actor: { kind: 'actor', id: 'actor:marisa' }, characterId: reimuId,
    }],
  }), /必须保留当前槽位中的人物/u)
  const storyPath = join(root, installed.id, 'story.json')
  const stored = JSON.parse(readFileSync(storyPath, 'utf8')) as {
    worldBinding?: unknown
    characters: { actor?: unknown; actorBaseline?: unknown }[]
    outputs: unknown[]
  }
  delete stored.worldBinding
  stored.characters = stored.characters.map(({ actor: _actor, actorBaseline: _actorBaseline, ...character }) => character)
  stored.outputs = []
  writeFileSync(storyPath, `${JSON.stringify(stored, null, 2)}\n`)
  writeFileSync(join(root, installed.id, 'characters', reimuId, 'description.md'), '旧灵梦档案')
  writeFileSync(join(root, installed.id, 'characters', marisaId, 'description.md'), '旧魔理沙档案')
  const legacy = store.get(installed.id)
  assert.equal(legacy.worldBinding?.resource, undefined)
  const beforeWorld = structuredClone(legacy.world)
  const beforeEvents = structuredClone(legacy.events)
  const beforeGraph = structuredClone(legacy.graph)
  const route = storyWorkspaceRoute(store)
  const response = await invokeStoryWorkspaceRoute(
    route,
    'POST',
    `/api/agent-rp/story-workspaces/${encodeURIComponent(legacy.id)}/world/cast`,
    {
      format: 0,
      revision: legacy.revision,
      cast: [{
        slotId: 'reimu', actor: { kind: 'actor', id: 'actor:reimu' }, characterId: reimuId,
      }, {
        slotId: 'marisa', actor: { kind: 'actor', id: 'actor:marisa' }, characterId: marisaId,
      }],
    },
  )
  assert.equal(response.status, 200)
  const upgraded = store.get(legacy.id)
  assert.deepEqual(upgraded.world, beforeWorld)
  assert.deepEqual(upgraded.events, beforeEvents)
  assert.deepEqual(upgraded.graph, beforeGraph)
  assert.deepEqual(upgraded.outputs.map(output => [output.name, output.kind, output.characterId]), [
    ['正文', 'prose', undefined],
    ['博丽灵梦视角', 'character', reimuId],
    ['雾雨魔理沙视角', 'character', marisaId],
    ['棋局记录', 'history', undefined],
  ])
  assert.deepEqual(upgraded.worldBinding?.resource, { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID })
  assert.equal(upgraded.worldBinding?.moduleId, FLYING_CHESS_WORLD_MODULE_ID)
  assert.deepEqual(upgraded.worldBinding?.configuration, { format: 0, ruleset: 'classic-24' })
  assert.deepEqual(upgraded.worldBinding?.sourceReferences, [])
  assert.deepEqual(upgraded.worldBinding?.sourceIds, [])
  assert.deepEqual(upgraded.worldBinding?.cast, [{ slotId: 'reimu', characterId: reimuId }, {
    slotId: 'marisa', characterId: marisaId,
  }])
  assert.equal(upgraded.characters.find(candidate => candidate.id === reimuId)?.profile.description, '博丽灵梦的测试角色卡描述。')
  assert.equal(upgraded.characters.find(candidate => candidate.id === marisaId)?.profile.description, '雾雨魔理沙的测试角色卡描述。')
  assert.deepEqual(upgraded.characters.find(candidate => candidate.id === reimuId)?.voiceAliases, ['博麗霊夢', '霊夢'])
  assert.deepEqual(upgraded.characters.find(candidate => candidate.id === marisaId)?.voiceAliases, ['霧雨魔理沙', '魔理沙'])
  assert.deepEqual((upgraded.world?.state as FlyingChessWorldState).playerOrder, [reimuId, marisaId])
})

test('persists resource recipes, restores legacy sources, and keeps worlds readable without a rule module', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-world-resource-recipe-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(counterWorldModule())
  const resources = new RoleplayResourceCatalog()
  const worldResourceId = 'world:fixture/composed'
  const sourceResourceId = 'world:fixture/lore'
  resources.register({
    id: 'fixture:composed-world',
    list: () => [{
      id: worldResourceId, kind: 'world', name: '带资料的计数世界', availability: 'available',
    }, {
      id: sourceResourceId, kind: 'world', name: '计数世界资料', availability: 'available',
    }],
    inspect: descriptor => descriptor.id === worldResourceId
      ? {
          kind: 'world',
          entryCount: 0,
          playWorld: {
            moduleId: 'fixture/counter',
            summary: '验证第三方世界模块的安全动作投影。',
            category: 'simulation',
            minCharacters: 1,
            maxCharacters: 2,
            castSlots: [],
          },
        }
      : { kind: 'world', entryCount: 1 },
    projectWorld: selection => {
      if (selection.id !== worldResourceId) throw new Error('这个世界资源没有规则配方')
      return {
        moduleId: 'fixture/counter',
        configuration: { format: 0, limit: 2 },
        sources: [{ kind: 'world', id: sourceResourceId }],
        castSlots: [],
      }
    },
    projectStorySource: (selection, descriptor) => {
      if (selection.id !== sourceResourceId) throw new Error('这个世界资源不是资料')
      return { name: descriptor.name, kind: 'reference', content: '# 计数规则\n\n每次合法动作只推进一步。' }
    },
  })
  const store = new StoryWorkspaceStore({ root, worlds, resources })
  const created = store.create({ format: 2, name: '资源组合场地' })
  const actorId = createStoryCharacterId()
  const prepared = store.save({ ...editable(created), characters: [character(actorId, '测试人物')] })
  const installed = store.installWorld(prepared.id, {
    format: 0,
    revision: prepared.revision,
    resource: { kind: 'world', id: worldResourceId },
    cast: [],
  })
  assert.deepEqual(installed.worldBinding, {
    resource: { kind: 'world', id: worldResourceId },
    moduleId: 'fixture/counter',
    configuration: { format: 0, limit: 2 },
    sourceReferences: [{ kind: 'world', id: sourceResourceId }],
    sourceIds: [installed.sources[0]!.id],
    cast: [],
  })
  assert.equal(installed.sources[0]?.content, '# 计数规则\n\n每次合法动作只推进一步。')
  assert.deepEqual(installed.sources[0]?.origin, {
    kind: 'resource', resource: { kind: 'world', id: sourceResourceId },
  })
  assert.deepEqual(new StoryWorkspaceStore({ root, worlds, resources }).get(installed.id), installed)

  const unavailable = new StoryWorkspaceStore({ root, worlds: new PlayWorldRegistry(), resources })
  const retained = unavailable.get(installed.id)
  assert.deepEqual(retained.worldBinding, installed.worldBinding)
  assert.deepEqual(retained.world, installed.world)
  assert.equal(unavailable.worldTurn(installed.id), undefined)
  assert.equal(unavailable.worldResources().find(world => world.resource.id === worldResourceId)?.moduleAvailable, false)
  const unavailableRoute = storyWorkspaceRoute(unavailable)
  const unavailableRead = await invokeStoryWorkspaceRoute(
    unavailableRoute, 'GET', `/api/agent-rp/story-workspaces/${encodeURIComponent(installed.id)}`,
  )
  assert.equal(unavailableRead.status, 200)
  assert.equal((unavailableRead.body as { readonly worldModuleAvailable?: unknown }).worldModuleAvailable, false)
  assert.equal((unavailableRead.body as { readonly worldTurn?: unknown }).worldTurn, null)
  assert.throws(() => unavailable.restartWorld(installed.id, {
    format: 0, revision: retained.revision,
  }), /规则模块.*未安装|游玩世界模块.*未安装/u)

  const storyPath = join(root, installed.id, 'story.json')
  const stored = JSON.parse(readFileSync(storyPath, 'utf8')) as {
    worldBinding?: unknown
    sources: unknown[]
  }
  delete stored.worldBinding
  stored.sources = []
  writeFileSync(storyPath, `${JSON.stringify(stored, null, 2)}\n`)
  rmSync(join(root, installed.id, 'sources', `${installed.sources[0]!.id}.md`), { force: true })
  const legacy = store.get(installed.id)
  assert.equal(legacy.worldBinding?.resource, undefined)
  assert.equal(legacy.sources.length, 0)
  const restored = store.updateWorldCast(legacy.id, { format: 0, revision: legacy.revision, cast: [] })
  assert.deepEqual(restored.world, installed.world)
  assert.deepEqual(restored.worldBinding?.resource, { kind: 'world', id: worldResourceId })
  assert.deepEqual(restored.worldBinding?.configuration, { format: 0, limit: 2 })
  assert.deepEqual(restored.worldBinding?.sourceReferences, [{ kind: 'world', id: sourceResourceId }])
  assert.deepEqual(restored.worldBinding?.sourceIds, [restored.sources[0]!.id])
  assert.equal(restored.sources[0]?.content, '# 计数规则\n\n每次合法动作只推进一步。')
  assert.deepEqual(restored.sources[0]?.origin, {
    kind: 'resource', resource: { kind: 'world', id: sourceResourceId },
  })
})

test('serves and dispatches third-party world turns without action payloads', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-custom-play-world-http-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(counterWorldModule())
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: 'HTTP 第三方世界' })
  const actorId = createStoryCharacterId()
  const prepared = store.save({ ...editable(created), characters: [character(actorId, '测试人物')] })
  const installed = store.installWorld(prepared.id, {
    format: 0,
    revision: prepared.revision,
    resource: { kind: 'world', id: fixtureWorldResourceId('fixture/counter') },
    cast: [],
  })
  const route = storyWorkspaceRoute(store)
  const path = `/api/agent-rp/story-workspaces/${encodeURIComponent(installed.id)}`
  const read = await invokeStoryWorkspaceRoute(route, 'GET', path)
  assert.equal(read.status, 200)
  assert.doesNotMatch(JSON.stringify(read.body), /hostOnlyToken|secret-/u)
  assert.deepEqual((read.body as { readonly worldTurn?: unknown }).worldTurn, {
    cycleId: 'counter:0',
    characterId: actorId,
    instruction: '请选择第 1 次推进。',
    actions: [{ id: 'advance:0', label: '推进', description: '让 Host 将计数增加一。' }],
  })
  const rejected = await invokeStoryWorkspaceRoute(route, 'POST', `${path}/world/actions`, {
    format: 0,
    revision: installed.revision,
    action: { expectedStep: 0, hostOnlyToken: 'secret-0' },
  })
  assert.equal(rejected.status, 400)
  const advanced = await invokeStoryWorkspaceRoute(route, 'POST', `${path}/world/actions`, {
    format: 0,
    revision: installed.revision,
    cycleId: 'counter:0',
    actionId: 'advance:0',
  })
  assert.equal(advanced.status, 200)
  assert.equal(((advanced.body as { readonly workspace: StoryWorkspaceSnapshot }).workspace.world?.state as { readonly step: number }).step, 1)
  assert.equal((advanced.body as { readonly worldTurn: { readonly cycleId: string } }).worldTurn.cycleId, 'counter:1')
})

test('advances a host-owned flying-chess world only through typed actions', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-play-world-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const rolls = [6, 1]
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => rolls.shift() ?? 1 }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '博丽神社飞行棋' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const activeNodeId = createStoryNodeId()
  const sourceId = createStorySourceId()
  const withCharacters = store.save({
    ...editable(created),
    graph: {
      activeNodeId,
      nodes: [{
        id: activeNodeId,
        kind: 'beat',
        title: '神社棋局',
        summary: '灵梦和魔理沙正在博丽神社玩飞行棋。',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 0, y: 0 },
        content: '',
        participantIds: [reimuId, marisaId],
        knowledge: { mode: 'participants', characterIds: [] },
      }],
      edges: [],
    },
    characters: [
      character(reimuId, '博丽灵梦', '博丽神社的巫女，负责维护博丽大结界、解决异变与退治造成麻烦的妖怪。'),
      character(marisaId, '雾雨魔理沙', '住在魔法森林的人类魔法使，擅长以光与热为主的华丽高火力魔法。'),
    ],
    sources: [{
      id: sourceId,
      name: '飞行棋资料',
      kind: 'original',
      enabled: true,
      content: '两人在神社玩飞行棋。',
    }],
  })

  const installed = store.installWorld(withCharacters.id, {
    format: 0,
    revision: withCharacters.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  const initial = installed.world?.state as FlyingChessWorldState
  assert.equal(initial.currentPlayerId, reimuId)
  assert.equal(initial.pieces.length, 8)
  assert.equal(installed.world?.events[0]?.type, 'game.started')
  assert.throws(() => worlds.get(FLYING_CHESS_WORLD_MODULE_ID).normalize({
    ...installed.world,
    state: { ...initial, pendingRoll: { playerId: reimuId, value: 1, legalPieceIds: [] } },
  }, resolveStoryPlayWorldContext(installed)), /合法棋子集合无效/u)

  const initialTurn = worlds.get(FLYING_CHESS_WORLD_MODULE_ID).characterTurn(
    installed.world!, resolveStoryPlayWorldContext(installed),
  )
  assert.equal(initialTurn?.characterId, reimuId)
  assert.deepEqual(initialTurn?.actions.map(action => action.id), ['roll'])
  const rollRequest = {
    key: 'receipt-roll',
    runKey: 'run-1',
    revision: installed.revision,
    cycleId: initialTurn!.id,
    sequence: 0,
    characterId: reimuId,
    actionId: 'roll',
    resultEventSeq: 10,
  }
  const rolled = store.dispatchWorldCharacterAction(installed.id, rollRequest)
  const replayedRoll = store.dispatchWorldCharacterAction(installed.id, rollRequest)
  assert.equal(replayedRoll.revision, rolled.revision)
  const pending = rolled.world?.state as FlyingChessWorldState
  assert.equal(pending.pendingRoll?.value, 6)
  assert.equal(pending.pendingRoll?.legalPieceIds.length, 4)
  assert.equal(rolled.world?.events.at(-1)?.type, 'die.rolled')

  const moveTurn = worlds.get(FLYING_CHESS_WORLD_MODULE_ID).characterTurn(
    rolled.world!, resolveStoryPlayWorldContext(rolled),
  )
  const moveAction = moveTurn?.actions[0]
  assert.match(moveAction?.label ?? '', /移动 1 号飞机/u)
  const pieceId = pending.pendingRoll?.legalPieceIds[0]
  assert.ok(pieceId)
  const moved = store.dispatchWorldCharacterAction(rolled.id, {
    key: 'receipt-move',
    runKey: 'run-1',
    revision: rolled.revision,
    cycleId: moveTurn!.id,
    sequence: 1,
    characterId: reimuId,
    actionId: moveAction!.id,
    resultEventSeq: 11,
  })
  const afterMove = moved.world?.state as FlyingChessWorldState
  assert.equal(afterMove.pieces.find(piece => piece.id === pieceId)?.status, 'track')
  assert.equal(afterMove.currentPlayerId, reimuId)
  assert.deepEqual(moved.worldActionReceipts?.map(receipt => receipt.actionId), ['roll', moveAction!.id])
  assert.equal(worlds.get(FLYING_CHESS_WORLD_MODULE_ID).renderEventNarrative(
    moved.world!,
    [2, 3],
    resolveStoryPlayWorldContext(moved),
  ), '博丽灵梦掷出 6。博丽灵梦把 1 号飞机推进到航线第 1 步。')

  const manualRollTurn = store.worldTurn(moved.id)
  assert.equal(manualRollTurn?.actions[0]?.id, 'roll')
  const rolledAgain = store.dispatchWorldAction(moved.id, {
    format: 0,
    revision: moved.revision,
    cycleId: manualRollTurn!.cycleId,
    actionId: 'roll',
  })
  const secondPending = rolledAgain.world?.state as FlyingChessWorldState
  assert.equal(secondPending.pendingRoll?.value, 1)
  const manualMoveTurn = store.worldTurn(rolledAgain.id)
  const manualMoveActionId = `move:${pieceId}`
  assert.equal(manualMoveTurn?.actions.some(action => action.id === manualMoveActionId), true)
  const movedAgain = store.dispatchWorldAction(rolledAgain.id, {
    format: 0,
    revision: rolledAgain.revision,
    cycleId: manualMoveTurn!.cycleId,
    actionId: manualMoveActionId,
  })
  const finalState = movedAgain.world?.state as FlyingChessWorldState
  assert.equal(finalState.pieces.find(piece => piece.id === pieceId)?.steps, 2)
  assert.equal(finalState.currentPlayerId, marisaId)
  assert.throws(() => store.dispatchWorldAction(movedAgain.id, {
    format: 0,
    revision: rolledAgain.revision,
    cycleId: manualMoveTurn!.cycleId,
    actionId: 'roll',
  }), /当前 revision/u)

  const characterContext = compileStoryCharacterContext(movedAgain, reimuId, { playerInput: '继续。' }, worlds)
  assert.match(characterContext.worldContext, /当前第 3 回合/u)
  assert.match(characterContext.worldContext, /禁止自行掷骰、移动棋子、切换回合/u)
  assert.match(characterContext.text, /此人物可见的世界状态/u)
  assert.match(compileStoryDirectorWorldContext(movedAgain, worlds), /雾雨魔理沙/u)
  assert.throws(() => store.materializeTurn(movedAgain.id, {
    key: 'invalid-world-event-reference',
    turn: 1,
    title: '无效引用',
    summary: '不应保存。',
    evidence: '不应保存。',
    participantIds: [reimuId],
    worldEventSequences: [999],
    changes: { characters: [], facts: [], nodes: [], edges: [] },
    webResearch: [],
  }), /引用未知、重复或过多的世界事件/u)
  const firstTurn = store.materializeTurn(movedAgain.id, {
    key: 'session-play:turn-1',
    turn: 1,
    title: '灵梦的第一回合',
    summary: '灵梦掷骰并移动棋子。',
    evidence: '棋盘记录了灵梦的行动。',
    participantIds: [reimuId, marisaId],
    worldEventSequences: [2, 3],
    changes: {
      characters: [{ characterId: reimuId, location: '棋盘旁', objective: '率先让飞机到达终点' }],
      facts: [{ text: '魔理沙看见灵梦移动了棋子。', knownBy: [marisaId] }],
      nodes: [{
        ref: 'accepted-turn',
        kind: 'beat',
        parent: { kind: 'node', nodeId: activeNodeId },
        title: '已接受的剧情方向',
        summary: '下一回合继续棋局。',
        content: '',
        participantIds: [reimuId, marisaId],
        knowledge: { mode: 'participants', characterIds: [] },
      }],
      edges: [],
    },
    webResearch: [],
  })
  const firstEventId = firstTurn.events[0]!.id
  assert.deepEqual(firstTurn.events[0]?.worldEventSequences, [2, 3])
  assert.throws(() => store.materializeTurn(firstTurn.id, {
    key: 'duplicate-world-event-reference',
    turn: 2,
    title: '重复引用',
    summary: '不应保存。',
    evidence: '不应保存。',
    participantIds: [reimuId],
    worldEventSequences: [2],
    changes: { characters: [], facts: [], nodes: [], edges: [] },
    webResearch: [],
  }), /引用未知、重复或过多的世界事件/u)
  const accepted = acceptStorySuggestionBatch(firstTurn, firstEventId)
  const withAcceptedDirection = store.save({
    ...editable(firstTurn),
    graph: accepted.graph,
    citations: [...firstTurn.citations, {
      id: createStoryCitationId(),
      sourceId,
      locator: '第 1 段',
      quote: '两人在神社玩飞行棋。',
      note: '本轮研究依据',
      target: { kind: 'event', eventId: firstEventId },
    }],
  })
  const secondTurn = store.materializeTurn(withAcceptedDirection.id, {
    key: 'session-play:turn-2',
    turn: 2,
    title: '魔理沙的第一回合',
    summary: '魔理沙准备追赶。',
    evidence: '棋局仍在继续。',
    participantIds: [reimuId, marisaId],
    changes: {
      characters: [],
      facts: [],
      nodes: [{
        ref: 'pending-turn',
        kind: 'beat',
        parent: { kind: 'node', nodeId: activeNodeId },
        title: '尚未接受的剧情方向',
        summary: '这项候选应随重新开局消失。',
        content: '',
        participantIds: [marisaId],
        knowledge: { mode: 'participants', characterIds: [] },
      }],
      edges: [],
    },
    webResearch: [],
  })
  const restarted = store.restartWorld(secondTurn.id, {
    format: 0,
    revision: secondTurn.revision,
  })
  assert.notEqual(restarted.world?.instanceId, movedAgain.world?.instanceId)
  assert.equal(restarted.world?.events.length, 1)
  assert.equal((restarted.world?.state as FlyingChessWorldState).turn, 1)
  assert.equal(restarted.events.length, 0)
  assert.equal(restarted.citations.length, 1)
  assert.equal(restarted.citations[0]?.target, undefined)
  assert.equal(restarted.facts.some(fact => fact.source.kind === 'event'), false)
  assert.deepEqual(restarted.characters.map(item => item.state), [
    { location: '', condition: '', objective: '', notes: '' },
    { location: '', condition: '', objective: '', notes: '' },
  ])
  assert.equal(restarted.graph.nodes.some(node => node.title === '尚未接受的剧情方向'), false)
  assert.equal(restarted.graph.nodes.some(node => node.title === '已接受的剧情方向'), true)
  assert.equal(restarted.graph.nodes.find(node => node.title === '已接受的剧情方向')?.sourceEventId, undefined)
})

test('scaffolds fresh world authoring surfaces without replacing authored work', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-play-world-scaffold-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule())
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const created = store.create({ format: 2, name: '空白飞行棋' })
  const withCharacters = store.save({
    ...editable(created),
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
  })
  const scaffolded = store.installWorld(withCharacters.id, {
    format: 0,
    revision: withCharacters.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  assert.equal(scaffolded.graph.nodes.length, 1)
  assert.equal(scaffolded.graph.nodes[0]?.title, '幻想乡飞行棋对局')
  assert.equal(scaffolded.graph.activeNodeId, scaffolded.graph.nodes[0]?.id)
  assert.deepEqual(scaffolded.graph.nodes[0]?.participantIds, [reimuId, marisaId])
  assert.deepEqual(scaffolded.outputs.map(output => [output.name, output.kind, output.characterId]), [
    ['正文', 'prose', undefined],
    ['博丽灵梦视角', 'character', reimuId],
    ['雾雨魔理沙视角', 'character', marisaId],
    ['棋局记录', 'history', undefined],
  ])

  const authored = store.create({ format: 2, name: '已有创作' })
  const authoredNodeId = createStoryNodeId()
  const authoredOutputId = createStoryOutputId()
  const configured = store.save({
    ...editable(authored),
    graph: {
      activeNodeId: authoredNodeId,
      nodes: [{
        id: authoredNodeId,
        kind: 'beat',
        title: '用户场景',
        summary: '用户已经写好的场景。',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 80, y: 120 },
        content: '不应被世界模板覆盖。',
        participantIds: [reimuId, marisaId],
        knowledge: { mode: 'participants', characterIds: [] },
      }],
      edges: [],
    },
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
    outputs: [{
      id: authoredOutputId,
      name: '自定义正文',
      kind: 'prose',
      enabled: true,
      instructions: '保留玩家自己的布局。',
    }],
  })
  const preserved = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  assert.deepEqual(preserved.graph, configured.graph)
  assert.deepEqual(preserved.outputs, configured.outputs)
})

test('keeps executable world state out of whole-workspace edits', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-play-world-save-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule())
  const actorResources = fixtureFlyingChessCastResources()
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '场地' })
  const first = createStoryCharacterId()
  const second = createStoryCharacterId()
  const knownFactId = createStoryFactId()
  const withCharacters = store.save({
    ...editable(created),
    characters: [
      {
        ...character(first, '甲'),
        voiceAliases: [' 博麗霊夢 ', '霊夢', '博麗霊夢', ''],
        state: { location: '棋盘第四格', condition: '精神良好', objective: '率先到达终点', notes: '保留本局动态' },
      },
      character(second, '乙'),
    ],
    facts: [{
      id: knownFactId,
      text: '灵梦知道魔理沙的棋子仍在基地。',
      status: 'asserted',
      audience: 'director',
      knowledgeMode: 'override',
      knownBy: [first],
      source: { kind: 'manual' },
    }],
  })
  assert.deepEqual(withCharacters.characters[0]?.voiceAliases, ['博麗霊夢', '霊夢'])
  const installed = store.installWorld(withCharacters.id, {
    format: 0,
    revision: withCharacters.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  const launch = parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'session-source',
    kind: 'story-workspace',
    workspaceId: installed.id,
  })
  assert.equal(launch.kind, 'story-workspace')
  const prepared = createStoryWorkspaceSessionSeed(store, installed.id)
  assert.equal(prepared.title, '场地')
  assert.equal(readSessionStoryWorkspaceId(prepared.seed), installed.id)
  assert.deepEqual(prepared.seed.map(event => event.type), [
    'agent-rp/story-workspace-selection',
    'turn/start',
    'turn/end',
  ])
  assert.equal(prepared.seed[0]?.ignorable, true)
  const launched = Session.create(SessionId('play-world-launch'), prepared.seed)
  assert.deepEqual(launched.deriveMessages(), [])
  assert.equal(launched.events.findLast(event => event.type === 'turn/end')?.data.turn, 1)
  const renamed = store.save({ ...editable(installed), name: '新名称' })
  assert.deepEqual(renamed.world, installed.world)
  const boundResult = store.bindCharacterActor(renamed.id, {
    format: 0,
    revision: renamed.revision,
    characterId: first,
    actor: { kind: 'actor', id: 'actor:reimu' },
  }, {
    name: '博丽灵梦',
    voiceAliases: ['博麗霊夢'],
    profile: character(first, '博丽灵梦', '博丽神社的巫女。').profile,
  })
  const bound = boundResult.workspace
  assert.equal(boundResult.sync.mode, 'replaced')
  assert.equal(bound.characters[0]?.actor?.id, 'actor:reimu')
  assert.deepEqual(bound.characters[0]?.voiceAliases, ['博麗霊夢'])
  assert.equal(bound.characters[0]?.actorBaseline?.format, 0)
  const locallyEdited = store.save({
    ...editable(bound),
    characters: bound.characters.map(item => item.id === first
      ? {
          ...item,
          name: '本地灵梦名',
          voiceAliases: ['本地署名'],
          profile: { ...item.profile, personality: '本地补充的性格。' },
        }
      : item),
  })
  const reboundResult = store.bindCharacterActor(locallyEdited.id, {
    format: 0,
    revision: locallyEdited.revision,
    characterId: first,
    actor: { kind: 'actor', id: 'actor:reimu' },
  }, {
    name: '博丽灵梦（更新）',
    voiceAliases: ['更新后的卡片署名'],
    profile: {
      ...character(first, '博丽灵梦', '资源中心更新后的角色卡描述。').profile,
      personality: '资源中心更新后的性格。',
    },
  })
  const rebound = reboundResult.workspace
  assert.equal(reboundResult.sync.mode, 'refreshed')
  assert.deepEqual(reboundResult.sync.updatedFields, ['description'])
  assert.deepEqual(reboundResult.sync.preservedFields, ['name', 'voiceAliases', 'personality'])
  assert.equal(rebound.characters[0]?.name, '本地灵梦名')
  assert.equal(rebound.characters[0]?.profile.description, '资源中心更新后的角色卡描述。')
  assert.equal(rebound.characters[0]?.profile.personality, '本地补充的性格。')
  assert.deepEqual(rebound.characters[0]?.voiceAliases, ['本地署名'])
  assert.deepEqual(rebound.characters[0]?.state, locallyEdited.characters[0]?.state)
  assert.deepEqual(rebound.facts, locallyEdited.facts)
  assert.deepEqual(rebound.events, locallyEdited.events)
  assert.deepEqual(rebound.world, locallyEdited.world)
  const legacyBound = store.save({
    ...editable(rebound),
    characters: rebound.characters.map(item => {
      if (item.id !== first) return item
      const { actorBaseline: _actorBaseline, ...withoutBaseline } = item
      return withoutBaseline
    }),
  })
  const conservativeResult = store.bindCharacterActor(legacyBound.id, {
    format: 0,
    revision: legacyBound.revision,
    characterId: first,
    actor: { kind: 'actor', id: 'actor:reimu' },
  }, {
    name: '博丽灵梦（第二次更新）',
    voiceAliases: ['第二次更新后的卡片署名'],
    profile: {
      ...character(first, '博丽灵梦', '第二次更新后的角色卡描述。').profile,
      personality: '第二次更新后的性格。',
    },
  })
  const conservative = conservativeResult.workspace
  assert.equal(conservativeResult.sync.baselineCreated, true)
  assert.deepEqual(conservativeResult.sync.updatedFields, [])
  assert.deepEqual(conservativeResult.sync.preservedFields, ['name', 'voiceAliases', 'description', 'personality'])
  assert.equal(conservative.characters[0]?.name, '本地灵梦名')
  assert.equal(conservative.characters[0]?.profile.description, '资源中心更新后的角色卡描述。')
  assert.equal(conservative.characters[0]?.actorBaseline?.format, 0)
  const detachedResult = store.bindCharacterActor(conservative.id, {
    format: 0,
    revision: conservative.revision,
    characterId: first,
  })
  const detached = detachedResult.workspace
  assert.equal(detachedResult.sync.mode, 'detached')
  assert.equal(detached.characters[0]?.actor, undefined)
  assert.equal(detached.characters[0]?.actorBaseline, undefined)
  assert.equal(detached.characters[0]?.name, '本地灵梦名')
  assert.equal(detached.characters[0]?.profile.description, '资源中心更新后的角色卡描述。')
  assert.deepEqual(detached.characters[0]?.voiceAliases, ['本地署名'])
  assert.deepEqual(store.get(detached.id).characters[0]?.voiceAliases, ['本地署名'])
  assert.deepEqual(detached.world, installed.world)
  const response = await invokeStoryWorkspaceRoute(
    storyWorkspaceRoute(store, actorResources),
    'POST',
    `/api/agent-rp/story-workspaces/${encodeURIComponent(detached.id)}/characters/${encodeURIComponent(first)}/actor`,
    {
      format: 0,
      revision: detached.revision,
      characterId: first,
      actor: { kind: 'actor', id: 'actor:reimu' },
    },
  )
  assert.equal(response.status, 200)
  assert.equal((response.body as { readonly actorSync?: { readonly mode?: unknown } }).actorSync?.mode, 'replaced')
  assert.deepEqual((response.body as { readonly workspace?: StoryWorkspaceSnapshot }).workspace?.world, detached.world)
})

test('lets the current private character Worker complete one world turn exactly once', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-character-world-action-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 6 }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '人物自动行动' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const withCharacters = store.save({
    ...editable(created),
    characters: [
      character(reimuId, '博丽灵梦', '灵梦只知道自己的行动偏好。'),
      character(marisaId, '雾雨魔理沙', '魔理沙藏着不应进入灵梦输入的秘密。'),
    ],
  })
  const installed = store.installWorld(withCharacters.id, {
    format: 0,
    revision: withCharacters.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  const session = Session.create(SessionId('character-world-action'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 2_048 } },
  })
  const bodies: string[] = []
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly messages: readonly unknown[] }) {
        const body = JSON.stringify(options.messages)
        bodies.push(body)
        const moveId = body.match(/move:piece-[0-9a-f-]+/u)?.[0]
        const text = JSON.stringify({ actionId: moveId ?? 'roll' })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const agent = { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent
  const input = {
    ctx: fake,
    agent,
    store,
    workspace: installed,
    turn: 2,
    step: 1,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '请继续棋局。' }] })],
    signal: new AbortController().signal,
  }
  const advanced = await advanceStoryWorldByCharacter(input)
  const state = advanced.world?.state as FlyingChessWorldState
  assert.equal(bodies.length, 2)
  assert.match(bodies[0]!, /灵梦只知道自己的行动偏好/u)
  assert.doesNotMatch(bodies.join('\n'), /魔理沙藏着不应进入灵梦输入的秘密/u)
  assert.equal(state.turn, 2)
  assert.equal(state.currentPlayerId, reimuId)
  assert.equal(state.pieces.some(piece => piece.ownerId === reimuId && piece.status === 'track'), true)
  assert.deepEqual(advanced.worldActionReceipts?.map(receipt => receipt.sequence), [0, 1])
  assert.deepEqual(session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data.stage]
    : []), ['world-action', 'world-action'])

  const replayed = await advanceStoryWorldByCharacter(input)
  assert.equal(replayed.revision, advanced.revision)
  assert.equal(bodies.length, 2)
})

test('writes a manually completed world result before another character acts', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-manual-world-result-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 1 }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '手动规则结果' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const historyId = createStoryOutputId()
  const configured = store.save({
    ...editable(created),
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
    outputs: [
      { id: proseId, name: '正文', kind: 'prose', enabled: true, instructions: '' },
      { id: historyId, name: '棋局记录', kind: 'history', enabled: true, instructions: '' },
    ],
  })
  const installed = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  const withoutMap = store.save({ ...editable(installed), graph: { nodes: [], edges: [] } })
  const manualTurn = store.worldTurn(withoutMap.id)
  const manuallyAdvanced = store.dispatchWorldAction(withoutMap.id, {
    format: 0,
    revision: withoutMap.revision,
    cycleId: manualTurn!.cycleId,
    actionId: 'roll',
  })
  const stateBeforeWriting = manuallyAdvanced.world?.state as FlyingChessWorldState
  assert.equal(stateBeforeWriting.currentPlayerId, marisaId)

  const session = Session.create(SessionId('manual-world-result'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', reasoningEffort: 'high' as never, maxTokens: 4_096 } },
  })
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string }) {
        const system = options.system ?? ''
        if (!system.includes('指定人物认知')) throw new Error('不应调用额外故事阶段：' + system.slice(0, 40))
        const text = JSON.stringify({ observation: '看见已结算结果。', action: '', speech: null, insights: [] })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const agent = { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent
  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent,
    store,
    workspace: manuallyAdvanced,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '请把刚才的规则结果写入正文。' }],
    })],
    signal: new AbortController().signal,
  })

  const stageRequests = session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data]
    : [])
  assert.equal(stageRequests.some(request => request.stage === 'world-action'), false)
  assert.deepEqual(stageRequests.filter(request => request.stage === 'character').map(request => request.subjectId), [reimuId, marisaId])
  assert.match(JSON.stringify(stageRequests.find(request => request.stage === 'character'
    && request.subjectId === reimuId)?.dispatch), /thisCharacterRole=actor/u)
  assert.match(JSON.stringify(stageRequests.find(request => request.stage === 'character'
    && request.subjectId === marisaId)?.dispatch), /thisCharacterRole=observer/u)
  assert.deepEqual(result.worldEventSequences, [1, 2, 3])
  assert.match(result.finalDraft, /棋局开始：博丽灵梦、雾雨魔理沙 已就位。/u)
  assert.match(result.finalDraft, /博丽灵梦掷出 1。博丽灵梦没有可移动的飞机，本回合结束。/u)
  assert.equal(store.get(manuallyAdvanced.id).revision, manuallyAdvanced.revision)
  assert.equal((store.get(manuallyAdvanced.id).world?.state as FlyingChessWorldState).currentPlayerId, marisaId)
})

test('keeps the exact world outcome while preserving only private-section character state', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-grounded-world-turn-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 1 }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '权威世界结算' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const sanaeId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const characterId = createStoryOutputId()
  const historyId = createStoryOutputId()
  const configured = store.save({
    ...editable(created),
    characters: [
      character(reimuId, '博丽灵梦'),
      character(marisaId, '雾雨魔理沙'),
      character(sanaeId, '东风谷早苗'),
    ],
    outputs: [
      { id: proseId, name: '对局正文', kind: 'prose', enabled: true, instructions: '只写本轮。' },
      { id: characterId, name: '灵梦视角', kind: 'character', enabled: true, characterId: reimuId, instructions: '只写持久内容。' },
      { id: historyId, name: '公开回合记录', kind: 'history', enabled: true, instructions: '只写规则事实。' },
    ],
  })
  let installed = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  installed = store.save({
    ...editable(installed),
    graph: {
      ...installed.graph,
      nodes: installed.graph.nodes.map(node => node.id === installed.graph.activeNodeId
        ? { ...node, participantIds: [marisaId, sanaeId] }
        : node),
    },
  })
  const session = Session.create(SessionId('grounded-world-turn'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      async resolveModelInfo(provider: string, model: string) {
        return {
          provider,
          id: model,
          name: model,
          reasoning: {
            efforts: [
              { id: 'off', name: 'Off' },
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
            defaultEffort: 'high',
          },
        }
      },
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        const text = system.includes('结构化世界行动 Worker')
          ? JSON.stringify({ actionId: 'roll' })
          : system.includes('人物参与路由 Worker')
            ? JSON.stringify({ publicCharacterIds: [reimuId] })
          : system.includes('剧情研究 Worker')
            ? JSON.stringify({ findings: [], followUps: [] })
            : system.includes('指定人物认知')
              ? JSON.stringify({
                observation: '看见刚发生的结果。',
                action: '',
                speech: null,
                insights: body.includes('# 人物：博丽灵梦')
                  ? [{
                    kind: 'decision',
                    text: '这局前几手全是小点，飞机全压在基地里，灵梦打算先按兵不动。',
                    futureChoice: '遇到不利结果时，仍会接受结算并继续这局。',
                  }]
                  : [],
              })
              : system.includes('剧情导演 Worker')
                ? JSON.stringify({ sections: [
                  { sectionId: proseId, beats: ['表现刚发生的掷骰结果。'], speech: [] },
                  { sectionId: characterId, beats: [], speech: [] },
                  { sectionId: historyId, beats: [], speech: [] },
                ] })
                : system.includes('剧情连续性记录 Worker')
                  ? JSON.stringify({
                    history: { text: '错误的模型概括。', sourceSectionIds: [proseId] },
                    changes: {
                      characters: [
                        { sourceSectionId: characterId, characterId: reimuId, objective: '继续当前棋局' },
                        { sourceSectionId: proseId, characterId: marisaId, objective: '准备掷骰' },
                      ],
                      facts: [{
                        sourceSectionId: proseId,
                        text: '博丽灵梦掷出 1，四架飞机仍停在基地。',
                        knownBy: [reimuId, marisaId],
                      }],
                      nodes: [{
                        sourceSectionId: proseId,
                        ref: 'reimu-still-in-base',
                        kind: 'beat',
                        parent: { kind: 'node', nodeId: installed.graph.activeNodeId },
                        title: '灵梦仍未出基',
                        summary: '四架飞机仍停在基地。',
                        content: '等待后续世界回合掷出可出动点数。',
                        participantIds: [reimuId],
                        knowledge: { mode: 'participants', characterIds: [] },
                      }],
                      edges: [],
                    },
                  })
                : system.includes('分区的 prose Worker')
                  ? '正文故意遗漏刚发生的掷骰结果。'
                  : system.includes('分区的 character Worker')
                    ? JSON.stringify({ insights: [{ kind: 'world-action', text: '魔理沙准备在下一回合掷骰。' }] })
                    : system.includes('最终正文编辑 Worker')
                      ? JSON.stringify({ sections: [
                        { sectionId: proseId, text: '博丽灵梦掷出 1。博丽灵梦没有可移动的飞机，本回合结束。' },
                        { sectionId: historyId, text: '错误记录。' },
                      ] })
                      : '博丽灵梦掷出 1。博丽灵梦没有可移动的飞机，本回合结束。'
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const agent = { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent
  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent,
    store,
    workspace: installed,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '请让当前人物继续，并让魔理沙留意结果。' }],
    })],
    signal: new AbortController().signal,
  })

  const researchDispatch = JSON.stringify(session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'research' ? [event.data.dispatch] : []).at(0))
  assert.match(researchDispatch, /story:current-world-state/u)
  assert.match(researchDispatch, /当前第 2 回合，轮到 雾雨魔理沙/u)
  assert.match(researchDispatch, /story:current-world-outcome/u)
  assert.match(researchDispatch, /博丽灵梦掷出 1：第 1 回合掷骰结果为 1/u)
  assert.match(researchDispatch, /story:world-turn-transition/u)
  assert.match(researchDispatch, /实际行动人物：博丽灵梦/u)
  assert.match(researchDispatch, /下一行动者与玩家输入点名的刚完成行动者不同不是冲突/u)
  assert.match(researchDispatch, /历史中的较早状态不能覆盖当前状态/u)
  const stageRequests = session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data] : [])
  assert.equal(stageRequests.find(request => request.stage === 'world-action')?.dispatch.reasoningEffort, 'off')
  assert.equal(stageRequests.find(request => request.stage === 'cast')?.dispatch.reasoningEffort, 'off')
  assert.equal(stageRequests.find(request => request.stage === 'research')?.dispatch.reasoningEffort, 'low')
  assert.equal(stageRequests.find(request => request.stage === 'editor')?.dispatch.reasoningEffort, 'low')
  const characterRequests = session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'character' ? [event.data] : [])
  const reimuRequest = characterRequests.find(request => request.subjectId === reimuId)
  const marisaRequest = characterRequests.find(request => request.subjectId === marisaId)
  const sanaeRequest = characterRequests.find(request => request.subjectId === sanaeId)
  assert.match(JSON.stringify(reimuRequest?.dispatch), /thisCharacterRole=actor/u)
  assert.match(JSON.stringify(reimuRequest?.dispatch.messages), /publicResponse=allowed/u)
  assert.match(JSON.stringify(marisaRequest?.dispatch), /thisCharacterRole=observer/u)
  assert.match(JSON.stringify(marisaRequest?.dispatch.messages), /publicResponse=observe-only/u)
  assert.match(JSON.stringify(marisaRequest?.dispatch), /让魔理沙留意结果/u)
  assert.match(JSON.stringify(sanaeRequest?.dispatch), /thisCharacterRole=observer/u)
  assert.match(JSON.stringify(sanaeRequest?.dispatch.messages), /publicResponse=observe-only/u)
  assert.match(JSON.stringify(sanaeRequest?.dispatch), /让魔理沙留意结果/u)
  assert.deepEqual(result.worldEventSequences, [1, 2, 3])
  assert.equal(result.hostOnlyWorldDraft, undefined)
  assert.doesNotMatch(result.directorBrief, /表现刚发生的掷骰结果/u)
  assert.match(result.finalDraft, /## 对局正文\s+棋局开始：[\s\S]*博丽灵梦掷出 1。博丽灵梦没有可移动的飞机，本回合结束。/u)
  assert.equal(result.finalDraft.match(/博丽灵梦没有可移动的飞机，本回合结束。/gu)?.length, 1)
  assert.ok(result.finalDraft.indexOf('## 对局正文') < result.finalDraft.indexOf('## 公开回合记录'))
  assert.match(result.finalDraft, /博丽灵梦掷出 1：第 1 回合掷骰结果为 1/u)
  assert.match(result.finalDraft, /没有可移动的飞机：博丽灵梦结束本回合/u)
  assert.match(result.finalDraft, /## 灵梦视角[\s\S]*遇到不利结果时，仍会接受结算并继续这局/u)
  assert.doesNotMatch(result.finalDraft, /前几手全是小点|飞机全压在基地|错误记录|魔理沙视角|下一回合掷骰/u)
  assert.deepEqual(session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'section' ? [event.data.subjectId] : []), [])
  session.append('assistant/message', {
    turn: 2,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: result.finalDraft }],
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 2, step: 1 })
  const materialized = await materializeStoryTurn({
    ctx: fake,
    agent,
    store,
    workspaceId: installed.id,
    turn: 2,
    signal: new AbortController().signal,
  })
  const continuityRequest = session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'continuity' ? [event.data] : []).at(-1)
  assert.equal(continuityRequest?.dispatch.reasoningEffort, 'low')
  assert.deepEqual(materialized?.changes.characters, [{ characterId: reimuId, objective: '继续当前棋局' }])
  assert.equal(store.get(installed.id).characters.find(character => character.id === reimuId)?.state.objective, '继续当前棋局')
  assert.equal(store.get(installed.id).characters.find(character => character.id === marisaId)?.state.objective, '')
  assert.deepEqual(materialized?.changes.facts, [{
    text: '遇到不利结果时，仍会接受结算并继续这局。',
    knownBy: [reimuId],
  }])
  assert.deepEqual(materialized?.changes.nodes, [])
  assert.deepEqual(materialized?.changes.edges, [])
  assert.equal(typeof materialized?.continuityResultEventSeq, 'number')
  assert.match(materialized?.eventSummary ?? '', /博丽灵梦掷出 1/u)
  assert.doesNotMatch(materialized?.eventSummary ?? '', /错误的模型概括/u)
  assert.deepEqual(store.get(installed.id).events.at(-1)?.worldEventSequences, [1, 2, 3])
  assert.deepEqual(store.get(installed.id).characters.map(item => item.state), [
    { location: '', condition: '', objective: '继续当前棋局', notes: '' },
    { location: '', condition: '', objective: '', notes: '' },
    { location: '', condition: '', objective: '', notes: '' },
  ])
  const saved = store.get(installed.id)
  assert.match(compileStoryCharacterContext(saved, reimuId, { playerInput: '继续。' }).privateKnowledge, /遇到不利结果时/u)
  assert.doesNotMatch(compileStoryCharacterContext(saved, reimuId, { playerInput: '继续。' }).privateKnowledge, /前几手全是小点|飞机全压在基地/u)
  assert.doesNotMatch(compileStoryCharacterContext(saved, marisaId, { playerInput: '继续。' }).privateKnowledge, /遇到不利结果时/u)
  assert.equal(session.events.some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'continuity'), true)
})

test('assembles a grounded world result and approved dialogue without unowned model stages', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-host-world-dialogue-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 1 }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '权威世界对白' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const historyId = createStoryOutputId()
  const reimu = character(reimuId, '博丽灵梦')
  const marisa = character(marisaId, '雾雨魔理沙')
  const configured = store.save({
    ...editable(created),
    pipeline: { ...created.pipeline, voiceDraftReasoning: 'quality' },
    characters: [
      {
        ...reimu,
        voiceAliases: ['博麗霊夢', '霊夢'],
        profile: { ...reimu.profile, exampleDialogue: '灵梦：“你自己说过的话，还要问我？”' },
      },
      {
        ...marisa,
        voiceAliases: ['霧雨魔理沙', '魔理沙'],
        profile: { ...marisa.profile, exampleDialogue: '魔理沙：“说过又怎么样？”' },
      },
    ],
    outputs: [
      { id: proseId, name: '对局正文', kind: 'prose', enabled: true, instructions: '只写本轮。' },
      { id: historyId, name: '公开回合记录', kind: 'history', enabled: true, instructions: '记录规则事实。' },
    ],
  })
  const installed = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  const session = Session.create(SessionId('host-world-dialogue'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', reasoningEffort: 'high' as never, maxTokens: 32_768 } },
  })
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      async resolveModelInfo(provider: string, model: string) {
        return {
          provider,
          id: model,
          name: model,
          reasoning: {
            efforts: [
              { id: 'off', name: 'Off' },
              { id: 'none', name: 'None' },
              { id: 'minimal', name: 'Minimal' },
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
            defaultEffort: 'high',
          },
        }
      },
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        const targetSeedIds = [...new Set([...body.matchAll(/\[seed:([^\]]+)\]\[目标人物\]/gu)]
          .map(match => match[1]!))]
        const candidateSeeds = targetSeedIds.slice(0, Math.min(2, targetSeedIds.length))
        const sourceBackedVoice = body.includes('博麗霊夢｜')
        let text: string
        if (system.includes('结构化世界行动 Worker')) {
          text = JSON.stringify({ actionId: 'roll' })
        } else if (system.includes('人物参与路由 Worker')) {
          text = JSON.stringify({ publicCharacterIds: [reimuId] })
        } else if (system.includes('剧情研究 Worker')) {
          text = JSON.stringify({ findings: [], followUps: [] })
        } else if (system.includes('指定人物认知')) {
          text = body.includes('# 人物：博丽灵梦') && body.includes('只评价规则结果')
            ? JSON.stringify({
              observation: '本轮规则结果已经公开。',
              action: '',
              speech: {
                respondsTo: '魔理沙要求她评价刚完成的规则结果。',
                move: 'inform',
                focus: '刚刚掷骰结果为1。',
                effect: '让魔理沙承认刚刚掷骰结果为1。',
              },
              insights: [],
            })
            : body.includes('# 人物：博丽灵梦')
            ? JSON.stringify({
              observation: '听见魔理沙追问。',
              action: '',
              speech: {
                respondsTo: '魔理沙追问她指的是哪句话。',
                move: 'answer',
                focus: '魔理沙自己采用的接法。',
                effect: '让魔理沙承认她自己把两个判断接在了一起。',
              },
              insights: [
                {
                  kind: 'intention',
                  text: '继续逼魔理沙承认她自己把两个判断接在了一起。',
                  futureChoice: '本轮回答结束后继续指出魔理沙自己把两个判断接在了一起。',
                },
                {
                  kind: 'intention',
                  text: '决定如果魔理沙以后又把两个判断接在一起，就用同样的问题回敬她。',
                  futureChoice: '若魔理沙再次这样，就主动开口要求她回答。',
                },
              ],
            })
            : JSON.stringify({
              observation: '灵梦刚完成本轮。',
              action: '抢在灵梦之前追问。',
              speech: {
                respondsTo: '灵梦刚完成本轮。',
                move: 'question',
                focus: '灵梦不再继续说明的原因。',
                effect: '让灵梦继续说明。',
              },
              insights: [],
            })
        } else if (system.includes('剧情导演 Worker')) {
          text = JSON.stringify({ sections: [
            { sectionId: proseId, beats: [], speech: [{ characterId: reimuId }] },
            { sectionId: historyId, beats: [], speech: [] },
          ] })
        } else if (system.includes('人物自己的对白 Worker')) {
          text = JSON.stringify({ lines: [{
            reference: `speech:${proseId}:1`,
            move: 'answer',
            seedLineIds: candidateSeeds,
            mechanics: '先把对方的问题翻回其已经说过的话',
            leftImplicit: '两句话具体怎样被接到一起。',
            dialogue: sourceBackedVoice
              ? '“都被你接到一块了，怎么反倒来问我？”'
              : '“你自己把两句话接在一起，还问我是哪句？”',
          }] })
        } else if (system.includes('对白审校 Worker')) {
          text = JSON.stringify({ lines: [{
            reference: `speech:${proseId}:1`,
            dialogue: sourceBackedVoice
              ? '都被你接到一块了，怎么反倒来问我？'
              : '你自己把两句话接在一起，还问我是哪句？',
          }] })
        } else {
          throw new Error(`不应调用额外故事阶段：${system.slice(0, 40)}`)
        }
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const agent = { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent

  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent,
    store,
    workspace: installed,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '魔理沙追问灵梦指的是哪句话，请让灵梦回答；不要复述棋局事实。' }],
    })],
    signal: new AbortController().signal,
  })

  assert.doesNotMatch(result.finalDraft, /博丽灵梦掷出 1|没有可移动的飞机/u)
  assert.match(result.finalDraft, /“你自己把两句话接在一起，还问我是哪句？”/u)
  assert.doesNotMatch(result.finalDraft, /## 公开回合记录/u)
  assert.equal(result.hostOnlyWorldDraft, undefined)
  assert.equal(result.hostOwnedWorldDraft, true)
  assert.deepEqual(result.publicDialogues, [{
    characterId: reimuId,
    dialogue: '“你自己把两句话接在一起，还问我是哪句？”',
  }])
  const stageRequests = session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data]
    : [])
  assert.equal(stageRequests.find(request => request.stage === 'world-action')?.dispatch.reasoningEffort, 'off')
  assert.equal(stageRequests.find(request => request.stage === 'cast')?.dispatch.reasoningEffort, 'off')
  assert.equal(stageRequests.find(request => request.stage === 'voice'
    && request.subjectId?.startsWith('draft:') === true)?.dispatch.reasoningEffort, 'high')
  assert.equal(stageRequests.find(request => request.stage === 'voice'
    && request.subjectId?.startsWith('review:') === true)?.dispatch.reasoningEffort, 'off')
  assert.equal(stageRequests.some(request => request.stage === 'cast'), true)
  const characterRequests = stageRequests.filter(request => request.stage === 'character')
  const reimuCharacterBody = JSON.stringify(characterRequests.find(request => request.subjectId === reimuId)?.dispatch.messages)
  assert.match(reimuCharacterBody, /publicResponse=allowed/u)
  assert.doesNotMatch(reimuCharacterBody, /<voice_evidence>|#seed-/u)
  assert.match(JSON.stringify(characterRequests.find(request => request.subjectId === marisaId)?.dispatch.messages), /publicResponse=observe-only/u)
  const voiceDraftBody = JSON.stringify(stageRequests.find(request => request.stage === 'voice'
    && request.subjectId?.startsWith(`draft:${reimuId}:`) === true)?.dispatch.messages)
  assert.match(voiceDraftBody, new RegExp(`character:${reimuId}:example-dialogue`, 'u'))
  assert.match(voiceDraftBody, /\[目标人物\]\[示例\] 灵梦｜你自己说过的话，还要问我？/u)
  assert.equal(voiceDraftBody.match(/你自己说过的话，还要问我/gu)?.length, 1)
  assert.deepEqual(stageRequests.flatMap(request =>
    (request.stage === 'research' || request.stage === 'director' || request.stage === 'section' || request.stage === 'editor')
      ? [request.stage]
      : []), [])
  assert.doesNotMatch(result.directorBrief, /继续逼魔理沙|同样的问题回敬/u)
  assert.doesNotMatch(result.finalDraft, /说过又怎么样|为什么不继续说明|抢在灵梦之前/u)
  session.append('assistant/message', {
    turn: 2,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: result.finalDraft }],
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 2, step: 1 })
  const materialized = await materializeStoryTurn({
    ctx: fake,
    agent,
    store,
    workspaceId: installed.id,
    turn: 2,
    signal: new AbortController().signal,
  })
  assert.equal(materialized?.continuityResultEventSeq, undefined)
  assert.match(materialized?.eventSummary ?? '', /博丽灵梦说：“你自己把两句话接在一起，还问我是哪句？”/u)
  assert.deepEqual(materialized?.changes.facts, [{
    text: '博丽灵梦说：“你自己把两句话接在一起，还问我是哪句？”',
    knownBy: [reimuId, marisaId],
  }])
  const saved = store.get(installed.id)
  assert.match(compileStoryCharacterContext(saved, reimuId, { playerInput: '继续。' }).privateKnowledge, /博丽灵梦说/u)
  assert.match(compileStoryCharacterContext(saved, marisaId, { playerInput: '继续。' }).privateKnowledge, /博丽灵梦说/u)
  assert.equal(session.events.some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'continuity'), false)

  const originalDialogueSourceId = createStorySourceId()
  const sourced = store.save({
    ...editable(saved),
    sources: [{
      id: originalDialogueSourceId,
      name: '单段原作对白',
      kind: 'original',
      enabled: true,
      content: [
        '原文：',
        '霧雨魔理沙：「どの台詞のことだ？」',
        '博麗霊夢：「自分で二つの話を繋げておいて、どっちかなんて聞くの？」',
        '参考译文：',
        '雾雨魔理沙：“你问的是哪句话？”',
        '博丽灵梦：“你自己把两句话接在一起，还问我是哪句？”',
      ].join('\n'),
    }],
  })
  const sourcedSession = Session.create(SessionId('host-world-dialogue-sourced'))
  sourcedSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', reasoningEffort: 'high' as never, maxTokens: 32_768 } },
  })
  sourcedSession.append('turn/start', { turn: 3 })
  sourcedSession.append('step/start', { turn: 3, step: 1 })
  const sourcedAgent = {
    id: sourcedSession.id,
    options: { provider: 'fixture', model: 'fixture' },
    session: sourcedSession,
  } as Agent
  const sourcedResult = await runStoryTurnPipeline({
    ctx: fake,
    agent: sourcedAgent,
    store,
    workspace: sourced,
    turn: 3,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '魔理沙追问灵梦指的是哪句话，请让灵梦回答。' }],
    })],
    signal: new AbortController().signal,
  })
  const sourcedStageRequests = sourcedSession.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data]
    : [])
  const sourcedBrief = sourcedSession.events.findLast(event => event.type === 'agent-rp/story-turn-brief')?.data
  const sourcedVoiceBody = JSON.stringify(sourcedStageRequests.find(request => request.stage === 'voice'
    && request.subjectId?.startsWith(`draft:${reimuId}:`) === true)?.dispatch.messages)
  assert.match(sourcedVoiceBody, /local:source-[0-9a-f-]+:\d+/u)
  assert.match(sourcedVoiceBody, /\[对话上下文\]\[原文\] 霧雨魔理沙｜どの台詞のことだ？/u)
  assert.match(sourcedVoiceBody, /\[目标人物\]\[原文\] 博麗霊夢｜自分で二つの話を繋げておいて、どっちかなんて聞くの？/u)
  assert.match(sourcedVoiceBody, /\[对话上下文\]\[参考译文\] 雾雨魔理沙｜你问的是哪句话？/u)
  assert.match(sourcedVoiceBody, /\[目标人物\]\[参考译文\] 博丽灵梦｜你自己把两句话接在一起，还问我是哪句？/u)
  assert.doesNotMatch(sourcedVoiceBody, /\[目标人物\]\[(?:原文|参考译文)\] (?:霧雨魔理沙|雾雨魔理沙)/u)
  const reimuOriginalSeed = sourcedVoiceBody.match(/\[seed:([^\]]+)\]\[目标人物\]\[原文\] 博麗霊夢｜/u)?.[1]
  const reimuTranslationSeed = sourcedVoiceBody.match(/\[seed:([^\]]+)\]\[目标人物\]\[参考译文\] 博丽灵梦｜/u)?.[1]
  assert.equal(typeof reimuOriginalSeed, 'string')
  assert.equal(reimuTranslationSeed, reimuOriginalSeed)
  assert.doesNotMatch(sourcedVoiceBody, new RegExp(`character:${reimuId}:example-dialogue`, 'u'))
  assert.doesNotMatch(sourcedVoiceBody, /你自己说过的话，还要问我/u)
  const sourcedReimuCharacterBody = JSON.stringify(sourcedStageRequests.find(request => request.stage === 'character'
    && request.subjectId === reimuId)?.dispatch.messages)
  assert.doesNotMatch(sourcedReimuCharacterBody, /博麗霊夢|霧雨魔理沙|自分で二つの話/u)
  const sourcedVoiceCitations = sourcedBrief?.publicDialogues?.[0]?.voiceCitations
  assert.equal(sourcedVoiceCitations?.length, 1)
  assert.equal(sourcedVoiceCitations?.[0]?.sourceId, originalDialogueSourceId)
  assert.match(sourcedVoiceCitations?.[0]?.quote ?? '', /霧雨魔理沙：「どの台詞のことだ？」/u)
  assert.match(sourcedVoiceCitations?.[0]?.quote ?? '', /博麗霊夢：「自分で二つの話を繋げておいて、どっちかなんて聞くの？」/u)
  assert.equal(sourcedVoiceCitations?.[0]?.note, '用于校准“博丽灵梦”本回合获准对白')
  assert.deepEqual(sourcedResult.publicDialogues?.map(({ characterId, dialogue }) => ({ characterId, dialogue })), [{
    characterId: reimuId,
    dialogue: '“都被你接到一块了，怎么反倒来问我？”',
  }])

  sourcedSession.append('assistant/message', {
    turn: 3,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: sourcedResult.finalDraft }],
    }),
  }, { surfaceOp: 'append' })
  sourcedSession.append('step/end', { turn: 3, step: 1 })
  await materializeStoryTurn({
    ctx: fake,
    agent: sourcedAgent,
    store,
    workspaceId: sourced.id,
    turn: 3,
    signal: new AbortController().signal,
  })

  const constrainedWorkspace = store.get(sourced.id)
  const constrainedSession = Session.create(SessionId('host-world-dialogue-no-world-restatement'))
  constrainedSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', reasoningEffort: 'high' as never, maxTokens: 32_768 } },
  })
  constrainedSession.append('turn/start', { turn: 4 })
  constrainedSession.append('step/start', { turn: 4, step: 1 })
  const constrainedAgent = {
    id: constrainedSession.id,
    options: { provider: 'fixture', model: 'fixture' },
    session: constrainedSession,
  } as Agent
  const constrainedResult = await runStoryTurnPipeline({
    ctx: fake,
    agent: constrainedAgent,
    store,
    workspace: constrainedWorkspace,
    turn: 4,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '只评价规则结果；不要复述棋局事实。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(constrainedResult.publicDialogues?.length ?? 0, 0)
  assert.equal(constrainedSession.events.some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'voice'), false)
})
