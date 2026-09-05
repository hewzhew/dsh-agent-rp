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
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createFlyingChessWorldModule } from '../src/flying-chess-world.ts'
import {
  FLYING_CHESS_WORLD_MODULE_ID,
  type FlyingChessWorldState,
} from '../src/flying-chess-protocol.ts'
import { PlayWorldRegistry, projectPlayWorldNarrative, type PlayWorldContext, type PlayWorldModule } from '../src/play-world.ts'
import { RoleplayResourceCatalog } from '../src/roleplay-resource-catalog.ts'
import {
  FLYING_CHESS_WORLD_CONFIGURATION,
  FLYING_CHESS_WORLD_CAST_SLOTS,
  FLYING_CHESS_WORLD_RESOURCE_ID,
  flyingChessWorldResourceProvider,
} from '../src/play-world-resource-provider.ts'
import type { AgentRpHttpServer } from '../src/host-http.ts'
import { installStoryWorkspaceHttp } from '../src/story-workspace-http.ts'
import { parseAgentRpSessionLaunchRequest } from '../src/session-launch.ts'
import { appendAgentRpSessionEvent } from '../src/session-event-append.ts'
import { createStoryWorkspaceSessionSeed, readSessionStoryWorkspaceId } from '../src/session-story-workspace.ts'
import { acceptStorySuggestionBatch } from '../src/story-suggestion-batch.ts'
import {
  advanceStoryWorldByCharacter,
  materializeStoryTurn,
  recoverUnmaterializedStoryTurns,
  runStoryTurnPipeline,
  stopStoryTurnPipeline,
} from '../src/story-turn-pipeline.ts'
import { resolveStoryTurnRequest } from '../src/story-turn-request.ts'
import { storyPendingWorldEvents } from '../src/story-world-events.ts'
import {
  STORY_AUTO_ADVANCE_INPUT,
  type StoryCharacter,
  type StoryWorkspaceSaveRequest,
  type StoryWorkspaceSnapshot,
} from '../src/story-workspace-protocol.ts'
import {
  compileStoryCharacterContext,
  compileStoryDirectorWorldContext,
  createStoryCharacterId,
  createStoryCitationId,
  createStoryEventId,
  createStoryFactId,
  createStoryNodeId,
  createStoryOutputId,
  createStorySourceId,
  resolveStoryPlayWorldContext,
  StoryWorkspaceStore,
} from '../src/story-workspace.ts'
import { sessionEvents } from '../src/session-events.ts'

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
    projectSurface(snapshot, context) {
      const state = this.normalize(snapshot, context).state as { readonly step: number }
      return {
        title: name,
        status: `计数 ${String(state.step)}`,
        summary: '测试世界场地摘要。',
        facts: [],
        composerSuggestions: [],
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
    projectNarrative(snapshot, eventSequences, context) {
      const events = this.normalize(snapshot, context).events.filter(event => eventSequences.includes(event.sequence))
      return {
        cadence: 'scene',
        facts: [{
          eventSequences: events.map(event => event.sequence),
          retention: 'essential',
          text: events.map(event => `${event.title}。`).join(''),
        }],
        cues: [],
      }
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
      configuration: selection.id === FLYING_CHESS_WORLD_RESOURCE_ID
        ? FLYING_CHESS_WORLD_CONFIGURATION
        : {},
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

test('commits an intentionally omitted scene without leaving world events or private memory pending', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-omitted-world-scene-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(counterWorldModule())
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '省略规则复述' })
  const actorId = createStoryCharacterId()
  const prepared = store.save({ ...editable(created), characters: [character(actorId, '测试人物')] })
  const installed = store.installWorld(prepared.id, {
    format: 0,
    revision: prepared.revision,
    resource: { kind: 'world', id: fixtureWorldResourceId('fixture/counter') },
    cast: [],
  })
  const turn = store.worldTurn(installed.id)
  assert.ok(turn !== undefined)
  const advanced = store.dispatchWorldAction(installed.id, {
    format: 0,
    revision: installed.revision,
    cycleId: turn.cycleId,
    actionId: turn.actions[0]!.id,
  })
  const session = Session.create(SessionId('omitted-world-scene'))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  appendAgentRpSessionEvent(session, 'agent-rp/story-turn-brief', {
    format: 1,
    sessionId: String(session.id),
    workspaceId: advanced.id,
    workspaceRevision: advanced.revision,
    turn: 1,
    step: 1,
    resultEventSeqs: [],
    worldEventSequences: [0, 1],
    directorBrief: '仅供内部使用的导演材料。',
    finalSections: [],
    privateCharacterStates: [{
      characterId: actorId,
      insights: [{ kind: 'decision', text: '下一次仍继续当前计数。' }],
    }],
    finalDraft: '',
    modelContext: '',
  })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const fake = {
    sessions: { flush: async () => true },
    llm: { stream() { throw new Error('省略正文不应再调用连续性模型') } },
  } as unknown as Context
  const agent = { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent

  const recovered = await recoverUnmaterializedStoryTurns({ ctx: fake, agent, store })
  const materialized = recovered[0]

  assert.equal(recovered.length, 1)
  assert.equal(materialized?.continuityResultEventSeq, undefined)
  assert.match(materialized?.eventSummary ?? '', /计数值变为 1/u)
  assert.deepEqual(materialized?.changes.facts, [{ text: '下一次仍继续当前计数。', knownBy: [actorId] }])
  const saved = store.get(advanced.id)
  assert.equal(saved.events.length, 1)
  assert.equal(saved.events[0]?.evidence, '')
  assert.deepEqual(saved.events[0]?.worldEventSequences, [0, 1])
  assert.deepEqual(storyPendingWorldEvents(saved), [])
  assert.doesNotMatch(resolveStoryTurnRequest(saved, ''), /尚未写入正文/u)
  assert.match(compileStoryCharacterContext(saved, actorId, { playerInput: '继续。' }, worlds).privateKnowledge, /继续当前计数/u)
  assert.equal(sessionEvents(session).some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'continuity'), false)
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
  ])
  assert.deepEqual(upgraded.worldBinding?.resource, { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID })
  assert.equal(upgraded.worldBinding?.moduleId, FLYING_CHESS_WORLD_MODULE_ID)
  assert.deepEqual(upgraded.worldBinding?.configuration, FLYING_CHESS_WORLD_CONFIGURATION)
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

test('updates resource-authored narrative cards without resetting the current world', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-world-configuration-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule())
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '事件牌配置' })
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
    cast: [],
  })
  const beforeWorld = structuredClone(installed.world)
  const configuration = {
    format: 0,
    ruleset: 'classic-24',
    narrativeCards: [{
      id: 'custom-card',
      trigger: { kind: 'consecutive-passes', count: 3 },
      event: { title: '茶杯倾斜', summary: '连续三轮停顿后，桌沿的茶杯向棋盘倾斜。' },
      cue: { kind: 'pressure', text: '其他人物可以决定先顾棋盘还是先扶茶杯。', responders: 'opponents' },
      repeat: false,
    }],
  }
  const route = storyWorkspaceRoute(store)
  const path = `/api/agent-rp/story-workspaces/${encodeURIComponent(installed.id)}/world/configuration`
  const response = await invokeStoryWorkspaceRoute(route, 'POST', path, {
    format: 0,
    revision: installed.revision,
    configuration,
  })
  assert.equal(response.status, 200)
  const updated = store.get(installed.id)
  assert.deepEqual(updated.world, beforeWorld)
  assert.deepEqual(updated.worldBinding?.configuration, configuration)

  const invalid = await invokeStoryWorkspaceRoute(route, 'POST', path, {
    format: 0,
    revision: updated.revision,
    configuration: {
      ...configuration,
      narrativeCards: [{ ...configuration.narrativeCards[0]!, trigger: { kind: 'consecutive-passes', count: 1 } }],
    },
  })
  assert.equal(invalid.status, 400)
  assert.deepEqual(store.get(installed.id), updated)

  const stale = await invokeStoryWorkspaceRoute(route, 'POST', path, {
    format: 0,
    revision: installed.revision,
    configuration,
  })
  assert.equal(stale.status, 409)

  const restoredStore = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const restored = restoredStore.get(installed.id)
  assert.deepEqual(restored.world, beforeWorld)
  assert.deepEqual(restored.worldBinding?.configuration, configuration)
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
  assert.deepEqual((read.body as { readonly worldSurface?: unknown }).worldSurface, {
    title: '计数世界',
    status: '计数 0',
    summary: '测试世界场地摘要。',
    facts: [],
    composerSuggestions: [],
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
  assert.equal((advanced.body as { readonly worldSurface: { readonly status: string } }).worldSurface.status, '计数 1')
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
  assert.equal(worlds.get(FLYING_CHESS_WORLD_MODULE_ID).projectNarrative(
    moved.world!,
    [2, 3],
    resolveStoryPlayWorldContext(moved),
  ).facts[0]?.text, '博丽灵梦掷出的骰子停在 6 点，随后把 1 号飞机推进到航线第 1 步。')

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

test('turns a stalled flying-chess opening into a recorded scene pressure', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-stalled-flying-chess-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 1 }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '僵持场景' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  let workspace = store.save({
    ...editable(created),
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
  })
  workspace = store.installWorld(workspace.id, {
    format: 0,
    revision: workspace.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })

  for (let turn = 0; turn < 4; turn += 1) {
    const available = store.worldTurn(workspace.id)
    assert.equal(available?.actions[0]?.id, 'roll')
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: available!.cycleId,
      actionId: 'roll',
    })
  }

  const scene = workspace.world?.events.at(-1)
  assert.equal(scene?.type, 'scene.changed')
  assert.match(scene?.summary ?? '', /一阵风忽然掀起棋盘一角/u)
  const eventSequences = workspace.world!.events.map(event => event.sequence)
  const playContext = resolveStoryPlayWorldContext(workspace)
  const projection = projectPlayWorldNarrative(
    worlds.get(FLYING_CHESS_WORLD_MODULE_ID).projectNarrative(
      workspace.world!, eventSequences, playContext,
    ),
    eventSequences,
    playContext,
  )
  assert.equal(projection.cadence, 'scene')
  assert.equal(projection.facts.filter(fact => fact.retention === 'compressible').length, 2)
  assert.match(projection.facts.find(fact => fact.retention === 'essential')?.text ?? '', /一阵风忽然掀起棋盘一角/u)
  assert.deepEqual(projection.invariants, [{
    id: 'single-board',
    text: '场景中只有一张棋盘。',
  }, {
    id: 'shared-die',
    text: '场景中只有一枚由各回合共用的骰子；投掷次数不能改写成骰子数量。',
  }])
  assert.deepEqual(projection.cues.find(cue => cue.kind === 'pressure'), {
    eventSequences: [scene!.sequence],
    kind: 'pressure',
    text: '棋盘需要先被重新压稳。刚完成本轮行动的人物可以决定怎样处理；动作完成后，其他人物只能在后续轮次回应。',
    characterIds: [marisaId],
  })
  assert.match(compileStoryCharacterContext(workspace, reimuId, { playerInput: '' }, worlds).worldContext, /棋盘被风掀动/u)
  assert.match(compileStoryCharacterContext(workspace, marisaId, { playerInput: '' }, worlds).worldContext, /棋盘被风掀动/u)
  for (let turn = 0; turn < 4; turn += 1) {
    const available = store.worldTurn(workspace.id)!
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: available.cycleId,
      actionId: 'roll',
    })
  }
  assert.equal(workspace.world?.events.filter(event => event.type === 'scene.changed').length, 1)
  assert.throws(() => projectPlayWorldNarrative({
    cadence: 'scene',
    facts: projection.facts,
    cues: [{ ...projection.cues[0]!, eventSequences: [999] }],
  }, eventSequences, playContext), /未选择的世界事件/u)
  assert.throws(() => projectPlayWorldNarrative({
    cadence: 'scene',
    facts: projection.facts,
    cues: projection.cues,
    invariants: [{ id: 'same', text: '第一项。' }, { id: 'same', text: '第二项。' }],
  }, eventSequences, playContext), /叙事不变量 2 id 无效/u)
  assert.throws(() => projectPlayWorldNarrative({
    cadence: 'scene',
    facts: [{ ...projection.facts[0]!, retention: 'invalid' as 'essential' }],
    cues: [],
  }, eventSequences, playContext), /叙事事实 1保留方式无效/u)
})

test('draws authored scene cards from landing, collision, and home-count events', () => {
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const playContext: PlayWorldContext = {
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
    configuration: {
      format: 0,
      ruleset: 'classic-24',
      narrativeCards: [{
        id: 'launch-hook',
        trigger: { kind: 'piece-launched' },
        event: { title: '折签露出', summary: '第一架棋子离开基地时，一张折签露出半角。' },
        cue: { kind: 'opportunity', text: '所有人物都看见了折签。', responders: 'all' },
        repeat: false,
      }, {
        id: 'landing-eight',
        trigger: { kind: 'piece-landed', step: 8 },
        event: { title: '折签弹开', summary: '棋子停在第 8 步时，一张折签弹开。' },
        cue: { kind: 'opportunity', text: '行动人物可以使用折签。', responders: 'actor' },
        repeat: false,
      }, {
        id: 'capture-response',
        trigger: { kind: 'piece-captured' },
        event: { title: '棋子撞落', summary: '碰撞让一架棋子回到基地。' },
        cue: { kind: 'relationship', text: '被撞的一方可以回应损失。', responders: 'opponents' },
        repeat: true,
      }, {
        id: 'first-home',
        trigger: { kind: 'player-home-count', count: 1 },
        event: { title: '第一架抵达', summary: '一位棋手有第一架棋子抵达终点。' },
        cue: { kind: 'change', text: '所有人物可以回应局势进入终盘。', responders: 'all' },
        repeat: false,
      }],
    },
    sourceReferences: [],
  }

  const rolls = [6, 6, 1]
  const landingModule = createFlyingChessWorldModule({ rollDie: () => rolls.shift()! })
  let landed = landingModule.create(playContext)
  for (let index = 0; index < 3; index += 1) {
    let turn = landingModule.characterTurn(landed, playContext)!
    landed = landingModule.dispatch(landed, turn.actions[0]!.action, playContext)
    turn = landingModule.characterTurn(landed, playContext)!
    landed = landingModule.dispatch(landed, turn.actions[0]!.action, playContext)
  }
  const launchCards = landed.events.filter(event => event.type === 'scene.changed'
    && (event.data as { readonly cardId?: unknown }).cardId === 'launch-hook')
  assert.equal(launchCards.length, 1)
  const launchProjection = landingModule.projectNarrative(landed, [launchCards[0]!.sequence], playContext)
  assert.deepEqual(launchProjection.cues[0]?.characterIds, [reimuId, marisaId])
  const landingCard = landed.events.find(event => event.type === 'scene.changed'
    && (event.data as { readonly cardId?: unknown }).cardId === 'landing-eight')!
  assert.equal(typeof (landingCard.data as { readonly causeSequence?: unknown }).causeSequence, 'number')
  const landingProjection = landingModule.projectNarrative(landed, [landingCard.sequence], playContext)
  assert.deepEqual(landingProjection.cues[0]?.characterIds, [reimuId])

  const collisionModule = createFlyingChessWorldModule()
  const collisionCreated = collisionModule.create(playContext)
  const collisionState = collisionCreated.state as FlyingChessWorldState
  const reimuPiece = collisionState.pieces.find(piece => piece.ownerId === reimuId)!
  const marisaPiece = collisionState.pieces.find(piece => piece.ownerId === marisaId)!
  const collisionPrepared = {
    ...collisionCreated,
    state: {
      ...collisionState,
      pieces: collisionState.pieces.map(piece => piece.id === reimuPiece.id
        ? { ...piece, status: 'track' as const, steps: 12 }
        : piece.id === marisaPiece.id
          ? { ...piece, status: 'track' as const, steps: 1 }
          : piece),
      pendingRoll: { playerId: reimuId, value: 1, legalPieceIds: [reimuPiece.id] },
    },
  }
  const collided = collisionModule.dispatch(collisionPrepared, {
    type: 'move', actorId: reimuId, pieceId: reimuPiece.id,
  }, playContext)
  const collisionCard = collided.events.find(event => event.type === 'scene.changed'
    && (event.data as { readonly cardId?: unknown }).cardId === 'capture-response')!
  const collisionProjection = collisionModule.projectNarrative(collided, [collisionCard.sequence], playContext)
  assert.deepEqual(collisionProjection.cues[0]?.characterIds, [marisaId])

  const homeModule = createFlyingChessWorldModule()
  const homeCreated = homeModule.create(playContext)
  const homeState = homeCreated.state as FlyingChessWorldState
  const homePiece = homeState.pieces.find(piece => piece.ownerId === reimuId)!
  const homePrepared = {
    ...homeCreated,
    state: {
      ...homeState,
      pieces: homeState.pieces.map(piece => piece.id === homePiece.id
        ? { ...piece, status: 'track' as const, steps: 23 }
        : piece),
      pendingRoll: { playerId: reimuId, value: 1, legalPieceIds: [homePiece.id] },
    },
  }
  const arrived = homeModule.dispatch(homePrepared, {
    type: 'move', actorId: reimuId, pieceId: homePiece.id,
  }, playContext)
  const homeCard = arrived.events.find(event => event.type === 'scene.changed'
    && (event.data as { readonly cardId?: unknown }).cardId === 'first-home')!
  const homeProjection = homeModule.projectNarrative(arrived, [homeCard.sequence], playContext)
  assert.deepEqual(homeProjection.cues[0]?.characterIds, [reimuId, marisaId])
})

test('distinguishes optional landing cards from durable route checkpoints', () => {
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const playContext: PlayWorldContext = {
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
    configuration: {
      format: 0,
      ruleset: 'classic-24',
      narrativeCards: [{
        id: 'landing-eight',
        trigger: { kind: 'piece-landed', step: 8 },
        event: { title: '第八格', summary: '木机恰好停在第八格。' },
        cue: { kind: 'change', text: '这是可以错过的格面效果。', responders: 'none' },
        repeat: false,
      }, {
        id: 'crossing-eight',
        trigger: { kind: 'piece-crossed-step', step: 8 },
        event: { title: '越过第八步', summary: '木机第一次推进到或越过第八步。' },
        cue: { kind: 'change', text: '这是必须兑现的故事检查点。', responders: 'none' },
        repeat: false,
      }],
    },
    sourceReferences: [],
  }
  const module = createFlyingChessWorldModule()
  const created = module.create(playContext)
  const state = created.state as FlyingChessWorldState
  const piece = state.pieces.find(item => item.ownerId === reimuId)!
  const advanced = module.dispatch({
    ...created,
    state: {
      ...state,
      pieces: state.pieces.map(item => item.id === piece.id
        ? { ...item, status: 'track' as const, steps: 7 }
        : item),
      pendingRoll: { playerId: reimuId, value: 4, legalPieceIds: [piece.id] },
    },
  }, { type: 'move', actorId: reimuId, pieceId: piece.id }, playContext)

  const firedCardIds = advanced.events.flatMap(item => {
    const cardId = (item.data as { readonly cardId?: unknown } | undefined)?.cardId
    return typeof cardId === 'string' ? [cardId] : []
  })
  assert.deepEqual(firedCardIds, ['crossing-eight'])
  const crossingEvent = advanced.events.find(item =>
    (item.data as { readonly cardId?: unknown } | undefined)?.cardId === 'crossing-eight')!
  assert.equal((crossingEvent.data as { readonly causeSequence?: unknown }).causeSequence,
    advanced.events.find(item => item.type === 'piece.moved')?.sequence)
})

test('unlocks linked scene cards in order and keeps their unresolved fact in world context', () => {
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const playContext: PlayWorldContext = {
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
    configuration: {
      format: 0,
      ruleset: 'classic-24',
      narrativeCards: [{
        id: 'slip-appears',
        trigger: { kind: 'piece-launched' },
        event: { title: '折签露出', summary: '一张只露出背面的折签从棋盘下滑出半截。' },
        cue: { kind: 'change', text: '折签仍被棋盘压住。', responders: 'none' },
        repeat: false,
      }, {
        id: 'slip-opens',
        afterCardId: 'slip-appears',
        trigger: { kind: 'piece-launched' },
        event: { title: '折签翻开', summary: '先前露出的折签被第二架起飞的木机完整带出。' },
        cue: { kind: 'opportunity', text: '行动人物可以读取折签。', responders: 'actor' },
        repeat: false,
      }],
    },
    sourceReferences: [],
  }
  const rolls = [6, 1, 6]
  const module = createFlyingChessWorldModule({ rollDie: () => rolls.shift()! })
  let snapshot = module.create(playContext)

  let turn = module.characterTurn(snapshot, playContext)!
  snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
  turn = module.characterTurn(snapshot, playContext)!
  snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)

  const appeared = snapshot.events.find(item => (item.data as { readonly cardId?: unknown } | undefined)?.cardId === 'slip-appears')!
  assert.equal(snapshot.events.some(item => (item.data as { readonly cardId?: unknown } | undefined)?.cardId === 'slip-opens'), false)
  assert.match(module.projectForCharacter(snapshot, reimuId, playContext).text, /持续只读的公开现场状态[\s\S]*折签露出/u)
  assert.deepEqual(module.projectNarrative(snapshot, [appeared.sequence], playContext).cues[0]?.characterIds, [])

  turn = module.characterTurn(snapshot, playContext)!
  snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
  const laterEvent = snapshot.events.at(-1)!
  assert.match(module.projectNarrative(snapshot, [laterEvent.sequence], playContext).invariants?.at(-1)?.text ?? '',
    /物件的位置、朝向、可见内容与处置状态都保持不变/u)

  for (let index = 1; index < 4; index += 1) {
    turn = module.characterTurn(snapshot, playContext)!
    snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
  }
  const opened = snapshot.events.find(item => (item.data as { readonly cardId?: unknown } | undefined)?.cardId === 'slip-opens')!
  assert.equal((opened.data as { readonly predecessorSequence?: unknown }).predecessorSequence, appeared.sequence)
  assert.doesNotMatch(module.projectForCharacter(snapshot, reimuId, playContext).text, /持续只读的公开现场状态/u)
  assert.equal(module.projectNarrative(snapshot, [opened.sequence], playContext).invariants?.some(
    invariant => invariant.id.startsWith('unresolved-narrative-'),
  ), false)
})

test('rejects missing and cyclic scene-card prerequisites', () => {
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const baseCard = {
    trigger: { kind: 'piece-launched' } as const,
    event: { title: '折签变化', summary: '折签的状态发生变化。' },
    cue: { kind: 'change' as const, text: '现场保留这项变化。', responders: 'none' as const },
    repeat: false,
  }
  const module = createFlyingChessWorldModule()
  const contextWith = (narrativeCards: JsonValue[]): PlayWorldContext => ({
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
    configuration: { format: 0, ruleset: 'classic-24', narrativeCards },
    sourceReferences: [],
  })
  assert.throws(() => module.create(contextWith([{ ...baseCard, id: 'second', afterCardId: 'missing' }])), /不存在的事件牌/u)
  assert.throws(() => module.create(contextWith([
    { ...baseCard, id: 'first', afterCardId: 'second' },
    { ...baseCard, id: 'second', afterCardId: 'first' },
  ])), /形成了循环/u)
  assert.throws(() => module.create(contextWith([{
    ...baseCard,
    id: 'unaddressed-opportunity',
    cue: {
      kind: 'opportunity',
      text: '这项机会没有可以回应的人物。',
      responders: 'none',
      opportunity: { kind: 'speech', move: 'propose', targets: 'opponents' },
    },
  }])), /事件牌 1无效/u)
})

test('keeps narrative opportunities private and durable until their explicit disposition', () => {
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const playContext: PlayWorldContext = {
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
    configuration: FLYING_CHESS_WORLD_CONFIGURATION,
    sourceReferences: [],
  }
  const createLanding = () => {
    const rolls = [6, 6, 1]
    const module = createFlyingChessWorldModule({ rollDie: () => rolls.shift()! })
    let snapshot = module.create(playContext)
    for (let index = 0; index < 3; index += 1) {
      let turn = module.characterTurn(snapshot, playContext)!
      snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
      turn = module.characterTurn(snapshot, playContext)!
      snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
    }
    return { module, snapshot }
  }

  const immediate = createLanding()
  const opportunity = immediate.module.characterOpportunities!(immediate.snapshot, reimuId, playContext)[0]!
  assert.equal(opportunity.status, 'available')
  assert.deepEqual(opportunity.responderIds, [marisaId])
  assert.deepEqual(immediate.module.characterOpportunities!(immediate.snapshot, marisaId, playContext), [])
  const { opportunities: _legacyMissingOpportunities, ...legacyState } = immediate.snapshot.state as FlyingChessWorldState
  const recovered = immediate.module.normalize({ ...immediate.snapshot, state: legacyState }, playContext)
  assert.equal(immediate.module.characterOpportunities!(recovered, reimuId, playContext)[0]?.id, opportunity.id)
  const usedImmediately = immediate.module.resolveCharacterOpportunity!(immediate.snapshot, {
    opportunityId: opportunity.id,
    characterId: reimuId,
    disposition: 'use',
    responderId: marisaId,
    publicEvidence: '“你来这里以前，最后看见了什么？”',
  }, playContext)
  assert.deepEqual(immediate.module.characterOpportunities!(usedImmediately, reimuId, playContext), [])
  assert.equal((usedImmediately.state as FlyingChessWorldState).opportunities[0]?.status, 'used')
  assert.equal(usedImmediately.events.length, immediate.snapshot.events.length + 1)
  assert.deepEqual(usedImmediately.events.at(-1), {
    id: usedImmediately.events.at(-1)!.id,
    sequence: immediate.snapshot.events.length + 1,
    type: 'narrative.opportunity-used',
    title: '博丽灵梦公开提问',
    summary: '博丽灵梦向雾雨魔理沙问：“你来这里以前，最后看见了什么？”',
    actorId: reimuId,
    data: {
      kind: 'narrative-opportunity-used',
      opportunityId: opportunity.id,
      cardId: 'question-slip-step-eight',
      sourceEventSequence: opportunity.sourceEventSequences[0],
      responderId: marisaId,
      move: 'question',
      publicEvidence: '“你来这里以前，最后看见了什么？”',
    },
  })
  assert.match(immediate.module.projectForCharacter(usedImmediately, reimuId, playContext).text, /已使用，回应者为 雾雨魔理沙/u)
  assert.doesNotMatch(immediate.module.projectForCharacter(usedImmediately, marisaId, playContext).text, /已使用/u)
  assert.match(immediate.module.projectForCharacter(usedImmediately, marisaId, playContext).text, /博丽灵梦向雾雨魔理沙问/u)
  const reply = '“刚从香霖堂回来，这就算答案了吧？”'
  const repliedImmediately = immediate.module.resolveCharacterOpportunityReply!(usedImmediately, {
    opportunityId: opportunity.id,
    characterId: marisaId,
    ownerId: reimuId,
    move: 'answer',
    publicEvidence: reply,
  }, playContext)
  assert.equal(repliedImmediately.events.length, usedImmediately.events.length + 1)
  assert.deepEqual(repliedImmediately.events.at(-1), {
    id: repliedImmediately.events.at(-1)!.id,
    sequence: usedImmediately.events.length + 1,
    type: 'narrative.opportunity-replied',
    title: '雾雨魔理沙作出回应',
    summary: `雾雨魔理沙回应博丽灵梦：${reply}`,
    actorId: marisaId,
    data: {
      kind: 'narrative-opportunity-replied',
      opportunityId: opportunity.id,
      cardId: 'question-slip-step-eight',
      sourceEventSequence: opportunity.sourceEventSequences[0],
      useEventSequence: usedImmediately.events.at(-1)!.sequence,
      ownerId: reimuId,
      move: 'answer',
      publicEvidence: reply,
    },
  })
  assert.equal(immediate.module.resolveCharacterOpportunityReply!(repliedImmediately, {
    opportunityId: opportunity.id,
    characterId: marisaId,
    ownerId: reimuId,
    move: 'answer',
    publicEvidence: reply,
  }, playContext).events.length, repliedImmediately.events.length)
  assert.throws(() => immediate.module.resolveCharacterOpportunityReply!(repliedImmediately, {
    opportunityId: opportunity.id,
    characterId: marisaId,
    ownerId: reimuId,
    move: 'refuse',
    publicEvidence: '“不答。”',
  }, playContext), /已经由另一项公开回应关闭/u)

  const deferred = createLanding()
  const deferredOpportunity = deferred.module.characterOpportunities!(deferred.snapshot, reimuId, playContext)[0]!
  const retained = deferred.module.resolveCharacterOpportunity!(deferred.snapshot, {
    opportunityId: deferredOpportunity.id,
    characterId: reimuId,
    disposition: 'retain',
  }, playContext)
  assert.equal(deferred.module.characterOpportunities!(retained, reimuId, playContext)[0]?.status, 'retained')
  assert.equal(retained.events.length, deferred.snapshot.events.length)
  assert.match(deferred.module.projectForCharacter(retained, reimuId, playContext).text, /已保留/u)
  assert.doesNotMatch(deferred.module.projectForCharacter(retained, marisaId, playContext).text, /已保留/u)
  assert.throws(() => deferred.module.resolveCharacterOpportunity!(retained, {
    opportunityId: deferredOpportunity.id,
    characterId: reimuId,
    disposition: 'use',
    responderId: marisaId,
  }, playContext), /缺少有效的公开话语/u)
  const usedLater = deferred.module.resolveCharacterOpportunity!(retained, {
    opportunityId: deferredOpportunity.id,
    characterId: reimuId,
    disposition: 'use',
    responderId: marisaId,
    publicEvidence: '“那本书，你是从哪里拿来的？”',
  }, playContext)
  assert.equal((usedLater.state as FlyingChessWorldState).opportunities[0]?.status, 'used')

  const abandoned = createLanding()
  const abandonedOpportunity = abandoned.module.characterOpportunities!(abandoned.snapshot, reimuId, playContext)[0]!
  const declined = abandoned.module.resolveCharacterOpportunity!(abandoned.snapshot, {
    opportunityId: abandonedOpportunity.id,
    characterId: reimuId,
    disposition: 'decline',
  }, playContext)
  assert.equal((declined.state as FlyingChessWorldState).opportunities[0]?.status, 'declined')
  assert.equal(declined.events.length, abandoned.snapshot.events.length)
  assert.deepEqual(abandoned.module.characterOpportunities!(declined, reimuId, playContext), [])
  assert.match(abandoned.module.projectForCharacter(declined, reimuId, playContext).text, /已放弃/u)
  assert.doesNotMatch(abandoned.module.projectForCharacter(declined, marisaId, playContext).text, /已放弃/u)

  const legacyContext: PlayWorldContext = {
    ...playContext,
    configuration: {
      format: 0,
      ruleset: 'classic-24',
      narrativeCards: [{
        id: 'question-slip-step-eight',
        trigger: { kind: 'piece-landed', step: 8 },
        event: {
          title: '格子下的折签弹开',
          summary: '一架木机停在航线第 8 步时，格子下压着的折签弹开，正面写着“可以向另一位棋手提一个问题；对方可以拒答”。',
        },
        cue: {
          kind: 'relationship',
          text: '刚移动棋子的人物获得一次明确的提问机会，可以立即使用、留到以后或放弃；只有问题真正说出后，另一位人物才获得回答前提。',
          responders: 'actor',
        },
        repeat: false,
      }],
    },
  }
  const legacyRolls = [6, 6, 1]
  const legacyModule = createFlyingChessWorldModule({ rollDie: () => legacyRolls.shift()! })
  let legacySnapshot = legacyModule.create(legacyContext)
  for (let index = 0; index < 3; index += 1) {
    let turn = legacyModule.characterTurn(legacySnapshot, legacyContext)!
    legacySnapshot = legacyModule.dispatch(legacySnapshot, turn.actions[0]!.action, legacyContext)
    turn = legacyModule.characterTurn(legacySnapshot, legacyContext)!
    legacySnapshot = legacyModule.dispatch(legacySnapshot, turn.actions[0]!.action, legacyContext)
  }
  const legacyEvent = legacySnapshot.events.find(item => item.type === 'scene.changed')!
  assert.equal((legacyEvent.data as { readonly cueKind?: unknown }).cueKind, 'relationship')
  assert.equal((legacyEvent.data as { readonly opportunityKind?: unknown }).opportunityKind, undefined)
  assert.equal(legacyModule.characterOpportunities!(legacySnapshot, reimuId, legacyContext)[0]?.status, 'available')
  assert.deepEqual(legacyModule.characterOpportunities!(legacySnapshot, marisaId, legacyContext), [])
})

test('projects and restores command and proposal opportunities from default scene cards', () => {
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const playContext: PlayWorldContext = {
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
    configuration: FLYING_CHESS_WORLD_CONFIGURATION,
    sourceReferences: [],
  }
  const module = createFlyingChessWorldModule()

  const collisionCreated = module.create(playContext)
  const collisionState = collisionCreated.state as FlyingChessWorldState
  const reimuPiece = collisionState.pieces.find(piece => piece.ownerId === reimuId)!
  const marisaPiece = collisionState.pieces.find(piece => piece.ownerId === marisaId)!
  const collided = module.dispatch({
    ...collisionCreated,
    state: {
      ...collisionState,
      pieces: collisionState.pieces.map(piece => piece.id === reimuPiece.id
        ? { ...piece, status: 'track' as const, steps: 12 }
        : piece.id === marisaPiece.id
          ? { ...piece, status: 'track' as const, steps: 1 }
          : piece),
      pendingRoll: { playerId: reimuId, value: 1, legalPieceIds: [reimuPiece.id] },
    },
  }, { type: 'move', actorId: reimuId, pieceId: reimuPiece.id }, playContext)
  const collisionEvent = collided.events.find(item => (item.data as { readonly cardId?: unknown } | undefined)?.cardId
    === 'first-collision-reckoning')!
  assert.equal((collisionEvent.data as { readonly opportunityMove?: unknown }).opportunityMove, 'command')
  const command = module.characterOpportunities!(collided, marisaId, playContext)[0]!
  assert.equal(command.use.move, 'command')
  assert.deepEqual(command.responderIds, [reimuId])
  assert.deepEqual(module.characterOpportunities!(collided, reimuId, playContext), [])
  const retainedCommand = module.resolveCharacterOpportunity!(collided, {
    opportunityId: command.id,
    characterId: marisaId,
    disposition: 'retain',
  }, playContext)
  const reloadedCommand = module.normalize(JSON.parse(JSON.stringify(retainedCommand)), playContext)
  assert.equal(module.characterOpportunities!(reloadedCommand, marisaId, playContext)[0]?.status, 'retained')
  assert.equal(module.characterOpportunities!(reloadedCommand, marisaId, playContext)[0]?.use.move, 'command')
  assert.throws(() => module.resolveCharacterOpportunity!(reloadedCommand, {
    opportunityId: command.id,
    characterId: marisaId,
    disposition: 'use',
    responderId: reimuId,
  }, playContext), /缺少有效的公开话语/u)
  const usedCommand = module.resolveCharacterOpportunity!(reloadedCommand, {
    opportunityId: command.id,
    characterId: marisaId,
    disposition: 'use',
    responderId: reimuId,
    publicEvidence: '“这回你得把茶点拿出来。”',
  }, playContext)
  assert.equal((usedCommand.state as FlyingChessWorldState).opportunities[0]?.status, 'used')

  const homeCreated = module.create(playContext)
  const homeState = homeCreated.state as FlyingChessWorldState
  const homePiece = homeState.pieces.find(piece => piece.ownerId === reimuId)!
  const arrived = module.dispatch({
    ...homeCreated,
    state: {
      ...homeState,
      pieces: homeState.pieces.map(piece => piece.id === homePiece.id
        ? { ...piece, status: 'track' as const, steps: 23 }
        : piece),
      pendingRoll: { playerId: reimuId, value: 1, legalPieceIds: [homePiece.id] },
    },
  }, { type: 'move', actorId: reimuId, pieceId: homePiece.id }, playContext)
  const homeEvent = arrived.events.find(item => (item.data as { readonly cardId?: unknown } | undefined)?.cardId
    === 'first-home-next-round-stake')!
  assert.equal((homeEvent.data as { readonly opportunityMove?: unknown }).opportunityMove, 'propose')
  const proposal = module.characterOpportunities!(arrived, reimuId, playContext)[0]!
  assert.equal(proposal.use.move, 'propose')
  assert.deepEqual(proposal.responderIds, [marisaId])
  const retainedProposal = module.resolveCharacterOpportunity!(arrived, {
    opportunityId: proposal.id,
    characterId: reimuId,
    disposition: 'retain',
  }, playContext)
  const reloadedProposal = module.normalize(JSON.parse(JSON.stringify(retainedProposal)), playContext)
  assert.equal(module.characterOpportunities!(reloadedProposal, reimuId, playContext)[0]?.status, 'retained')
  assert.equal(module.characterOpportunities!(reloadedProposal, reimuId, playContext)[0]?.use.move, 'propose')
  const usedProposal = module.resolveCharacterOpportunity!(reloadedProposal, {
    opportunityId: proposal.id,
    characterId: reimuId,
    disposition: 'use',
    responderId: marisaId,
    publicEvidence: '“下一局把先手让给我，怎么样？”',
  }, playContext)
  assert.equal((usedProposal.state as FlyingChessWorldState).opportunities[0]?.status, 'used')
})

test('consumes a durable speech opportunity only after the approved move targets its responder', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-world-opportunity-moves-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const worlds = new PlayWorldRegistry()
  const module = createFlyingChessWorldModule()
  worlds.register(module)
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '对白机会动作' })
  const configured = store.save({
    ...editable(created),
    characters: [{
      ...character(reimuId, '博丽灵梦'),
      profile: {
        ...character(reimuId, '博丽灵梦').profile,
        exampleDialogue: '<START>\n博丽灵梦: 下一局可得换个规矩。',
      },
    }, {
      ...character(marisaId, '雾雨魔理沙'),
      profile: {
        ...character(marisaId, '雾雨魔理沙').profile,
        exampleDialogue: '<START>\n雾雨魔理沙: 这回你可得赔我。',
      },
    }],
    outputs: [{ id: proseId, name: '正文', kind: 'prose', enabled: true, instructions: '写成连续场景。' }],
  })
  const installed = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  const worldContext = resolveStoryPlayWorldContext(installed)
  const createdWorld = module.create(worldContext)
  const initialState = createdWorld.state as FlyingChessWorldState
  const reimuPiece = initialState.pieces.find(piece => piece.ownerId === reimuId)!
  const marisaPiece = initialState.pieces.find(piece => piece.ownerId === marisaId)!
  const collisionWorld = module.dispatch({
    ...createdWorld,
    state: {
      ...initialState,
      pieces: initialState.pieces.map(piece => piece.id === reimuPiece.id
        ? { ...piece, status: 'track' as const, steps: 12 }
        : piece.id === marisaPiece.id
          ? { ...piece, status: 'track' as const, steps: 1 }
          : piece),
      pendingRoll: { playerId: reimuId, value: 1, legalPieceIds: [reimuPiece.id] },
    },
  }, { type: 'move', actorId: reimuId, pieceId: reimuPiece.id }, worldContext)
  const collisionOpportunity = module.characterOpportunities!(collisionWorld, marisaId, worldContext)[0]!

  const secondWorld = module.create(worldContext)
  const secondState = secondWorld.state as FlyingChessWorldState
  const secondReimuPiece = secondState.pieces.find(piece => piece.ownerId === reimuId)!
  const homeWorld = module.dispatch({
    ...secondWorld,
    state: {
      ...secondState,
      pieces: secondState.pieces.map(piece => piece.id === secondReimuPiece.id
        ? { ...piece, status: 'track' as const, steps: 23 }
        : piece),
      pendingRoll: { playerId: reimuId, value: 1, legalPieceIds: [secondReimuPiece.id] },
    },
  }, { type: 'move', actorId: reimuId, pieceId: secondReimuPiece.id }, worldContext)
  const proposalOpportunity = module.characterOpportunities!(homeWorld, reimuId, worldContext)[0]!

  const workspaceWithProcessedWorld = (
    world: typeof collisionWorld,
    title: string,
  ): StoryWorkspaceSnapshot => ({
    ...installed,
    world,
    events: [...installed.events, {
      id: createStoryEventId(),
      key: `fixture-${title}`,
      turn: 0,
      title,
      summary: '',
      evidence: '',
      participantIds: [reimuId, marisaId],
      worldEventSequences: world.events.map(item => item.sequence),
    }],
  })
  const run = async (options: {
    readonly key: string
    readonly workspace: StoryWorkspaceSnapshot
    readonly ownerId: string
    readonly opportunityId: string
    readonly requiredMove: 'command' | 'propose'
    readonly submittedMove: 'command' | 'propose' | 'question'
    readonly submittedResponderId: string
  }) => {
    const session = Session.create(SessionId(`world-opportunity-${options.key}`))
    session.append('request/header', {
      reason: 'initial',
      header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
    })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const approvedLine = options.requiredMove === 'command'
      ? '“这回你得把茶点拿出来。”'
      : '“下一局把先手让给我，怎么样？”'
    const fake = {
      sessions: { flush: async () => true },
      llm: {
        async resolveModelInfo(provider: string, model: string) {
          return {
            provider,
            id: model,
            name: model,
            reasoning: { efforts: [{ id: 'off', name: 'Off' }], defaultEffort: 'off' },
          }
        },
        stream(request: { readonly system?: string; readonly messages?: readonly unknown[] }) {
          const system = request.system ?? ''
          const body = JSON.stringify(request.messages ?? [])
          const targetSeedId = [...body.matchAll(/\[seed:([^\]]+)\]\[目标人物\]/gu)][0]?.[1]
          let text: string
          if (system.includes('人物参与路由 Worker')) {
            text = JSON.stringify({ publicCharacterIds: [options.ownerId] })
          } else if (system.includes('单个人物的历史检索 Worker')) {
            text = JSON.stringify({ references: [] })
          } else if (system.includes('指定人物认知')) {
            text = JSON.stringify({
              observation: '世界事件为自己保留了一次公开说话机会。',
              action: '',
              speech: {
                respondsTo: '这项仍未处置的世界机会。',
                move: options.submittedMove,
                focus: '把事件留下的选择公开交给对方。',
                effect: '让对方决定如何回应。',
              },
              opportunityDecisions: [{
                opportunityId: options.opportunityId,
                disposition: 'use',
                responderId: options.submittedResponderId,
              }],
              insights: [],
            })
          } else if (system.includes('人物自己的对白 Worker')) {
            text = JSON.stringify({ lines: [{
              reference: `speech:${proseId}:1`,
              move: options.submittedMove,
              seedLineIds: targetSeedId === undefined ? [] : [targetSeedId],
              mechanics: '直接说出要求或提议，把是否回应留给对方。',
              leftImplicit: '人物没有解释自己的动机。',
              dialogue: approvedLine,
            }] })
          } else if (system.includes('严格对白审校 Worker')) {
            text = JSON.stringify({ lines: [{ reference: `speech:${proseId}:1`, dialogue: approvedLine }] })
          } else if (system.includes('分区的 prose Worker')) {
            text = approvedLine
          } else if (system.includes('最终正文编辑 Worker')) {
            text = JSON.stringify({ sections: [{ sectionId: proseId, text: approvedLine }] })
          } else {
            text = JSON.stringify({ sections: [] })
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
    return runStoryTurnPipeline({
      ctx: fake,
      agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
      store,
      workspace: options.workspace,
      turn: 1,
      step: 1,
      messages: [createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: '使用世界事件留下的机会；规则状态保持不变。' }],
      })],
      signal: new AbortController().signal,
    })
  }

  const commandResult = await run({
    key: 'command',
    workspace: workspaceWithProcessedWorld(collisionWorld, '碰撞已经结算'),
    ownerId: marisaId,
    opportunityId: collisionOpportunity.id,
    requiredMove: 'command',
    submittedMove: 'command',
    submittedResponderId: reimuId,
  })
  assert.deepEqual(commandResult.worldOpportunityResolutions, [{
    opportunityId: collisionOpportunity.id,
    characterId: marisaId,
    disposition: 'use',
    responderId: reimuId,
    publicEvidence: '“这回你得把茶点拿出来。”',
  }])

  const proposalResult = await run({
    key: 'propose',
    workspace: workspaceWithProcessedWorld(homeWorld, '首架飞机已经到达'),
    ownerId: reimuId,
    opportunityId: proposalOpportunity.id,
    requiredMove: 'propose',
    submittedMove: 'propose',
    submittedResponderId: marisaId,
  })
  assert.deepEqual(proposalResult.worldOpportunityResolutions, [{
    opportunityId: proposalOpportunity.id,
    characterId: reimuId,
    disposition: 'use',
    responderId: marisaId,
    publicEvidence: '“下一局把先手让给我，怎么样？”',
  }])

  const wrongMove = await run({
    key: 'wrong-move',
    workspace: workspaceWithProcessedWorld(collisionWorld, '碰撞已经结算'),
    ownerId: marisaId,
    opportunityId: collisionOpportunity.id,
    requiredMove: 'command',
    submittedMove: 'question',
    submittedResponderId: reimuId,
  })
  assert.equal(wrongMove.worldOpportunityResolutions, undefined)

  const wrongTarget = await run({
    key: 'wrong-target',
    workspace: workspaceWithProcessedWorld(collisionWorld, '碰撞已经结算'),
    ownerId: marisaId,
    opportunityId: collisionOpportunity.id,
    requiredMove: 'command',
    submittedMove: 'command',
    submittedResponderId: marisaId,
  })
  assert.equal(wrongTarget.worldOpportunityResolutions, undefined)
})

test('does not consume a world opportunity when the public question is rejected', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-world-opportunity-rejected-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const rolls = [6, 6, 1]
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => rolls.shift()! }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '未公开的提问机会' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const reimu = character(reimuId, '博丽灵梦')
  const marisa = character(marisaId, '雾雨魔理沙')
  const configured = store.save({
    ...editable(created),
    characters: [{
      ...reimu,
      profile: { ...reimu.profile, exampleDialogue: '灵梦：“你来这里以前，最后看见了什么？”' },
    }, {
      ...marisa,
      profile: {
        ...marisa.profile,
        exampleDialogue: '魔理沙：“香霖堂的话，刚才才去过啊。”',
      },
    }],
    outputs: [{ id: proseId, name: '正文', kind: 'prose', enabled: true, instructions: '写成连续场景。' }],
  })
  let workspace = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  for (let index = 0; index < 3; index += 1) {
    let turn = store.worldTurn(workspace.id)!
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: turn.cycleId,
      actionId: 'roll',
    })
    turn = store.worldTurn(workspace.id)!
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: turn.cycleId,
      actionId: turn.actions[0]!.id,
    })
  }
  const module = worlds.get(FLYING_CHESS_WORLD_MODULE_ID)
  const worldContext = resolveStoryPlayWorldContext(workspace)
  const opportunity = module.characterOpportunities!(workspace.world!, reimuId, worldContext)[0]!

  const session = Session.create(SessionId('world-opportunity-rejected'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', reasoningEffort: 'high' as never, maxTokens: 8_192 } },
  })
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  let voiceDraftAttempts = 0
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
        const targetSeedIds = [...new Set([...body.matchAll(/\[seed:([^\]]+)\]\[目标人物\]/gu)]
          .map(match => match[1]!))]
        let text: string
        if (system.includes('指定人物认知')) {
          text = body.includes('# 人物：博丽灵梦')
            ? JSON.stringify({
              observation: '折签给了自己一次提问机会。',
              action: '把折签沿旧折痕展开，放到两人之间。',
              speech: {
                respondsTo: '折签允许她向另一位棋手提一个问题。',
                move: 'question',
                focus: '魔理沙来这里前最后看见的事。',
                effect: '让魔理沙决定是否回答。',
              },
              opportunityDecisions: [{
                opportunityId: opportunity.id,
                disposition: 'use',
                responderId: marisaId,
              }],
              insights: [{
                kind: 'knowledge',
                text: '折签问题已经公开问出，这次机会已经用掉。',
                futureChoice: '',
              }],
            })
            : JSON.stringify({
              observation: '玩家要求灵梦使用折签提问，但问题还没有公开。',
              action: '靠向椅背，嘴上接过灵梦的问题。',
              speech: {
                respondsTo: '灵梦刚刚把折签问题问出口。',
                move: 'tease',
                focus: '用玩笑回避真实计划。',
                effect: '让灵梦套不出答案。',
              },
              opportunityDecisions: [],
              insights: [{
                kind: 'knowledge',
                text: '灵梦已经把折签问题问出口，折签也已经用掉。',
                futureChoice: '',
              }],
            })
        } else if (system.includes('人物自己的对白 Worker')) {
          voiceDraftAttempts += 1
          const seedLineIds = voiceDraftAttempts === 1
            ? targetSeedIds.slice(0, 1).map(id => id.replace(/#seed-\d+$/u, ''))
            : targetSeedIds.slice(0, 1)
          text = JSON.stringify({ lines: [{
            reference: `speech:${proseId}:1`,
            move: 'question',
            seedLineIds,
            mechanics: '直接发问，把是否作答留给对方。',
            leftImplicit: '提问的原因。',
            dialogue: '“来这儿以前，你最后碰见的是谁？”',
          }] })
        } else if (system.includes('对白审校 Worker')) {
          text = JSON.stringify({ lines: [{ reference: `speech:${proseId}:1`, dialogue: '' }] })
        } else if (system.includes('分区的 prose Worker')) {
          text = '木机在第八步停住，格子下的折签随即弹开。'
        } else if (system.includes('最终正文编辑 Worker')) {
          text = JSON.stringify({ sections: [{
            sectionId: proseId,
            text: '木机在第八步停住，格子下的折签随即弹开。',
          }] })
        } else if (system.includes('剧情研究 Worker')) {
          text = JSON.stringify({ findings: [], followUps: [] })
        } else if (system.includes('剧情导演 Worker')) {
          text = JSON.stringify({ sections: [{
            sectionId: proseId,
            beats: [
              '灵梦把折签沿旧折痕展开，放到两人之间。',
              '灵梦真的把折签问题问出口，随后等待魔理沙回答。',
              '魔理沙靠向椅背，嘴上接过灵梦的问题。',
            ],
            speech: [{ characterId: reimuId }, { characterId: marisaId }],
          }] })
        } else if (system.includes('剧情连续性记录 Worker')) {
          text = JSON.stringify({
            history: { text: '折签在棋子停到第八步时弹开。', sourceSectionIds: [proseId] },
            changes: { characters: [], facts: [], nodes: [], edges: [] },
          })
        } else {
          throw new Error(`不应调用额外故事阶段：${system.slice(0, 50)}`)
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
    workspace,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(result.publicDialogues, undefined)
  assert.equal(result.worldOpportunityResolutions, undefined)
  assert.equal(result.privateCharacterStates, undefined)
  assert.match(result.directorBrief, /把折签沿旧折痕展开/u)
  assert.doesNotMatch(result.directorBrief, /问题问出口|接过灵梦的问题/u)
  assert.equal(voiceDraftAttempts, 2)
  const characterRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'character' ? [event.data] : [])
  const reimuBody = JSON.stringify(characterRequests.find(request => request.subjectId === reimuId)?.dispatch.messages)
  const marisaBody = JSON.stringify(characterRequests.find(request => request.subjectId === marisaId)?.dispatch.messages)
  assert.equal(reimuBody.includes(opportunity.id), true)
  assert.equal(marisaBody.includes('<world_opportunities>\\n（无）\\n</world_opportunities>'), true)
  assert.doesNotMatch(marisaBody, /status=open/u)
  const voiceRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'voice' ? [event.data] : [])
  assert.equal(voiceRequests.length, 3)
  assert.match(JSON.stringify(voiceRequests[1]?.dispatch.messages), /voice_draft_retry/u)
  assert.match(JSON.stringify(voiceRequests[1]?.dispatch.messages), /#seed-N/u)

  session.append('assistant/message', {
    turn: 2,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: result.finalDraft }],
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 2, step: 1 })
  await materializeStoryTurn({
    ctx: fake,
    agent,
    store,
    workspaceId: workspace.id,
    turn: 2,
    signal: new AbortController().signal,
  })
  const retained = module.characterOpportunities!(store.get(workspace.id).world!, reimuId, worldContext)[0]
  assert.equal(retained?.status, 'available')
  const noChanges = { characters: [], facts: [], nodes: [], edges: [] }
  const retainedWorkspace = store.materializeTurn(workspace.id, {
    key: 'world-opportunity-retained-later',
    turn: 3,
    title: '保留折签',
    summary: '',
    evidence: '',
    participantIds: [reimuId, marisaId],
    worldOpportunityResolutions: [{
      opportunityId: opportunity.id,
      characterId: reimuId,
      disposition: 'retain',
    }],
    changes: noChanges,
    webResearch: [],
  })
  assert.equal(module.characterOpportunities!(retainedWorkspace.world!, reimuId, worldContext)[0]?.status, 'retained')

  const approvedSession = Session.create(SessionId('world-opportunity-approved-question'))
  approvedSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  approvedSession.append('turn/start', { turn: 4 })
  approvedSession.append('step/start', { turn: 4, step: 1 })
  const approvedQuestion = '“你总把那架机子往前赶，终点外还有什么在等你？”'
  const approvedCharacterBodies: string[] = []
  const approvedContext = {
    sessions: { flush: async () => true },
    llm: {
      async resolveModelInfo(provider: string, model: string) {
        return {
          provider,
          id: model,
          name: model,
          reasoning: { efforts: [{ id: 'off', name: 'Off' }], defaultEffort: 'off' },
        }
      },
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        const deferredTurn = body.includes('保持沉默并自行处理是否以后回答')
        const quietTurn = body.includes('没有新的公开行动')
        const floridTurn = body.includes('只轻敲桌面') || body.includes('灵梦没有动，只是看着')
        const simileTurn = body.includes('把手掌平放')
        const responseTurn = body.includes('让魔理沙自行决定是否回答') || deferredTurn || quietTurn || floridTurn || simileTurn
        const fallbackTurn = body.includes('导演失败时')
        const isReimu = body.includes('# 人物：博丽灵梦')
        const targetSeedIds = [...new Set([...body.matchAll(/\[seed:([^\]]+)\]\[目标人物\]/gu)]
          .map(match => match[1]!))]
        let text: string
        if (system.includes('人物参与路由 Worker')) {
          text = JSON.stringify({ publicCharacterIds: responseTurn ? [marisaId] : [reimuId, marisaId] })
        } else if (system.includes('单个人物的历史检索 Worker')) {
          text = JSON.stringify({ references: [] })
        } else if (system.includes('指定人物认知')) {
          approvedCharacterBodies.push(body)
          text = responseTurn
            ? isReimu
              ? JSON.stringify({
                observation: '上一轮的问题已经公开。',
                action: '',
                speech: null,
                opportunityDecisions: [],
                insights: [{
                  kind: 'knowledge',
                  text: '前三回合掷骰结果依次是 2、4、3，双方飞机都还在基地。',
                  futureChoice: '',
                }, {
                  kind: 'decision',
                  text: '折签仍可留到以后使用。',
                  futureChoice: '折签提问留到出现规则争议时再使用。',
                }],
              })
              : JSON.stringify({
                observation: '灵梦刚才公开问过终点以外还有什么在等她。',
                action: quietTurn
                  ? ''
                  : floridTurn
                    ? '用指节轻敲桌面一下。'
                    : simileTurn
                      ? '把手掌平放在自己面前。'
                      : '把骰子翻过来，对着灯看六个面上的刻痕。',
                speech: deferredTurn || quietTurn || floridTurn || simileTurn
                  ? null
                  : {
                      respondsTo: '灵梦刚才公开问过终点以外还有什么在等她。',
                      move: 'answer',
                      focus: '自己若动过手脚，就不会连自己也坑进第四把四里。',
                      effect: '把话绕回神社身上。',
                    },
                opportunityDecisions: [],
                insights: quietTurn
                  ? [{
                      kind: 'decision',
                      text: '这一轮不再接话。',
                      futureChoice: '若以后再次被追问，再决定是否回答。',
                    }]
                  : floridTurn || simileTurn
                    ? []
                    : deferredTurn
                  ? [{
                      kind: 'decision',
                      text: '这轮继续沉默，但以后仍可回答折签问题。',
                      futureChoice: '若以后回答折签问题，先把话绕回神社身上。',
                    }, {
                      kind: 'knowledge',
                      text: '我准备回答：“要真是我动的手脚，哪会连自己也坑在第四把四上。”',
                      futureChoice: '',
                    }]
                  : [{
                      kind: 'decision',
                      text: '回答后把怀疑引回神社。',
                      futureChoice: '把话绕回神社身上。',
                    }],
              })
            : isReimu
              ? JSON.stringify({
                observation: '折签仍由自己保留。',
                action: '把折签沿旧折痕展开，放到两人之间。',
                speech: {
                  respondsTo: '魔理沙一直只推进同一架飞机。',
                  move: 'question',
                  focus: '终点以外是否还有事情等着她。',
                  effect: '把折签允许的问题公开问给魔理沙。',
                },
                opportunityDecisions: [{
                  opportunityId: opportunity.id,
                  disposition: 'use',
                  responderId: marisaId,
                }],
                insights: [],
              })
              : JSON.stringify({
                observation: '玩家希望灵梦随后提问，但问题尚未公开。',
                action: '靠向椅背准备接话。',
                speech: {
                  respondsTo: '灵梦刚刚公开的问题。',
                  move: 'tease',
                  focus: '用玩笑回避答案。',
                  effect: '不透露自己的计划。',
                },
                opportunityDecisions: [],
                insights: [{
                  kind: 'knowledge',
                  text: '灵梦已经公开问出了折签问题。',
                  futureChoice: '',
                }],
              })
        } else if (system.includes('剧情研究 Worker')) {
          text = JSON.stringify({ findings: [], followUps: [] })
        } else if (system.includes('剧情导演 Worker')) {
          text = fallbackTurn ? '{}' : JSON.stringify({ sections: [{
            sectionId: proseId,
            beats: responseTurn
              ? [
                  '魔理沙把骰子翻过来，对着灯看六个面上的刻痕。',
                  '若真是她动的手脚，她不会连自己也坑进第四把四里。',
                  '魔理沙把话绕了个弯，又抛回神社身上。',
                ]
              : ['灵梦展开折签。'],
            speech: responseTurn
              ? [{ characterId: marisaId }]
              : [{ characterId: reimuId }, { characterId: marisaId }],
          }] })
        } else if (system.includes('严格对白审校 Worker')) {
          text = JSON.stringify({ lines: [{
            reference: `speech:${proseId}:1`,
            dialogue: responseTurn ? '' : approvedQuestion,
          }] })
        } else if (system.includes('人物自己的对白 Worker')) {
          text = JSON.stringify({ lines: [{
            reference: `speech:${proseId}:1`,
            move: responseTurn ? 'answer' : 'question',
            seedLineIds: targetSeedIds.slice(0, 1),
            mechanics: '把对方刚才的选择压成一句直接反问。',
            leftImplicit: '她为何想知道答案。',
            dialogue: responseTurn
              ? '“要真是我动的手脚，哪会连自己也坑在第四把四上。”'
              : approvedQuestion,
          }] })
        } else if (system.includes('分区的 prose Worker')) {
          text = floridTurn
            ? '魔理沙用指节轻敲桌面一下。灵梦没有动，只是看着。'
            : simileTurn
              ? '魔理沙把手掌平放在自己面前，像一枚落定的棋子。'
              : responseTurn
                ? '魔理沙把骰子翻过来，对着灯看了看六个面上的刻痕。'
                : `灵梦展开折签，问魔理沙：${approvedQuestion}`
        } else if (system.includes('最终正文编辑 Worker')) {
          text = JSON.stringify({ sections: [{
            sectionId: proseId,
            text: floridTurn
              ? '魔理沙用指节在桌面上轻敲一下，随即收回手。'
              : simileTurn
                ? '魔理沙把手掌平放在自己面前，随后停手。'
                : responseTurn
                  ? '魔理沙把骰子翻过来，对着灯看了看六个面上的刻痕。'
                  : `灵梦展开折签，问魔理沙：${approvedQuestion}`,
          }] })
        } else {
          text = JSON.stringify({ sections: [] })
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
  const approvedAgent = {
    id: approvedSession.id,
    options: { provider: 'fixture', model: 'fixture' },
    session: approvedSession,
  } as Agent
  const approvedResult = await runStoryTurnPipeline({
    ctx: approvedContext,
    agent: approvedAgent,
    store,
    workspace: retainedWorkspace,
    turn: 4,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '灵梦现在使用收好的折签向魔理沙提问；棋局状态保持不变。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.deepEqual(approvedResult.publicDialogues?.map(dialogue => ({
    characterId: dialogue.characterId,
    targetCharacterId: dialogue.targetCharacterId,
    dialogue: dialogue.dialogue,
  })), [{ characterId: reimuId, targetCharacterId: marisaId, dialogue: approvedQuestion }])
  assert.deepEqual(approvedResult.worldOpportunityResolutions, [{
    opportunityId: opportunity.id,
    characterId: reimuId,
    disposition: 'use',
    responderId: marisaId,
    publicEvidence: approvedQuestion,
  }])
  assert.equal(approvedResult.privateCharacterStates, undefined)
  const responseWorld = module.resolveCharacterOpportunity!(
      retainedWorkspace.world!,
      approvedResult.worldOpportunityResolutions[0]!,
      worldContext,
    )
  const usedEventSequence = responseWorld.events.at(-1)!.sequence
  const responseWorkspace = {
    ...retainedWorkspace,
    world: responseWorld,
    events: [...retainedWorkspace.events, {
      id: createStoryEventId(),
      key: 'fixture-approved-question',
      turn: 4,
      title: '使用折签',
      summary: '灵梦向魔理沙提问。',
      evidence: approvedResult.finalDraft,
      participantIds: [reimuId, marisaId],
      worldEventSequences: [usedEventSequence],
    }],
  }
  approvedSession.append('assistant/message', {
    turn: 4,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: approvedResult.finalDraft }],
    }),
  }, { surfaceOp: 'append' })
  approvedSession.append('step/end', { turn: 4, step: 1 })
  approvedSession.append('turn/start', { turn: 5 })
  approvedSession.append('step/start', { turn: 5, step: 1 })
  const responseCharacterBodyStart = approvedCharacterBodies.length
  const responseResult = await runStoryTurnPipeline({
    ctx: approvedContext,
    agent: approvedAgent,
    store,
    workspace: responseWorkspace,
    turn: 5,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '让魔理沙自行决定是否回答；棋局状态保持不变。' }],
    })],
    signal: new AbortController().signal,
  })
  const responseTurnBodies = approvedCharacterBodies.slice(responseCharacterBodyStart)
  const responseReimuBody = responseTurnBodies.find(body => body.includes('# 人物：博丽灵梦')) ?? ''
  const responseMarisaBody = responseTurnBodies.find(body => body.includes('# 人物：雾雨魔理沙')) ?? ''
  assert.equal(responseTurnBodies.length, 1)
  assert.match(responseMarisaBody, /status=open/u)
  assert.equal(responseMarisaBody.includes(approvedQuestion), true)
  assert.match(responseMarisaBody, /publicResponse=allowed/u)
  assert.equal(responseReimuBody, '')
  assert.equal(responseResult.publicDialogues, undefined)
  assert.equal(responseResult.privateCharacterStates, undefined)
  assert.match(responseResult.directorBrief, /把骰子翻过来/u)
  assert.doesNotMatch(responseResult.directorBrief, /不会连自己也坑|绕了个弯|抛回神社/u)
  assert.match(responseResult.finalDraft, /把骰子翻过来/u)
  assert.doesNotMatch(responseResult.finalDraft, /不会连自己也坑|绕了个弯|抛回神社|当面(?:回答|表示)/u)
  assert.doesNotMatch(responseResult.modelContext, /不会连自己也坑|绕了个弯|抛回神社|当面(?:回答|表示)/u)
  const responseStageRequests = sessionEvents(approvedSession).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.turn === 5 ? [event.data] : [])
  assert.equal(responseStageRequests.some(request => ['research', 'director', 'editor'].includes(request.stage)), false)
  assert.deepEqual(responseStageRequests.filter(request => request.stage === 'character')
    .map(request => request.subjectId), [marisaId])
  const compactSectionRequest = responseStageRequests.find(request => request.stage === 'section')
  assert.equal(compactSectionRequest?.dispatch.maxTokens, 768)
  assert.match(compactSectionRequest?.dispatch.system ?? '', /一个自然段、二至四句且不超过 320 个字符/u)

  approvedSession.append('assistant/message', {
    turn: 5,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: responseResult.finalDraft }],
    }),
  }, { surfaceOp: 'append' })
  approvedSession.append('step/end', { turn: 5, step: 1 })
  approvedSession.append('turn/start', { turn: 6 })
  approvedSession.append('step/start', { turn: 6, step: 1 })
  const fallbackResult = await runStoryTurnPipeline({
    ctx: approvedContext,
    agent: approvedAgent,
    store,
    workspace: responseWorkspace,
    turn: 6,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '导演失败时仍让魔理沙自行决定是否回答；棋局状态保持不变。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(fallbackResult.publicDialogues, undefined)
  assert.match(fallbackResult.directorBrief, /把骰子翻过来/u)
  assert.match(fallbackResult.directorBrief, /对白收束：0\/1/u)
  assert.doesNotMatch(fallbackResult.directorBrief, /终点以外|不会连自己也坑|回答后|绕回神社/u)
  assert.doesNotMatch(fallbackResult.finalDraft, /不会连自己也坑|绕了个弯|抛回神社|当面(?:回答|表示)/u)

  approvedSession.append('turn/start', { turn: 7 })
  approvedSession.append('step/start', { turn: 7, step: 1 })
  const deferredResult = await runStoryTurnPipeline({
    ctx: approvedContext,
    agent: approvedAgent,
    store,
    workspace: responseWorkspace,
    turn: 7,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '让魔理沙保持沉默并自行处理是否以后回答；棋局状态保持不变。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(deferredResult.publicDialogues, undefined)
  assert.equal(deferredResult.privateCharacterStates, undefined)
  assert.equal(sessionEvents(approvedSession).some(event => event.type === 'agent-rp/story-stage-result'
    && event.data.turn === 7 && event.data.stage === 'character' && event.data.result.kind === 'failure'), false)

  approvedSession.append('turn/start', { turn: 8 })
  approvedSession.append('step/start', { turn: 8, step: 1 })
  const quietResult = await runStoryTurnPipeline({
    ctx: approvedContext,
    agent: approvedAgent,
    store,
    workspace: responseWorkspace,
    turn: 8,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '让魔理沙自行决定；她没有新的公开行动，棋局状态保持不变。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(quietResult.finalDraft, '')
  assert.equal(quietResult.privateCharacterStates, undefined)
  const quietStageRequests = sessionEvents(approvedSession).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.turn === 8 ? [event.data] : [])
  assert.equal(quietStageRequests.some(request => ['research', 'director', 'section', 'editor'].includes(request.stage)), false)
  assert.deepEqual(quietStageRequests.filter(request => request.stage === 'character')
    .map(request => request.subjectId), [marisaId])

  approvedSession.append('turn/start', { turn: 9 })
  approvedSession.append('step/start', { turn: 9, step: 1 })
  const floridResult = await runStoryTurnPipeline({
    ctx: approvedContext,
    agent: approvedAgent,
    store,
    workspace: responseWorkspace,
    turn: 9,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '让魔理沙只轻敲桌面一下；棋局状态保持不变。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(floridResult.finalDraft, '魔理沙用指节在桌面上轻敲一下，随即收回手。')
  const floridStageRequests = sessionEvents(approvedSession).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.turn === 9 ? [event.data] : [])
  assert.equal(floridStageRequests.some(request => request.stage === 'editor'), true)
  assert.match(floridStageRequests.find(request => request.stage === 'section')?.dispatch.system ?? '',
    /比喻、象征和效果解读/u)
  assert.match(floridStageRequests.find(request => request.stage === 'character')?.dispatch.system ?? '',
    /action 只写外部可观察的动作与落定结果/u)

  approvedSession.append('turn/start', { turn: 10 })
  approvedSession.append('step/start', { turn: 10, step: 1 })
  const simileResult = await runStoryTurnPipeline({
    ctx: approvedContext,
    agent: approvedAgent,
    store,
    workspace: responseWorkspace,
    turn: 10,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '让魔理沙把手掌平放在自己面前；棋局状态保持不变。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(simileResult.finalDraft, '魔理沙把手掌平放在自己面前，随后停手。')
  const simileStageRequests = sessionEvents(approvedSession).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.turn === 10 ? [event.data] : [])
  assert.equal(simileStageRequests.some(request => request.stage === 'editor'), true)
  assert.equal(simileStageRequests.some(request => ['research', 'director'].includes(request.stage)), false)

  const failedUseSession = Session.create(SessionId('world-opportunity-subagent-missed-submission'))
  failedUseSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const failedUseRequests: Array<{
    readonly label?: string
    readonly prompt: readonly { readonly type: string; readonly text?: string }[]
  }> = []
  const failedUseSubagents = {
    getProvider(name: string) {
      return name === 'spawn' ? { name: 'spawn' } : undefined
    },
    async start(_name: string, request: typeof failedUseRequests[number]) {
      failedUseRequests.push(request)
      const childId = `opportunity-subagent-${String(failedUseRequests.length)}`
      const owner = request.label?.includes('博丽灵梦') === true
      return {
        id: SessionId(childId),
        result: Promise.resolve(owner
          ? {
              output: [{ type: 'reasoning' as const, text: '决定使用折签，却没有提交 structured_output。' }],
              stopReason: 'max-tokens' as const,
            }
          : {
              output: [],
              structured: { observation: '', action: '', speech: null, opportunityDecisions: [], insights: [] },
              stopReason: 'completed' as const,
            }),
        async dispose() {},
      }
    },
  }
  const failedUseContext = {
    get(name: string) {
      return name === 'subagents' ? failedUseSubagents : undefined
    },
    logger: { warn() {} },
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string }) {
        const system = options.system ?? ''
        const text = system.includes('单个人物的历史检索 Worker')
          ? JSON.stringify({ references: [] })
          : system.includes('剧情研究 Worker')
            ? JSON.stringify({ findings: [], followUps: [] })
            : system.includes('人物参与路由 Worker')
              ? JSON.stringify({ publicCharacterIds: [reimuId] })
              : JSON.stringify({ sections: [] })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const failedUseResult = await runStoryTurnPipeline({
    ctx: failedUseContext,
    agent: {
      id: failedUseSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: failedUseSession,
    } as Agent,
    store,
    workspace: retainedWorkspace,
    turn: 3,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '灵梦现在使用收好的折签向魔理沙提问；棋局状态保持不变。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(failedUseResult.worldOpportunityResolutions, undefined)
  const failedOwnerRequests = failedUseRequests.filter(request => request.label?.includes('博丽灵梦') === true)
  const failedObserverRequests = failedUseRequests.filter(request => request.label?.includes('雾雨魔理沙') === true)
  assert.equal(failedOwnerRequests.length, 2)
  assert.equal(failedObserverRequests.length, 0)
  assert.match(failedOwnerRequests[1]!.prompt.map(block => block.text ?? '').join('\n'), /structured_output_retry/u)
  assert.equal(module.characterOpportunities!(store.get(workspace.id).world!, reimuId, worldContext)[0]?.status, 'retained')

  assert.throws(() => store.materializeTurn(workspace.id, {
    key: 'world-opportunity-use-without-visible-question',
    turn: 4,
    title: '错误使用折签',
    summary: '',
    evidence: '灵梦没有开口。',
    participantIds: [reimuId, marisaId],
    worldOpportunityResolutions: [{
      opportunityId: opportunity.id,
      characterId: reimuId,
      disposition: 'use',
      responderId: marisaId,
      publicEvidence: '“你来这里以前，最后看见了什么？”',
    }],
    changes: noChanges,
    webResearch: [],
  }), /公开使用证据不在可见正文/u)
  const usedWorkspace = store.materializeTurn(workspace.id, {
    key: 'world-opportunity-used-later',
    turn: 4,
    title: '使用折签',
    summary: '灵梦向魔理沙提问。',
    evidence: '灵梦问：“你来这里以前，最后看见了什么？”',
    participantIds: [reimuId, marisaId],
    worldOpportunityResolutions: [{
      opportunityId: opportunity.id,
      characterId: reimuId,
      disposition: 'use',
      responderId: marisaId,
      publicEvidence: '“你来这里以前，最后看见了什么？”',
    }],
    changes: noChanges,
    webResearch: [],
  })
  assert.equal((usedWorkspace.world!.state as FlyingChessWorldState).opportunities[0]?.status, 'used')
  const usedWorldEvent = usedWorkspace.world!.events.at(-1)!
  assert.equal(usedWorldEvent.type, 'narrative.opportunity-used')
  assert.equal(usedWorldEvent.summary, '博丽灵梦向雾雨魔理沙问：“你来这里以前，最后看见了什么？”')
  assert.deepEqual(usedWorkspace.events.at(-1)?.worldEventSequences, [usedWorldEvent.sequence])
  assert.deepEqual(storyPendingWorldEvents(usedWorkspace), [])
  const crossSession = Session.create(SessionId('world-opportunity-cross-session-reply'))
  crossSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  crossSession.append('turn/start', { turn: 1 })
  crossSession.append('step/start', { turn: 1, step: 1 })
  const crossSessionAnswer = '“香霖堂。你也想去？”'
  const crossSessionContext = {
    sessions: { flush: async () => true },
    llm: {
      async resolveModelInfo(provider: string, model: string) {
        return {
          provider,
          id: model,
          name: model,
          reasoning: { efforts: [{ id: 'off', name: 'Off' }], defaultEffort: 'off' },
        }
      },
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        const seedId = body.match(/\[seed:([^\]]+)\]\[目标人物\]/u)?.[1] ?? ''
        let text: string
        if (system.includes('人物参与路由 Worker')) {
          text = JSON.stringify({ publicCharacterIds: [marisaId] })
        } else if (system.includes('单个人物的历史检索 Worker')) {
          text = JSON.stringify({ references: [] })
        } else if (system.includes('指定人物认知')) {
          text = JSON.stringify({
            observation: '灵梦向自己问了终点以外还有什么在等她。',
            action: '',
            speech: {
              respondsTo: `灵梦问魔理沙：${approvedQuestion}`,
              move: 'answer',
              focus: '自己刚从香霖堂回来。',
              effect: '直接回答灵梦的问题。',
            },
            opportunityDecisions: [],
            insights: [],
          })
        } else if (system.includes('人物自己的对白 Worker')) {
          text = JSON.stringify({ lines: [{
            reference: `speech:${proseId}:1`,
            move: 'answer',
            seedLineIds: seedId === '' ? [] : [seedId],
            mechanics: '沿用先给地点、再接一句反问的次序。',
            leftImplicit: '她刚才的具体行程。',
            dialogue: crossSessionAnswer,
          }] })
        } else if (system.includes('严格对白审校 Worker')) {
          text = JSON.stringify({ lines: [{ reference: `speech:${proseId}:1`, dialogue: crossSessionAnswer }] })
        } else if (system.includes('剧情导演 Worker')) {
          text = JSON.stringify({ sections: [{ sectionId: proseId, beats: [], speech: [{ characterId: marisaId }] }] })
        } else if (system.includes('分区的 prose Worker')) {
          text = `魔理沙答道：${crossSessionAnswer}`
        } else if (system.includes('最终正文编辑 Worker')) {
          text = JSON.stringify({ sections: [{ sectionId: proseId, text: `魔理沙答道：${crossSessionAnswer}` }] })
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
  const crossSessionResult = await runStoryTurnPipeline({
    ctx: crossSessionContext,
    agent: {
      id: crossSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: crossSession,
    } as Agent,
    store,
    workspace: usedWorkspace,
    turn: 1,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '让魔理沙回答灵梦刚才的问题；棋局状态保持不变。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.deepEqual(crossSessionResult.publicDialogues?.map(dialogue => ({
    characterId: dialogue.characterId,
    targetCharacterId: dialogue.targetCharacterId,
    dialogue: dialogue.dialogue,
    move: dialogue.move,
    replyToWorldOpportunityId: dialogue.replyToWorldOpportunityId,
  })), [{
    characterId: marisaId,
    targetCharacterId: reimuId,
    dialogue: crossSessionAnswer,
    move: 'answer',
    replyToWorldOpportunityId: opportunity.id,
  }])
  assert.deepEqual(crossSessionResult.worldOpportunityReplies, [{
    opportunityId: opportunity.id,
    characterId: marisaId,
    ownerId: reimuId,
    move: 'answer',
    publicEvidence: crossSessionAnswer,
  }])
  const replyEvidence = `魔理沙答道：${crossSessionAnswer}`
  const repliedWorkspace = store.materializeTurn(workspace.id, {
    key: 'world-opportunity-replied-later',
    turn: 5,
    title: '回应折签问题',
    summary: '魔理沙回答灵梦。',
    evidence: replyEvidence,
    participantIds: [reimuId, marisaId],
    worldOpportunityReplies: [{
      opportunityId: opportunity.id,
      characterId: marisaId,
      ownerId: reimuId,
      move: 'answer',
      publicEvidence: crossSessionAnswer,
    }],
    changes: noChanges,
    webResearch: [],
  })
  const repliedWorldEvent = repliedWorkspace.world!.events.at(-1)!
  assert.equal(repliedWorldEvent.type, 'narrative.opportunity-replied')
  assert.equal(repliedWorldEvent.summary, `雾雨魔理沙回应博丽灵梦：${crossSessionAnswer}`)
  assert.deepEqual(repliedWorkspace.events.at(-1)?.worldEventSequences, [repliedWorldEvent.sequence])
  assert.deepEqual(storyPendingWorldEvents(repliedWorkspace), [])
  const closedSession = Session.create(SessionId('world-opportunity-cross-session-closed'))
  closedSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  closedSession.append('turn/start', { turn: 1 })
  closedSession.append('step/start', { turn: 1, step: 1 })
  const closedResult = await runStoryTurnPipeline({
    ctx: crossSessionContext,
    agent: {
      id: closedSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: closedSession,
    } as Agent,
    store,
    workspace: repliedWorkspace,
    turn: 1,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '让魔理沙再说一句；棋局状态保持不变。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(closedResult.worldOpportunityReplies, undefined)
})

test('projects first launch, ordinary movement, collision, and finish at their narrative cadence', () => {
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const playContext = {
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
    configuration: {},
    sourceReferences: [],
  }
  const cardModule = createFlyingChessWorldModule({ rollDie: () => 1 })
  const cardContext: PlayWorldContext = {
    ...playContext,
    configuration: {
      format: 0,
      ruleset: 'classic-24',
      narrativeCards: [{
        id: 'fixture-two-passes',
        trigger: { kind: 'consecutive-passes', count: 2 },
        event: { title: '纸签落下', summary: '第二次停顿时，一张纸签落到棋盘中央。' },
        cue: { kind: 'opportunity', text: '其他人物可以决定是否查看纸签。', responders: 'opponents' },
        repeat: false,
      }],
    },
  }
  let cardSnapshot = cardModule.create(cardContext)
  for (let turnIndex = 0; turnIndex < 2; turnIndex += 1) {
    const cardTurn = cardModule.characterTurn(cardSnapshot, cardContext)!
    cardSnapshot = cardModule.dispatch(cardSnapshot, cardTurn.actions[0]!.action, cardContext)
  }
  const cardEvent = cardSnapshot.events.at(-1)!
  assert.equal(cardEvent.type, 'scene.changed')
  assert.equal(cardEvent.title, '纸签落下')
  assert.equal((cardEvent.data as { readonly cardId?: unknown }).cardId, 'fixture-two-passes')
  assert.deepEqual((cardEvent.data as { readonly characterIds?: unknown }).characterIds, [reimuId])

  const rolls = [6, 2, 6]
  const module = createFlyingChessWorldModule({ rollDie: () => rolls.shift()! })
  let snapshot = module.create(playContext)

  const opening = projectPlayWorldNarrative(
    module.projectNarrative(snapshot, [snapshot.events[0]!.sequence], playContext),
    [snapshot.events[0]!.sequence],
    playContext,
  )
  assert.equal(opening.cadence, 'scene')
  assert.deepEqual(opening.cues, [])

  let turn = module.characterTurn(snapshot, playContext)!
  const firstStart = snapshot.events.length
  snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
  turn = module.characterTurn(snapshot, playContext)!
  snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
  const firstSequences = snapshot.events.slice(firstStart).map(event => event.sequence)
  const firstLaunch = projectPlayWorldNarrative(
    module.projectNarrative(snapshot, firstSequences, playContext),
    firstSequences,
    playContext,
  )
  assert.equal(firstLaunch.cadence, 'scene')
  assert.equal(firstLaunch.facts.find(fact => fact.eventSequences.length === 2)?.retention, 'essential')
  assert.deepEqual(firstLaunch.cues, [])

  turn = module.characterTurn(snapshot, playContext)!
  const ordinaryStart = snapshot.events.length
  snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
  turn = module.characterTurn(snapshot, playContext)!
  snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
  const ordinarySequences = snapshot.events.slice(ordinaryStart).map(event => event.sequence)
  const ordinaryMove = projectPlayWorldNarrative(
    module.projectNarrative(snapshot, ordinarySequences, playContext),
    ordinarySequences,
    playContext,
  )
  assert.equal(ordinaryMove.cadence, 'transition')
  assert.equal(ordinaryMove.facts.find(fact => fact.eventSequences.length === 2)?.retention, 'compressible')
  assert.deepEqual(ordinaryMove.cues, [])

  turn = module.characterTurn(snapshot, playContext)!
  const marisaLaunchStart = snapshot.events.length
  snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
  turn = module.characterTurn(snapshot, playContext)!
  snapshot = module.dispatch(snapshot, turn.actions[0]!.action, playContext)
  const marisaLaunchSequences = snapshot.events.slice(marisaLaunchStart).map(event => event.sequence)
  const marisaLaunch = projectPlayWorldNarrative(
    module.projectNarrative(snapshot, marisaLaunchSequences, playContext),
    marisaLaunchSequences,
    playContext,
  )
  assert.equal(marisaLaunch.cadence, 'scene')
  assert.equal(marisaLaunch.facts.find(fact => fact.eventSequences.length === 2)?.retention, 'essential')

  const collisionModule = createFlyingChessWorldModule()
  const collisionCreated = collisionModule.create(playContext)
  const collisionState = collisionCreated.state as FlyingChessWorldState
  const reimuPiece = collisionState.pieces.find(piece => piece.ownerId === reimuId)!
  const marisaPiece = collisionState.pieces.find(piece => piece.ownerId === marisaId)!
  const collisionPrepared = {
    ...collisionCreated,
    state: {
      ...collisionState,
      pieces: collisionState.pieces.map(piece => piece.id === reimuPiece.id
        ? { ...piece, status: 'track' as const, steps: 12 }
        : piece.id === marisaPiece.id
          ? { ...piece, status: 'track' as const, steps: 1 }
          : piece),
      pendingRoll: { playerId: reimuId, value: 1, legalPieceIds: [reimuPiece.id] },
    },
  }
  const collided = collisionModule.dispatch(collisionPrepared, {
    type: 'move',
    actorId: reimuId,
    pieceId: reimuPiece.id,
  }, playContext)
  const collisionSequences = collided.events.slice(collisionCreated.events.length).map(event => event.sequence)
  const collision = projectPlayWorldNarrative(
    collisionModule.projectNarrative(collided, collisionSequences, playContext),
    collisionSequences,
    playContext,
  )
  assert.equal(collision.cadence, 'scene')
  assert.equal(collision.cues.some(cue => cue.kind === 'relationship'), true)

  const finishModule = createFlyingChessWorldModule()
  const finishCreated = finishModule.create(playContext)
  const finishState = finishCreated.state as FlyingChessWorldState
  const finishingPieces = finishState.pieces.filter(piece => piece.ownerId === reimuId)
  const finishingPiece = finishingPieces[0]!
  const alreadyHome = new Set(finishingPieces.slice(1).map(piece => piece.id))
  const finishPrepared = {
    ...finishCreated,
    state: {
      ...finishState,
      pieces: finishState.pieces.map(piece => piece.id === finishingPiece.id
        ? { ...piece, status: 'track' as const, steps: 23 }
        : alreadyHome.has(piece.id)
          ? { ...piece, status: 'home' as const, steps: 24 }
          : piece),
      pendingRoll: { playerId: reimuId, value: 1, legalPieceIds: [finishingPiece.id] },
    },
  }
  const finished = finishModule.dispatch(finishPrepared, {
    type: 'move',
    actorId: reimuId,
    pieceId: finishingPiece.id,
  }, playContext)
  const finishSequences = finished.events.slice(finishCreated.events.length).map(event => event.sequence)
  const finish = projectPlayWorldNarrative(
    finishModule.projectNarrative(finished, finishSequences, playContext),
    finishSequences,
    playContext,
  )
  assert.equal(finish.cadence, 'resolution')
  assert.equal(finish.cues.some(cue => cue.kind === 'relationship'), true)
})

test('shows recorded facts to every character but only offers a cue to its named characters', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-world-pressure-scene-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const flyingChess = createFlyingChessWorldModule({ rollDie: () => 1 })
  worlds.register({
    ...flyingChess,
    projectNarrative(snapshot, eventSequences, playContext) {
      const projection = flyingChess.projectNarrative(snapshot, eventSequences, playContext)
      return {
        ...projection,
        cues: projection.cues.map(cue => ({ ...cue, characterIds: [reimuId] })),
      }
    },
  })
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '现场压力正文' })
  const proseId = createStoryOutputId()
  let workspace = store.save({
    ...editable(created),
    characters: [
      character(reimuId, '博丽灵梦', '博丽神社的巫女。'),
      character(marisaId, '雾雨魔理沙', '住在魔法森林的人类魔法使。'),
    ],
    outputs: [{
      id: proseId,
      name: '正文',
      kind: 'prose',
      enabled: true,
      instructions: '写成一段连续的场景。',
    }],
  })
  workspace = store.installWorld(workspace.id, {
    format: 0,
    revision: workspace.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  for (let turn = 0; turn < 4; turn += 1) {
    const available = store.worldTurn(workspace.id)!
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: available.cycleId,
      actionId: 'roll',
    })
  }
  const pendingWorldSequences = storyPendingWorldEvents(workspace).map(event => event.sequence)
  const playContext = resolveStoryPlayWorldContext(workspace)
  const projection = projectPlayWorldNarrative(
    flyingChess.projectNarrative(workspace.world!, pendingWorldSequences, playContext),
    pendingWorldSequences,
    playContext,
  )
  const session = Session.create(SessionId('world-pressure-scene'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const scenePassages = [{
    sourceIds: projection.facts.map(fact => `world:${fact.eventSequences.join('.')}`),
    text: '博丽灵梦、雾雨魔理沙在棋盘两侧坐定。几轮过去，一枚骰子在两人之间滚了又停，博丽灵梦与雾雨魔理沙的飞机都没有移动，一架也没有离开基地。一阵风忽然掀起棋盘一角，基地里的木机随之晃动。',
  }, {
    sourceIds: [`action:${reimuId}`],
    text: '博丽灵梦捡起那枚已经晃动的木机随手查看一遍，把它放回原位，让木机重新稳住。',
  }]
  const compressibleSourceIds = projection.facts
    .filter(fact => fact.retention === 'compressible')
    .map(fact => `world:${fact.eventSequences.join('.')}`)
  const essentialSourceIds = projection.facts
    .filter(fact => fact.retention === 'essential')
    .map(fact => `world:${fact.eventSequences.join('.')}`)
  const recoveredPassages = [{
    sourceIds: essentialSourceIds,
    text: '一阵风忽然掀起棋盘一角，基地里的木机随之晃动。',
  }, {
    sourceIds: [`action:${reimuId}`],
    text: '博丽灵梦捡起那枚已经晃动的木机随手查看一遍，把它放回原位，让木机重新稳住。',
  }]
  const recoveryAttemptPassages = [{
    sourceIds: compressibleSourceIds,
    text: '几轮过去，一枚骰子在两人之间滚了又停，博丽灵梦与雾雨魔理沙的飞机都没有移动。博丽灵梦没有说话。',
  }, {
    sourceIds: essentialSourceIds,
    text: `${recoveredPassages[0]!.text}骰子随后被递给魔理沙。`,
  }, {
    sourceIds: [`action:${reimuId}`],
    text: '我捡起那枚已经晃动的木机随手查看一遍，把它放回原位，让木机重新稳住。',
  }]
  const completeRecoveredPassages = [
    ...projection.facts.map(fact => ({
      sourceIds: [`world:${fact.eventSequences.join('.')}`],
      text: fact.text,
    })),
    recoveredPassages[1]!,
  ]
  const recoveredText = completeRecoveredPassages.map(passage => passage.text).join('\n\n')
  const characterBodies: string[] = []
  let directorBody = ''
  const sectionBodies: string[] = []
  let editorBody = ''
  let sectionAttempts = 0
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
            ],
            defaultEffort: 'low',
          },
        }
      },
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        if (system.includes('指定人物认知')) characterBodies.push(body)
        if (system.includes('剧情导演 Worker')) directorBody = body
        if (system.includes('分区的 prose Worker')) {
          sectionAttempts += 1
          sectionBodies.push(`${system}\n${body}`)
        }
        if (system.includes('最终正文编辑 Worker')) editorBody = `${system}\n${body}`
        const text = system.includes('单个人物的历史检索 Worker')
          ? JSON.stringify({ references: [] })
          : system.includes('指定人物认知')
            ? body.includes('# 人物：博丽灵梦')
              ? JSON.stringify({
                  observation: '风掀起棋盘一角，基地里的木机正在晃动。',
                  action: '灵梦捡起那枚已经晃动的木机随手查看一遍，把它放回原位，让木机重新稳住，顺手拂去落在棋盘边沿的一片落叶。',
                  speech: null,
                  insights: [],
                })
              : JSON.stringify({
                  observation: '风掀起棋盘一角，灵梦已经伸手压住棋盘。',
                  action: '魔理沙把手按到棋盘另一角。',
                  speech: null,
                  insights: [{
                    kind: 'intention',
                    text: '魔理沙打算在风再次掀动棋盘时先按住自己一侧。',
                    futureChoice: '棋盘再次被风掀动时，先按住自己一侧。',
                  }],
                })
            : system.includes('剧情导演 Worker')
              ? JSON.stringify({ sections: [{
                  sectionId: proseId,
                  beats: ['灵梦捡起已经晃动的木机查看后放回原位，让木机重新稳住。'],
                  speech: [],
                }] })
              : system.includes('分区的 prose Worker')
                ? (() => {
                    const serialized = JSON.stringify({ passages: sectionAttempts === 1
                      ? [{
                          sourceIds: scenePassages.flatMap(passage => passage.sourceIds),
                          text: `一枚骰子在棋盘上停住。棋盘边沿多了一架纸机，机身写着“测试”。${scenePassages[1]!.text}`,
                        }]
                      : scenePassages })
                    return sectionAttempts === 1
                      ? serialized.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/gu, '“$1”').replace(/”:/gu, '”：')
                      : JSON.stringify({ passages: recoveryAttemptPassages })
                  })()
                : system.includes('最终正文编辑 Worker')
                  ? JSON.stringify({ sections: [{ sectionId: proseId, passages: scenePassages.slice().reverse() }] })
              : (() => { throw new Error(`不应调用额外故事阶段：${system.slice(0, 40)}`) })()
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    store,
    workspace,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })

  assert.equal(result.finalDraft, recoveredText)
  assert.match(result.finalDraft, /一阵风忽然掀起棋盘一角/u)
  assert.doesNotMatch(result.finalDraft, /掷出 1|第 \d+ 回合/u)
  assert.doesNotMatch(result.finalDraft, /没有说话/u)
  assert.doesNotMatch(result.finalDraft, /递给魔理沙/u)
  const reimuBody = characterBodies.find(body => body.includes('# 人物：博丽灵梦')) ?? ''
  const marisaBody = characterBodies.find(body => body.includes('# 人物：雾雨魔理沙')) ?? ''
  assert.match(reimuBody, /棋盘被风掀动/u)
  assert.match(marisaBody, /棋盘被风掀动/u)
  assert.match(reimuBody, /棋盘需要先被重新压稳/u)
  assert.doesNotMatch(marisaBody, /棋盘需要先被重新压稳/u)
  assert.equal(directorBody, '')
  assert.match(result.finalDraft, /博丽灵梦捡起那枚已经晃动的木机随手查看一遍，把它放回原位，让木机重新稳住/u)
  assert.doesNotMatch(result.finalDraft, /落叶/u)
  assert.doesNotMatch(result.finalDraft, /魔理沙把手按到棋盘另一角/u)
  const characterRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'character' ? [event.data] : [])
  const sectionRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'section' ? [event.data] : [])
  assert.equal(characterRequests.length, 2)
  assert.deepEqual(sectionRequests.map(request => request.subjectId), [
    proseId,
    `scene-source-repair:${proseId}`,
  ])
  assert.equal(sectionRequests[1]?.dispatch.reasoningEffort, 'off')
  assert.equal(sectionRequests[1]?.dispatch.maxTokens, 2_048)
  assert.equal(sessionEvents(session).some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'research'), false)
  assert.equal(sessionEvents(session).some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'director'), false)
  assert.match(sectionBodies[1]!, /每个 sourceId 只能用于一个 passage/u)
  assert.match(sectionBodies[1]!, /source_validation_failure/u)
  assert.match(sectionBodies[1]!, /没有呈现所列来源[^\n]*world:/u)
  assert.match(sectionBodies[1]!, /不存在的物件[^\n]*纸机/u)
  assert.match(sectionBodies[1]!, /世界事实与人物后续材料不能合并到同一 passage/u)
  assert.match(sectionBodies[1]!, /实体名称逐字沿用相关来源/u)
  assert.match(sectionBodies[1]!, /objectNames 只允许沿用已有物件名称/u)
  assert.match(sectionBodies[1]!, /allowedPublicActions 和 approvedDialogues 中的每一项都是必要来源/u)
  assert.match(sectionBodies[1]!, /JSON 只是来源容器/u)
  assert.match(sectionBodies[1]!, /只改正 source_validation_failure/u)
  assert.match(sectionBodies[1]!, /至少保留三项各自独立的 world passage/u)
  assert.equal(sectionAttempts, 2)
  assert.match(editorBody, /带 sourcePassages 的 prose/u)
  assert.deepEqual(result.finalSections[0]?.sourcePassages, completeRecoveredPassages)
  assert.equal(result.hostOwnedWorldDraft, undefined)
  assert.deepEqual(result.privateCharacterStates, [{
    characterId: marisaId,
    insights: [{
      kind: 'intention',
      text: '棋盘再次被风掀动时，先按住自己一侧。',
    }],
  }])
  assert.equal(result.publicWorldEvents?.at(-1)?.type, 'scene.changed')
})

test('falls back from invalid prose for a simple event-card scene without inventions', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-world-narrative-authority-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const rolls = [3, 4, 4, 4]
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => rolls.shift()! }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const created = store.create({ format: 2, name: '叙事校验材料' })
  let workspace = store.save({
    ...editable(created),
    characters: [
      character(reimuId, '博丽灵梦', '博丽神社的巫女。'),
      character(marisaId, '雾雨魔理沙', '住在魔法森林的人类魔法使。'),
    ],
    outputs: [{
      id: proseId,
      name: '正文',
      kind: 'prose',
      enabled: true,
      instructions: '把权威事件写成连续场景。',
    }],
  })
  workspace = store.installWorld(workspace.id, {
    format: 0,
    revision: workspace.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  for (let turn = 0; turn < 4; turn += 1) {
    const available = store.worldTurn(workspace.id)!
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: available.cycleId,
      actionId: 'roll',
    })
  }

  const session = Session.create(SessionId('world-narrative-authority'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        let text: string
        if (system.includes('单个人物的历史检索 Worker')) {
          text = JSON.stringify({ references: [] })
        } else if (system.includes('指定人物认知')) {
          text = body.includes('# 人物：雾雨魔理沙')
              ? JSON.stringify({
                  observation: '风掀起棋盘一角，基地里的木机正在晃动。',
                  action: '雾雨魔理沙伸手按住翻起的棋盘角，又从桌边拿来一块石子压在棋盘角上。',
                  speech: {
                    respondsTo: '一阵风掀起棋盘一角，基地里的木机随之晃动。',
                    move: 'inform',
                    focus: '先把棋盘压稳。',
                    effect: '先压稳棋盘，再继续对局。',
                  },
                  insights: [],
                })
            : JSON.stringify({
                observation: '风掀起棋盘一角。',
                action: '灵梦抬眼看向风口。',
                speech: null,
                insights: [],
              })
        } else if (system.includes('对白')) {
          text = JSON.stringify({ lines: [] })
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
  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    store,
    workspace,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })

  assert.equal(result.finalDraft, [
    '博丽灵梦、雾雨魔理沙在棋盘两侧坐定。几轮过去，博丽灵梦与雾雨魔理沙的飞机都没有移动。一阵风忽然掀起棋盘一角，基地里的木机随之晃动。',
    '雾雨魔理沙伸手按住翻起的棋盘角。',
  ].join('\n\n'))
  assert.equal(result.hostOwnedWorldDraft, true)
  assert.equal(sessionEvents(session).some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'section'), true)
  assert.equal(sessionEvents(session).some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'editor'), false)
  assert.doesNotMatch(result.finalDraft, /两张棋盘|四只骰子|相同的白点|灵梦抬眼|石子/u)
})

test('falls back to the causal roll when sourced prose omits a first launch', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-first-launch-retention-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const rolls = [3, 2, 1, 6]
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => rolls.shift()! }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const created = store.create({ format: 2, name: '首次起飞因果' })
  let workspace = store.save({
    ...editable(created),
    characters: [
      character(reimuId, '博丽灵梦', '博丽神社的巫女。'),
      character(marisaId, '雾雨魔理沙', '住在魔法森林的人类魔法使。'),
    ],
    outputs: [{
      id: proseId,
      name: '正文',
      kind: 'prose',
      enabled: true,
      instructions: '写成连续场景。',
    }],
  })
  workspace = store.installWorld(workspace.id, {
    format: 0,
    revision: workspace.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  for (let turn = 0; turn < 4; turn += 1) {
    let available = store.worldTurn(workspace.id)!
    assert.equal(available.actions[0]?.id, 'roll')
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: available.cycleId,
      actionId: 'roll',
    })
    available = store.worldTurn(workspace.id)!
    const move = available.actions.find(action => action.id.startsWith('move:'))
    if (move !== undefined) {
      workspace = store.dispatchWorldAction(workspace.id, {
        format: 0,
        revision: workspace.revision,
        cycleId: available.cycleId,
        actionId: move.id,
      })
    }
  }

  const session = Session.create(SessionId('first-launch-retention'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const incomplete = '灵梦先后掷出三点和一点，魔理沙掷出两点。魔理沙的一号机已经离开基地，停在航线开头。'
  let sectionBody = ''
  let editorBody = ''
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        let text: string
        if (system.includes('单个人物的历史检索 Worker')) {
          text = JSON.stringify({ references: [] })
        } else if (system.includes('指定人物认知')) {
          text = JSON.stringify({ observation: '棋局继续。', action: '', speech: null, insights: [] })
        } else if (system.includes('分区的 prose Worker')) {
          sectionBody = body
          text = incomplete
        } else if (system.includes('最终正文编辑 Worker')) {
          editorBody = body
          text = JSON.stringify({ sections: [{ sectionId: proseId, text: incomplete }] })
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
  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    store,
    workspace,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })

  assert.match(sectionBody, /retention[\s\S]*essential/u)
  assert.equal(editorBody, '')
  assert.notEqual(result.finalDraft, incomplete)
  assert.match(result.finalDraft, /雾雨魔理沙掷出的骰子停在 6 点，随后把 1 号飞机推进到航线第 1 步/u)
  assert.equal(result.hostOwnedWorldDraft, true)
  assert.equal(result.finalSections[0]?.sourcePassages, undefined)
})

test('retries an editor that collapses a full world scene into an event summary', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-scene-editor-retention-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 6 }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const created = store.create({ format: 2, name: '完整场景编辑保留' })
  let workspace = store.save({
    ...editable(created),
    characters: [
      character(reimuId, '博丽灵梦', '博丽神社的巫女。'),
      character(marisaId, '雾雨魔理沙', '住在魔法森林的人类魔法使。'),
    ],
    outputs: [{ id: proseId, name: '正文', kind: 'prose', enabled: true, instructions: '写成连续场景。' }],
  })
  workspace = store.installWorld(workspace.id, {
    format: 0,
    revision: workspace.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  let available = store.worldTurn(workspace.id)!
  workspace = store.dispatchWorldAction(workspace.id, {
    format: 0,
    revision: workspace.revision,
    cycleId: available.cycleId,
    actionId: 'roll',
  })
  available = store.worldTurn(workspace.id)!
  const move = available.actions.find(action => action.id.startsWith('move:'))
  assert.ok(move)
  workspace = store.dispatchWorldAction(workspace.id, {
    format: 0,
    revision: workspace.revision,
    cycleId: available.cycleId,
    actionId: move.id,
  })
  const pendingSequences = storyPendingWorldEvents(workspace).map(event => event.sequence)
  const playContext = resolveStoryPlayWorldContext(workspace)
  const projection = projectPlayWorldNarrative(
    worlds.get(workspace.world!.moduleId).projectNarrative(workspace.world!, pendingSequences, playContext),
    pendingSequences,
    playContext,
  )
  assert.equal(projection.cadence, 'scene')
  const requiredFacts = projection.facts.filter(fact => fact.retention === 'essential')
  const requiredSourceIds = requiredFacts.map(fact => `world:${fact.eventSequences.join('.')}`)
  const compactText = requiredFacts.map(fact => fact.text).join(' ')
  const richText = [
    `骰子沿棋盘滚过几格才停稳，六点朝上留在两座基地之间。${requiredFacts[0]?.text ?? ''}`,
    `基地与航线之间终于出现了变化。靠近出口的木机被推离原来的位置，底座顺着格线向前滑去。${requiredFacts[1]?.text ?? ''}`,
    `木机越过起飞线，在新的格位上落定；同一座基地里的其余木机仍停在原处。${requiredFacts.slice(2).map(fact => fact.text).join('')}`,
  ].join('\n\n')
  assert.ok(richText.length >= 160)
  const richPassage = { sourceIds: requiredSourceIds, text: richText }
  let editorCalls = 0
  let emptyEditor = false
  const editorSystems: string[] = []
  const session = Session.create(SessionId('scene-editor-retention'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        let text: string
        if (system.includes('单个人物的历史检索 Worker')) {
          text = JSON.stringify({ references: [] })
        } else if (system.includes('指定人物认知')) {
          const opportunityIds = [...body.matchAll(/id=(opportunity:[^\\t\\n"]+)/gu)].map(match => match[1]!)
          text = JSON.stringify({
            observation: '棋局出现了第一次起飞。',
            action: '',
            speech: null,
            opportunityDecisions: opportunityIds.map(opportunityId => ({
              opportunityId,
              disposition: 'retain',
              responderId: null,
            })),
            insights: [],
          })
        } else if (system.includes('分区的 prose Worker')) {
          text = JSON.stringify({ passages: [richPassage] })
        } else if (system.includes('最终正文编辑 Worker')) {
          editorCalls += 1
          editorSystems.push(system)
          text = emptyEditor ? '' : JSON.stringify({
            sections: [{
              sectionId: proseId,
              passages: [editorCalls === 1
                ? { sourceIds: requiredSourceIds, text: compactText }
                : richPassage],
            }],
          })
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

  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    store,
    workspace,
    turn: 1,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })

  assert.equal(editorCalls, 2)
  assert.doesNotMatch(editorSystems[0]!, /上一稿把完整场景压成了事件摘要/u)
  assert.match(editorSystems[1]!, /不得用一段规则复述替代整场/u)
  assert.equal(result.finalDraft, richText)
  assert.equal(result.finalDraft.split(/\n\s*\n/gu).length, 3)

  emptyEditor = true
  editorCalls = 0
  editorSystems.length = 0
  const emptySession = Session.create(SessionId('scene-editor-empty-fallback'))
  emptySession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const fallback = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: emptySession.id, options: { provider: 'fixture', model: 'fixture' }, session: emptySession } as Agent,
    store,
    workspace,
    turn: 1,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(editorCalls, 1)
  assert.equal(sessionEvents(emptySession).filter(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'editor').length, 1)
  assert.equal(fallback.finalDraft, richText)
})

test('repairs a source-invalid scene before falling back to required facts', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-scene-source-repair-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 6 }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const created = store.create({ format: 2, name: '完整场景来源修复' })
  let workspace = store.save({
    ...editable(created),
    characters: [
      character(reimuId, '博丽灵梦', '博丽神社的巫女。'),
      character(marisaId, '雾雨魔理沙', '住在魔法森林的人类魔法使。'),
    ],
    outputs: [{ id: proseId, name: '正文', kind: 'prose', enabled: true, instructions: '写成连续场景。' }],
  })
  workspace = store.installWorld(workspace.id, {
    format: 0,
    revision: workspace.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  let available = store.worldTurn(workspace.id)!
  workspace = store.dispatchWorldAction(workspace.id, {
    format: 0,
    revision: workspace.revision,
    cycleId: available.cycleId,
    actionId: 'roll',
  })
  available = store.worldTurn(workspace.id)!
  const move = available.actions.find(action => action.id.startsWith('move:'))
  assert.ok(move)
  workspace = store.dispatchWorldAction(workspace.id, {
    format: 0,
    revision: workspace.revision,
    cycleId: available.cycleId,
    actionId: move.id,
  })
  const pendingSequences = storyPendingWorldEvents(workspace).map(event => event.sequence)
  const playContext = resolveStoryPlayWorldContext(workspace)
  const projection = projectPlayWorldNarrative(
    worlds.get(workspace.world!.moduleId).projectNarrative(workspace.world!, pendingSequences, playContext),
    pendingSequences,
    playContext,
  )
  assert.equal(projection.cadence, 'scene')
  const safePassages = projection.facts.map(fact => ({
    sourceIds: [`world:${fact.eventSequences.join('.')}`],
    text: fact.text,
  }))
  assert.ok(safePassages.length >= 3)
  const safeText = safePassages.map(passage => passage.text).join('\n\n')
  assert.ok(safeText.length < 160)
  let sectionCalls = 0
  const sectionSystems: string[] = []
  let editorCalls = 0
  const editorSystems: string[] = []
  const session = Session.create(SessionId('scene-source-repair'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        let text: string
        if (system.includes('单个人物的历史检索 Worker')) {
          text = JSON.stringify({ references: [] })
        } else if (system.includes('指定人物认知')) {
          const opportunityIds = [...body.matchAll(/id=(opportunity:[^\t\n"]+)/gu)].map(match => match[1]!)
          text = JSON.stringify({
            observation: '棋局出现了第一次起飞。',
            action: '',
            speech: null,
            opportunityDecisions: opportunityIds.map(opportunityId => ({
              opportunityId,
              disposition: 'retain',
              responderId: null,
            })),
            insights: [],
          })
        } else if (system.includes('分区的 prose Worker')) {
          sectionCalls += 1
          sectionSystems.push(system)
          text = sectionCalls < 3
            ? JSON.stringify({ passages: [{ sourceIds: ['world:missing'], text: '无效来源。' }] })
            : JSON.stringify({ passages: safePassages })
        } else if (system.includes('最终正文编辑 Worker')) {
          editorCalls += 1
          editorSystems.push(system)
          text = JSON.stringify({
            sections: [{
              sectionId: proseId,
              passages: editorCalls === 1 ? safePassages.slice(1) : safePassages,
            }],
          })
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

  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    store,
    workspace,
    turn: 1,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })

  assert.equal(sectionCalls, 2)
  assert.match(sectionSystems[1]!, /只改正 source_validation_failure/u)
  assert.match(sectionSystems[1]!, /至少保留三项各自独立的 world passage/u)
  assert.equal(editorCalls, 2)
  assert.match(editorSystems[1]!, /不得用一段规则复述替代整场/u)
  assert.equal(result.finalDraft, safeText)
  assert.deepEqual(result.finalSections[0]?.sourcePassages, safePassages)
})

test('renders routine world transitions from authoritative facts without prose stages', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-compact-world-transition-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const rolls = [1, 1, 1, 1, 2, 5, 1, 1]
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => rolls.shift()! }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const created = store.create({ format: 2, name: '紧凑规则过渡' })
  const reimu = character(reimuId, '博丽灵梦', '博丽神社的巫女。')
  const configured = store.save({
    ...editable(created),
    characters: [
      { ...reimu, profile: { ...reimu.profile, exampleDialogue: '博丽灵梦：“这还用问？”' } },
      character(marisaId, '雾雨魔理沙', '住在魔法森林的人类魔法使。'),
    ],
    outputs: [{ id: proseId, name: '正文', kind: 'prose', enabled: true, instructions: '写成连续场景。' }],
  })
  let workspace = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  for (let turn = 0; turn < 4; turn += 1) {
    const available = store.worldTurn(workspace.id)!
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: available.cycleId,
      actionId: 'roll',
    })
  }
  const processedSequences = workspace.world!.events.map(event => event.sequence)
  workspace = store.save({
    ...editable(workspace),
    events: [{
      id: createStoryEventId(),
      key: 'turn:1',
      turn: 1,
      title: '开局风波',
      summary: '此前的开局场景已经写完。',
      evidence: '此前的开局场景已经写完。',
      participantIds: [reimuId, marisaId],
      worldEventSequences: processedSequences,
    }],
  })
  for (let turn = 0; turn < 4; turn += 1) {
    const available = store.worldTurn(workspace.id)!
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: available.cycleId,
      actionId: 'roll',
    })
  }
  const pendingSequences = storyPendingWorldEvents(workspace).map(event => event.sequence)
  const projection = worlds.get(FLYING_CHESS_WORLD_MODULE_ID).projectNarrative(
    workspace.world!,
    pendingSequences,
    resolveStoryPlayWorldContext(workspace),
  )
  assert.equal(projection.cadence, 'transition')
  assert.equal(projection.cues.length, 0)
  assert.equal(projection.facts.every(fact => fact.retention === 'compressible'), true)
  assert.deepEqual(projection.facts.map(fact => fact.text), [
    '几轮过去，博丽灵梦与雾雨魔理沙的飞机都没有移动。',
  ])
  const hostDraft = projection.facts.map(fact => fact.text).join('')

  const verboseDraft = [
    '骰子先回到灵梦手里。她拢在掌心里停了一阵，才让它滚过棋盘。点数是—。基地里的木机没有动。',
    '魔理沙接过骰子，翻来覆去看了看，再把它丢回纸面。五点朝上。她低头看了一会儿。',
    '后面的两次投掷也被逐一铺开，窗边的光影跟着慢慢移动，棋盘仍旧安静。',
  ].join('\n\n')
  const compactDraft = '骰子又在两人手里走过两轮，红蓝两方仍没有木机离开基地。四次投掷过后，跑道依旧空着。'
  const session = Session.create(SessionId('compact-world-transition'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const fakeContext = (editedText: string, sectionText = verboseDraft): Context => ({
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
      stream(options: { readonly system?: string }) {
        const system = options.system ?? ''
        const text = system.includes('指定人物认知')
          ? JSON.stringify({ observation: '棋局继续。', action: '', speech: null, insights: [] })
          : system.includes('分区的 prose Worker')
            ? sectionText
            : system.includes('最终正文编辑 Worker')
              ? JSON.stringify({ sections: [{ sectionId: proseId, text: editedText }] })
              : JSON.stringify({ sections: [] })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  }) as unknown as Context
  const result = await runStoryTurnPipeline({
    ctx: fakeContext(compactDraft),
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    store,
    workspace,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })

  const stageRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data]
    : [])
  const sectionRequest = stageRequests.find(request => request.stage === 'section')
  const editorRequest = stageRequests.find(request => request.stage === 'editor')
  assert.equal(sectionRequest, undefined)
  assert.equal(editorRequest, undefined)
  assert.equal(result.finalDraft, hostDraft)
  assert.equal(result.hostOwnedWorldDraft, true)
  assert.match(result.modelContext, /<final_draft>/u)
  assert.doesNotMatch(result.modelContext, /分区写作与编辑/u)
  assert.doesNotMatch(result.finalDraft, /点数是—|\n\s*\n/u)

  const sourced = store.save({
    ...editable(store.get(workspace.id)),
    sources: [{
      id: createStorySourceId(),
      name: '原作对白',
      kind: 'original',
      enabled: true,
      content: '博丽灵梦与雾雨魔理沙在原作中交谈。',
    }],
  })
  const sourcedSession = Session.create(SessionId('compact-sourced-world-transition'))
  sourcedSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const sourcedResult = await runStoryTurnPipeline({
    ctx: fakeContext(compactDraft),
    agent: {
      id: sourcedSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: sourcedSession,
    } as Agent,
    store,
    workspace: sourced,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })
  const sourcedStages = sessionEvents(sourcedSession).flatMap(event =>
    event.type === 'agent-rp/story-stage-request' ? [event.data.stage] : [])
  assert.equal(sourcedStages.includes('research'), true)
  assert.equal(sourcedStages.includes('director'), true)
  assert.equal(sourcedStages.includes('section'), true)
  assert.equal(sourcedStages.includes('editor'), true)
  assert.equal(sourcedResult.finalDraft, compactDraft)
  assert.doesNotMatch(sourcedResult.finalDraft, /点数是—|\n\s*\n/u)

  const essentialRolls = [6, 6, 6, 6, 2, 1, 4]
  const essentialWorlds = new PlayWorldRegistry()
  essentialWorlds.register(createFlyingChessWorldModule({ rollDie: () => essentialRolls.shift()! }))
  const essentialRoot = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-essential-compact-world-transition-'))
  const essentialStore = new StoryWorkspaceStore({
    root: essentialRoot,
    worlds: essentialWorlds,
    resources: fixtureWorldResources(essentialWorlds),
  })
  context.after(() => { rmSync(essentialRoot, { recursive: true, force: true }) })
  const essentialCreated = essentialStore.create({ format: 2, name: '必要事实规则过渡' })
  const essentialConfigured = essentialStore.save({
    ...editable(essentialCreated),
    characters: [reimu, character(marisaId, '雾雨魔理沙', '住在魔法森林的人类魔法使。')],
    outputs: [{ id: proseId, name: '正文', kind: 'prose', enabled: true, instructions: '写成连续场景。' }],
    sources: [{
      id: createStorySourceId(),
      name: '原作对白',
      kind: 'original',
      enabled: true,
      content: '博丽灵梦与雾雨魔理沙在原作中交谈。',
    }],
  })
  let essentialWorkspace = essentialStore.installWorld(essentialConfigured.id, {
    format: 0,
    revision: essentialConfigured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  essentialWorkspace = essentialStore.updateWorldConfiguration(essentialWorkspace.id, {
    format: 0,
    revision: essentialWorkspace.revision,
    configuration: {},
  })
  const completeRoll = (): void => {
    const turn = essentialStore.worldTurn(essentialWorkspace.id)!
    essentialWorkspace = essentialStore.dispatchWorldAction(essentialWorkspace.id, {
      format: 0,
      revision: essentialWorkspace.revision,
      cycleId: turn.cycleId,
      actionId: 'roll',
    })
    const moveTurn = essentialStore.worldTurn(essentialWorkspace.id)!
    const move = moveTurn.actions.find(action => action.id.startsWith('move:'))
    if (move === undefined) return
    essentialWorkspace = essentialStore.dispatchWorldAction(essentialWorkspace.id, {
      format: 0,
      revision: essentialWorkspace.revision,
      cycleId: moveTurn.cycleId,
      actionId: move.id,
    })
  }
  for (let roll = 0; roll < 6; roll += 1) completeRoll()
  const priorEssentialSequences = essentialWorkspace.world!.events.map(event => event.sequence)
  essentialWorkspace = essentialStore.save({
    ...editable(essentialWorkspace),
    events: [{
      id: createStoryEventId(),
      key: 'essential-transition-prior',
      turn: 1,
      title: '此前棋局',
      summary: '棋子已经推进到航线末段。',
      evidence: '棋子已经推进到航线末段。',
      participantIds: [reimuId, marisaId],
      worldEventSequences: priorEssentialSequences,
    }],
  })
  completeRoll()
  const essentialPendingSequences = storyPendingWorldEvents(essentialWorkspace).map(event => event.sequence)
  const essentialProjection = essentialWorlds.get(FLYING_CHESS_WORLD_MODULE_ID).projectNarrative(
    essentialWorkspace.world!,
    essentialPendingSequences,
    resolveStoryPlayWorldContext(essentialWorkspace),
  )
  assert.equal(essentialProjection.cadence, 'transition')
  assert.equal(essentialProjection.cues.length, 0)
  assert.equal(essentialProjection.facts.some(fact => fact.retention === 'essential'), true)
  const essentialHostDraft = essentialProjection.facts.map(fact => fact.text).join('')
  const essentialVerboseDraft = `${essentialHostDraft}\n\n那张折签仍压在棋盘边缘，纸角被灯光照亮。`
  const essentialSession = Session.create(SessionId('compact-sourced-essential-world-transition'))
  essentialSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const essentialResult = await runStoryTurnPipeline({
    ctx: fakeContext(essentialVerboseDraft, essentialVerboseDraft),
    agent: {
      id: essentialSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: essentialSession,
    } as Agent,
    store: essentialStore,
    workspace: essentialWorkspace,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })
  const essentialStages = sessionEvents(essentialSession).flatMap(event =>
    event.type === 'agent-rp/story-stage-request' ? [event.data.stage] : [])
  assert.equal(essentialStages.includes('research'), true)
  assert.equal(essentialStages.includes('director'), true)
  assert.equal(essentialStages.includes('section'), true)
  assert.equal(essentialStages.includes('editor'), true)
  assert.equal(essentialResult.finalDraft, essentialHostDraft)
  assert.match(essentialResult.finalDraft, /4 点/u)
  assert.doesNotMatch(essentialResult.finalDraft, /折签|\n\s*\n/u)

  const dialogueSession = Session.create(SessionId('host-owned-world-transition-dialogue'))
  dialogueSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const dialogueContext = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        const seedId = body.match(/\[seed:([^\]]+)\]\[目标人物\]/u)?.[1] ?? ''
        let text: string
        if (system.includes('人物参与路由 Worker')) {
          text = JSON.stringify({ publicCharacterIds: [reimuId] })
        } else if (system.includes('指定人物认知')) {
          text = body.includes('# 人物：博丽灵梦')
            ? JSON.stringify({
                observation: '几轮过去，棋局仍在继续。',
                action: '',
                speech: {
                  respondsTo: '玩家问是否还要继续等。',
                  move: 'answer',
                  focus: '现在就继续。',
                  effect: '回答玩家并结束等待。',
                },
                opportunityDecisions: [],
                insights: [],
              })
            : JSON.stringify({ observation: '棋局仍在继续。', action: '', speech: null, opportunityDecisions: [], insights: [] })
        } else if (system.includes('人物自己的对白 Worker')) {
          text = JSON.stringify({ lines: [{
            reference: `speech:${proseId}:1`,
            move: 'answer',
            seedLineIds: [seedId],
            mechanics: '省略已知前提，直接反问',
            leftImplicit: '玩家刚才提出的等待选项。',
            dialogue: '“这还用等？”',
          }] })
        } else if (system.includes('对白审校 Worker')) {
          text = JSON.stringify({ lines: [{ reference: `speech:${proseId}:1`, dialogue: '这还用等？' }] })
        } else if (system.includes('分区的 prose Worker')) {
          text = JSON.stringify({ passages: [{
            sourceIds: [`world:${projection.facts[0]!.eventSequences.join('.')}`],
            text: hostDraft,
          }, {
            sourceIds: [`dialogue:speech:${proseId}:1`],
            text: '博丽灵梦说：“这还用等？”',
          }] })
        } else if (system.includes('最终正文编辑 Worker')) {
          text = JSON.stringify({ sections: [{ sectionId: proseId, passages: [{
            sourceIds: [`world:${projection.facts[0]!.eventSequences.join('.')}`],
            text: hostDraft,
          }, {
            sourceIds: [`dialogue:speech:${proseId}:1`],
            text: '博丽灵梦说：“这还用等？”',
          }] }] })
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
  const dialogueResult = await runStoryTurnPipeline({
    ctx: dialogueContext,
    agent: {
      id: dialogueSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: dialogueSession,
    } as Agent,
    store,
    workspace,
    turn: 6,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '请灵梦回答：还要继续等吗？' }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(dialogueResult.finalDraft, `${hostDraft}\n\n博丽灵梦说：“这还用等？”`)
  assert.equal(dialogueResult.hostOwnedWorldDraft, undefined)
  assert.deepEqual(sessionEvents(dialogueSession).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && (event.data.stage === 'section' || event.data.stage === 'editor') ? [event.data.stage] : []), ['section', 'editor'])
  assert.doesNotMatch(dialogueResult.finalDraft, /接过骰子|没人接话|折签仍|没有人动/u)

  const fragmentedSession = Session.create(SessionId('compact-world-transition-fragmented'))
  fragmentedSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const fragmentedDraft = '灵梦掷出二点。木机没动。魔理沙掷出五点。木机仍没动。灵梦又掷一点。魔理沙也掷一点。'
  const fragmentedResult = await runStoryTurnPipeline({
    ctx: fakeContext(compactDraft, fragmentedDraft),
    agent: {
      id: fragmentedSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: fragmentedSession,
    } as Agent,
    store,
    workspace,
    turn: 3,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(fragmentedResult.finalDraft, hostDraft)
  assert.equal(sessionEvents(fragmentedSession).some(event => event.type === 'agent-rp/story-stage-request'
    && (event.data.stage === 'section' || event.data.stage === 'editor')), false)

  const wrongHandoffSession = Session.create(SessionId('compact-world-transition-wrong-handoff'))
  wrongHandoffSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const wrongHandoffDraft = '几轮过后，红蓝两边的木机落在新的位置。骰子停到魔理沙手边，轮到她再掷。'
  const correctedHandoff = '几轮投掷很快过去，两边仍没有木机离开基地。跑道依旧空着。'
  const wrongHandoffResult = await runStoryTurnPipeline({
    ctx: fakeContext(correctedHandoff, wrongHandoffDraft),
    agent: {
      id: wrongHandoffSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: wrongHandoffSession,
    } as Agent,
    store,
    workspace,
    turn: 4,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(wrongHandoffResult.finalDraft, hostDraft)
  assert.doesNotMatch(wrongHandoffResult.finalDraft, /轮到她再掷/u)

  const unownedDetailSession = Session.create(SessionId('compact-world-transition-unowned-detail'))
  unownedDetailSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const unownedDetailDraft = '灵梦接过骰子掷出四点，木机继续前进。魔理沙盯着那架木机，指尖在桌沿轻轻叩了两下。棋盘边缘的折签又挪了挪。'
  const correctedUnownedDetail = '两轮投掷后，灵梦的木机沿航线继续前进；魔理沙的木机仍留在基地。'
  const unownedDetailResult = await runStoryTurnPipeline({
    ctx: fakeContext(correctedUnownedDetail, unownedDetailDraft),
    agent: {
      id: unownedDetailSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: unownedDetailSession,
    } as Agent,
    store,
    workspace,
    turn: 5,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(unownedDetailResult.finalDraft, hostDraft)
  assert.equal(sessionEvents(unownedDetailSession).some(event => event.type === 'agent-rp/story-stage-request'
    && (event.data.stage === 'section' || event.data.stage === 'editor')), false)
  assert.doesNotMatch(unownedDetailResult.finalDraft, /接过骰子|盯着|轻轻叩|折签又挪/u)

  const rejectedSession = Session.create(SessionId('compact-world-transition-rejected-editor'))
  rejectedSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 4_096 } },
  })
  const rejectedResult = await runStoryTurnPipeline({
    ctx: fakeContext(verboseDraft),
    agent: {
      id: rejectedSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: rejectedSession,
    } as Agent,
    store,
    workspace,
    turn: 3,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(rejectedResult.finalDraft, projection.facts.map(fact => fact.text).join(''))
  assert.doesNotMatch(rejectedResult.finalDraft, /点数是—|\n\s*\n/u)
})

test('compacts repeated routine moves to their first and final authoritative positions', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-compact-world-moves-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const rolls = [6, 2, 1, 3]
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => rolls.shift()! }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const created = store.create({ format: 2, name: '连续移动压缩' })
  const configured = store.save({
    ...editable(created),
    characters: [
      character(reimuId, '博丽灵梦', '博丽神社的巫女。'),
      character(marisaId, '雾雨魔理沙', '住在魔法森林的人类魔法使。'),
    ],
  })
  let workspace = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  for (let action = 0; action < 2; action += 1) {
    const available = store.worldTurn(workspace.id)!
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: available.cycleId,
      actionId: available.actions[0]!.id,
    })
  }
  workspace = store.save({
    ...editable(workspace),
    events: [{
      id: createStoryEventId(),
      key: 'turn:1',
      turn: 1,
      title: '第一架飞机起飞',
      summary: '此前的起飞场景已经写完。',
      evidence: '此前的起飞场景已经写完。',
      participantIds: [reimuId, marisaId],
      worldEventSequences: workspace.world!.events.map(event => event.sequence),
    }],
  })
  while (rolls.length > 0 || store.worldTurn(workspace.id)?.actions[0]?.id !== 'roll') {
    const available = store.worldTurn(workspace.id)!
    workspace = store.dispatchWorldAction(workspace.id, {
      format: 0,
      revision: workspace.revision,
      cycleId: available.cycleId,
      actionId: available.actions[0]!.id,
    })
  }
  const pendingSequences = storyPendingWorldEvents(workspace).map(event => event.sequence)
  const projection = worlds.get(FLYING_CHESS_WORLD_MODULE_ID).projectNarrative(
    workspace.world!,
    pendingSequences,
    resolveStoryPlayWorldContext(workspace),
  )

  assert.equal(projection.cadence, 'transition')
  assert.equal(projection.cues.length, 0)
  assert.deepEqual(projection.facts, [{
    eventSequences: pendingSequences,
    retention: 'compressible',
    text: '几轮下来，博丽灵梦的 1 号飞机从航线第 1 步推进到第 6 步。',
  }])
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
  const freshPrepared = createStoryWorkspaceSessionSeed(store, installed.id)
  const freshLaunchEvent = freshPrepared.seed[0]
  assert.equal(freshLaunchEvent?.type, 'agent-rp/story-workspace-selection')
  if (freshLaunchEvent?.type !== 'agent-rp/story-workspace-selection') {
    throw new Error('expected fresh story workspace launch')
  }
  assert.equal(freshLaunchEvent.data.continuity, undefined)
  const earlier = '不会被选中的较早正文。'
  const latest = `开头应被截掉：${'后续正文'.repeat(1_500)}`
  const launchReady = store.save({
    ...editable(installed),
    events: [
      {
        id: createStoryEventId(),
        key: 'migration-history',
        turn: 0,
        title: '迁移前历史',
        summary: earlier,
        evidence: earlier,
        participantIds: [first, second],
      },
      {
        id: createStoryEventId(),
        key: 'completed-turn',
        turn: 4,
        title: '上一幕末尾',
        summary: '上一回合已经完成。',
        evidence: latest,
        participantIds: [first, second],
      },
      {
        id: createStoryEventId(),
        key: 'empty-later-turn',
        turn: 5,
        title: '尚无公开正文',
        summary: '',
        evidence: '',
        participantIds: [first, second],
      },
    ],
  })
  const prepared = createStoryWorkspaceSessionSeed(store, launchReady.id)
  assert.equal(prepared.title, '场地')
  assert.equal(readSessionStoryWorkspaceId(prepared.seed), launchReady.id)
  assert.deepEqual(prepared.seed.map(event => event.type), [
    'agent-rp/story-workspace-selection',
    'turn/start',
    'turn/end',
  ])
  assert.equal(prepared.seed[0]?.ignorable, true)
  const launchEvent = prepared.seed[0]
  assert.equal(launchEvent?.type, 'agent-rp/story-workspace-selection')
  if (launchEvent?.type !== 'agent-rp/story-workspace-selection') throw new Error('expected story workspace launch')
  assert.deepEqual(launchEvent.data.continuity, {
    turn: 4,
    title: '上一幕末尾',
    text: latest.slice(-6_000),
    truncatedStart: true,
  })
  const launched = Session.create(SessionId('play-world-launch'), prepared.seed)
  assert.deepEqual(launched.deriveMessages(), [])
  assert.equal(sessionEvents(launched).findLast(event => event.type === 'turn/end')?.data.turn, 1)
  const renamed = store.save({ ...editable(launchReady), name: '新名称' })
  assert.deepEqual(renamed.world, launchReady.world)
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

test('advances executable worlds from the unified direction input unless the player pauses rules', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-free-story-world-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  let rolls = 0
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({
    rollDie: () => {
      rolls += 1
      return 1
    },
  }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '自由剧情不推进规则' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const configured = store.save({
    ...editable(created),
    characters: [
      character(reimuId, '博丽灵梦'),
      character(marisaId, '雾雨魔理沙'),
    ],
    outputs: [{
      id: proseId,
      name: '对局正文',
      kind: 'prose',
      enabled: true,
      instructions: '写出人物对异常事件的实际反应。',
    }],
    sources: [],
  })
  const installed = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  const worldBefore = structuredClone(installed.world)
  const session = Session.create(SessionId('free-story-world'))
  session.append('request/header', {
    reason: 'initial',
    header: {
      config: {
        provider: 'fixture',
        model: 'fixture',
        reasoningEffort: 'high' as never,
        maxTokens: 4_096,
      },
    },
  })
  const characterBodies: string[] = []
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
        if (system.includes('指定人物认知')) characterBodies.push(body)
        const text = system.includes('结构化世界行动 Worker')
          ? JSON.stringify({ actionId: 'roll' })
          : system.includes('人物参与路由 Worker')
            ? JSON.stringify({ publicCharacterIds: [reimuId, marisaId] })
          : system.includes('单个人物的历史检索 Worker')
            ? JSON.stringify({ references: [] })
            : system.includes('剧情研究 Worker')
              ? JSON.stringify({ findings: [], followUps: [] })
              : system.includes('指定人物认知')
                ? JSON.stringify(body.includes('验证 Host 拦截')
                  ? {
                      observation: '棋局仍在眼前。',
                      action: '灵梦的2号飞机绕场一周后落在第8步，又让3号机从起点滑出三格。',
                      speech: null,
                      insights: [],
                    }
                  : {
                      observation: '看见骰子在桌沿裂开一道缝。',
                      action: '暂停棋局并检查骰子。',
                      speech: null,
                      insights: [],
                    })
                : system.includes('剧情导演 Worker')
                  ? JSON.stringify({ sections: [{
                    sectionId: proseId,
                    beats: ['魔理沙拾起裂开的骰子，检查裂口并决定暂时停局。'],
                    speech: [],
                  }] })
                  : system.includes('分区的 prose Worker')
                    ? '魔理沙拾起裂开的骰子检查裂口。'
                    : system.includes('最终正文编辑 Worker')
                      ? JSON.stringify({ sections: [{ sectionId: proseId, text: '桌面仍和先前一样。' }] })
                      : JSON.stringify({ sections: [] })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const inputText = '骰子滚到桌沿，裂开一道缝。不要替人物规定台词；让她们各自决定反应。棋局规则状态不变。'
  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    store,
    workspace: installed,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: inputText }],
    })],
    signal: new AbortController().signal,
  })

  const stageRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data]
    : [])
  assert.equal(rolls, 0)
  assert.equal(stageRequests.some(request => request.stage === 'world-action'), false)
  assert.equal(stageRequests.filter(request => request.stage === 'character')
    .every(request => request.dispatch.reasoningEffort === 'high'), true)
  assert.equal(characterBodies.length, 2)
  assert.equal(characterBodies.every(body => body.includes(inputText)), true)
  assert.deepEqual(result.worldEventSequences, storyPendingWorldEvents(installed).map(event => event.sequence))
  assert.equal(result.finalDraft, '魔理沙拾起裂开的骰子检查裂口。')
  assert.equal(store.get(installed.id).revision, installed.revision)
  assert.deepEqual(store.get(installed.id).world, worldBefore)

  const directedSession = Session.create(SessionId('directed-story-world'))
  directedSession.append('request/header', {
    reason: 'initial',
    header: {
      config: {
        provider: 'fixture',
        model: 'fixture',
        reasoningEffort: 'high' as never,
        maxTokens: 4_096,
      },
    },
  })
  const directedInput = '先让场地继续推进四个合法棋局动作；不要为了凑对白让人物开口。'
  const directedResult = await runStoryTurnPipeline({
    ctx: fake,
    agent: {
      id: directedSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: directedSession,
    } as Agent,
    store,
    workspace: store.get(installed.id),
    turn: 3,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: directedInput }],
    })],
    signal: new AbortController().signal,
  })
  const rollsAfterDirectedInput = rolls
  assert.equal(rollsAfterDirectedInput > 0, true)
  assert.equal(sessionEvents(directedSession).some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'world-action'), true)
  assert.equal(sessionEvents(directedSession).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'character' ? [event.data] : [])
    .every(request => request.dispatch.reasoningEffort === 'low'), true)
  assert.equal((directedResult.worldEventSequences?.length ?? 0) > 0, true)
  assert.equal(store.get(installed.id).revision > installed.revision, true)

  const guardedSession = Session.create(SessionId('guarded-story-world'))
  guardedSession.append('request/header', {
    reason: 'initial',
    header: {
      config: {
        provider: 'fixture',
        model: 'fixture',
        reasoningEffort: 'high' as never,
        maxTokens: 4_096,
      },
    },
  })
  const guardedInput = '验证 Host 拦截：让人物观察棋盘；不要推进棋局，规则状态保持不变。'
  const guardedResult = await runStoryTurnPipeline({
    ctx: fake,
    agent: {
      id: guardedSession.id,
      options: { provider: 'fixture', model: 'fixture' },
      session: guardedSession,
    } as Agent,
    store,
    workspace: store.get(installed.id),
    turn: 4,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: guardedInput }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(sessionEvents(guardedSession).some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'world-action'), false)
  assert.equal(sessionEvents(guardedSession).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'character' ? [event.data] : [])
    .every(request => request.dispatch.reasoningEffort === 'high'), true)
  assert.doesNotMatch(guardedResult.finalDraft, /2号飞机|3号机|绕场|滑出三格/u)
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
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }] })],
    signal: new AbortController().signal,
  }
  appendAgentRpSessionEvent(session, 'agent-rp/story-turn-start', {
    format: 0,
    sessionId: String(session.id),
    workspaceId: installed.id,
    workspaceRevision: installed.revision,
    turn: 2,
    step: 1,
  })
  const advanced = await advanceStoryWorldByCharacter(input)
  const state = advanced.world?.state as FlyingChessWorldState
  assert.equal(bodies.length, 2)
  assert.match(bodies[0]!, /灵梦只知道自己的行动偏好/u)
  assert.doesNotMatch(bodies.join('\n'), /魔理沙藏着不应进入灵梦输入的秘密/u)
  assert.equal(state.turn, 2)
  assert.equal(state.currentPlayerId, reimuId)
  assert.equal(state.pieces.some(piece => piece.ownerId === reimuId && piece.status === 'track'), true)
  assert.deepEqual(advanced.worldActionReceipts?.map(receipt => receipt.sequence), [0, 1])
  assert.deepEqual(sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data.stage]
    : []), ['world-action', 'world-action'])

  await stopStoryTurnPipeline({
    ctx: fake,
    agent,
    workspaceId: installed.id,
    turn: 2,
    step: 1,
    outcome: 'aborted',
  })
  assert.equal(sessionEvents(session).findLast(event => event.type === 'agent-rp/story-turn-stopped')?.data.outcome, 'aborted')

  const replayed = await advanceStoryWorldByCharacter(input)
  assert.equal(replayed.revision, advanced.revision)
  assert.equal(bodies.length, 2)
})

test('writes a manually completed world result without persisting a character composite public recap', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-manual-world-result-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 6 }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const created = store.create({ format: 2, name: '手动规则结果' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const historyId = createStoryOutputId()
  const configured = store.save({
    ...editable(created),
    characters: [character(reimuId, '博丽灵梦'), character(marisaId, '雾雨魔理沙')],
    events: Array.from({ length: 10 }, (_, index) => ({
      id: createStoryEventId(),
      key: `manual-world-history-${String(index + 1)}`,
      turn: index + 1,
      title: `此前棋局 ${String(index + 1)}`,
      summary: `两人共同经历了此前棋局第 ${String(index + 1)} 回合。`,
      evidence: `此前棋局第 ${String(index + 1)} 回合已经结束。`,
      participantIds: [reimuId, marisaId],
    })),
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
  const rolled = store.dispatchWorldAction(withoutMap.id, {
    format: 0,
    revision: withoutMap.revision,
    cycleId: manualTurn!.cycleId,
    actionId: 'roll',
  })
  const moveTurn = store.worldTurn(rolled.id)
  const manuallyAdvanced = store.dispatchWorldAction(rolled.id, {
    format: 0,
    revision: rolled.revision,
    cycleId: moveTurn!.cycleId,
    actionId: moveTurn!.actions.find(action => action.id.startsWith('move:'))!.id,
  })
  const stateBeforeWriting = manuallyAdvanced.world?.state as FlyingChessWorldState
  assert.equal(stateBeforeWriting.currentPlayerId, reimuId)

  const session = Session.create(SessionId('manual-world-result'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', reasoningEffort: 'high' as never, maxTokens: 4_096 } },
  })
  const naturalWorldPassages = [{
    sourceIds: ['world:2.3'],
    text: '红方起跑线前依然空着。灵梦探身把骰子捞回来，这一次握在指间多停了片刻。她松手时，骰子滚过三格跑道，停在空地中央。六点朝上。她低头确认骰面，随后把手探进红方基地。四架木机中靠外的一架，翼根刻着“壹”。她把那架木机提出来，放上航线第一格。',
  }, {
    sourceIds: ['world:4'],
    text: '木机落定时，第一格下露出一张折签。折签背面画着问号，签文仍被棋盘遮住。',
  }]
  const naturalWorldScene = naturalWorldPassages.map(passage => passage.text).join('\n\n')
  const invalidEditorPassages = naturalWorldPassages.map((passage, index) => index === 0 ? passage : {
    ...passage,
    text: `${passage.text}灵梦问过以后，魔理沙没有回答。`,
  })
  const characterBodies: string[] = []
  let invalidSection = false
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
        const messageBody = JSON.stringify(options.messages ?? [])
        if (system.includes('指定人物认知')) characterBodies.push(messageBody)
        const text = system.includes('指定人物认知')
          ? messageBody.includes('# 人物：雾雨魔理沙')
            ? JSON.stringify({
                observation: '看见已结算结果。',
                action: '',
                speech: null,
                insights: [{
                  kind: 'knowledge',
                  text: '灵梦掷出 6 点，已将 1 号飞机推上航线第 1 步；我的四架飞机仍全在基地，目前只有她还走在航线上。',
                }],
              })
            : JSON.stringify({
                observation: '看见已结算结果。',
                action: '',
                speech: null,
                insights: [],
              })
          : system.includes('分区的 prose Worker')
            ? JSON.stringify({ passages: invalidSection
              ? [{
                  sourceIds: ['world:2.3', 'world:4'],
                  text: `${naturalWorldScene}\n\n骰子被推到魔理沙面前，魔理沙没有回答。`,
                }]
              : naturalWorldPassages })
            : system.includes('最终正文编辑 Worker')
              ? JSON.stringify({ sections: [{
                  sectionId: proseId,
                  passages: invalidEditorPassages,
                }, {
                  sectionId: historyId,
                  text: '错误的模型历史会被 Host 替换。',
                }] })
              : JSON.stringify({ sections: [] })
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
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })

  const stageRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data]
    : [])
  assert.equal(stageRequests.some(request => request.stage === 'world-action'), false)
  assert.deepEqual(stageRequests.flatMap(request => (
    request.stage === 'history' || request.stage === 'research' || request.stage === 'director'
      || request.stage === 'section' || request.stage === 'editor'
      ? [request.stage]
      : []
  )), ['section', 'editor'])
  assert.deepEqual(stageRequests.filter(request => request.stage === 'character').map(request => request.subjectId), [reimuId, marisaId])
  assert.equal(stageRequests.filter(request => request.stage === 'character')
    .every(request => request.dispatch.reasoningEffort === 'low' && request.dispatch.maxTokens === 4_096), true)
  assert.equal(stageRequests.find(request => request.stage === 'section')?.dispatch.reasoningEffort, 'low')
  assert.equal(stageRequests.find(request => request.stage === 'editor')?.dispatch.reasoningEffort, 'low')
  const proseDispatch = JSON.stringify(stageRequests.find(request => request.stage === 'section')?.dispatch)
  const editorDispatch = JSON.stringify(stageRequests.find(request => request.stage === 'editor')?.dispatch)
  assert.match(proseDispatch, /每个 sourceId 只能用于一个 passage/u)
  assert.match(editorDispatch, /没有获准对白或附加人物行动不是把 scene 压成一个自然段的理由/u)
  for (const dispatch of [proseDispatch, editorDispatch]) {
    assert.match(dispatch, /<recent_public_prose>/u)
    assert.match(dispatch, /此前棋局第 8 回合已经结束/u)
    assert.match(dispatch, /此前棋局第 10 回合已经结束/u)
    assert.doesNotMatch(dispatch, /此前棋局第 7 回合已经结束/u)
  }
  const brief = sessionEvents(session).findLast(event => event.type === 'agent-rp/story-turn-brief')
  assert.equal(brief?.data.publicDialogues, undefined)
  assert.equal(brief?.data.privateCharacterStates, undefined)
  assert.match(characterBodies.join('\n'), /共同经历了此前棋局第 10 回合/u)
  assert.doesNotMatch(characterBodies.join('\n'), /共同经历了此前棋局第 1 回合/u)
  assert.match(JSON.stringify(stageRequests.find(request => request.stage === 'character'
    && request.subjectId === reimuId)?.dispatch), /thisCharacterRole=actor/u)
  assert.match(JSON.stringify(stageRequests.find(request => request.stage === 'character'
    && request.subjectId === marisaId)?.dispatch), /thisCharacterRole=observer/u)
  assert.equal(result.finalDraft, naturalWorldScene)
  assert.deepEqual(result.finalSections.find(section => section.sectionId === proseId)?.sourcePassages, naturalWorldPassages)
  assert.doesNotMatch(result.finalDraft, /没有回答/u)
  assert.doesNotMatch(result.finalDraft, /博丽灵梦掷出的骰子停在 6 点，随后把 1 号飞机推进到航线第 1 步/u)
  assert.equal(result.hostOwnedWorldDraft, undefined)
  assert.deepEqual(result.publicWorldEvents?.slice(0, 3).map(event => event.type), ['game.started', 'die.rolled', 'piece.moved'])
  assert.equal(manuallyAdvanced.world?.events.findLast(event => event.type === 'piece.moved')?.summary, '飞机前进到航线第 1 步。')
  assert.equal(store.get(manuallyAdvanced.id).revision, manuallyAdvanced.revision)
  assert.equal((store.get(manuallyAdvanced.id).world?.state as FlyingChessWorldState).currentPlayerId, reimuId)

  invalidSection = true
  const rejectedSession = Session.create(SessionId('manual-world-result-rejected-source'))
  rejectedSession.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', reasoningEffort: 'high' as never, maxTokens: 4_096 } },
  })
  const rejected = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: rejectedSession.id, options: { provider: 'fixture', model: 'fixture' }, session: rejectedSession } as Agent,
    store,
    workspace: manuallyAdvanced,
    turn: 3,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(rejected.hostOwnedWorldDraft, undefined)
  assert.deepEqual(rejected.finalSections.find(section => section.sectionId === proseId)?.sourcePassages
    ?.map(passage => passage.sourceIds), [['world:1'], ['world:2.3'], ['world:4']])
  assert.doesNotMatch(rejected.finalDraft, /推到魔理沙面前|没有回答/u)
  assert.equal(sessionEvents(rejectedSession).some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'editor'), true)

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
  assert.deepEqual(materialized?.changes.facts, [])
  assert.equal(materialized?.continuityResultEventSeq, undefined)
  assert.doesNotMatch(
    compileStoryCharacterContext(store.get(installed.id), marisaId, { playerInput: '继续。' }).privateKnowledge,
    /灵梦掷出 6 点|我的四架飞机/u,
  )
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
        ? {
            ...node,
            content: '按照大纲完整呈现这次无法起飞以及人物对结果的留意。',
            participantIds: [marisaId, sanaeId],
          }
        : node),
    },
  })
  const manualTurn = store.worldTurn(installed.id)
  const manuallyAdvanced = store.dispatchWorldAction(installed.id, {
    format: 0,
    revision: installed.revision,
    cycleId: manualTurn!.cycleId,
    actionId: 'roll',
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
                    kind: 'knowledge',
                    text: '博丽灵梦本轮掷出 1 点，未达到起飞点数。',
                  }, {
                    kind: 'decision',
                    text: '这局前几手全是小点，飞机全压在基地里，灵梦打算先按兵不动。',
                    futureChoice: '遇到不利结果时，仍会接受结算并继续这局。',
                  }, {
                    kind: 'intention',
                    text: '灵梦想继续完成棋局。',
                    futureChoice: '下一回合掷骰。',
                  }]
                  : [],
              })
              : system.includes('剧情导演 Worker')
                ? JSON.stringify({ sections: [
                  { sectionId: proseId, beats: ['表现刚发生的掷骰结果。'], speech: [] },
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
                  ? '骰子滚过棋盘，在一点上停住；灵梦的四架飞机仍排在基地里。'
                  : system.includes('分区的 character Worker')
                    ? JSON.stringify({ insights: [{ kind: 'world-action', text: '魔理沙准备在下一回合掷骰。' }] })
                    : system.includes('最终正文编辑 Worker')
                      ? JSON.stringify({ sections: [
                        { sectionId: proseId, text: '骰子滚过棋盘，在一点上停住；灵梦的四架飞机仍排在基地里。' },
                      ] })
                      : '不应成为可见正文。'
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
      content: [{ type: 'text', text: '请让当前人物继续，并让魔理沙留意结果。' }],
    })],
    signal: new AbortController().signal,
  })

  const researchDispatch = JSON.stringify(sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'research' ? [event.data.dispatch] : []).at(0))
  assert.match(researchDispatch, /story:current-world-state/u)
  assert.match(researchDispatch, /当前第 2 回合，轮到 雾雨魔理沙/u)
  assert.match(researchDispatch, /story:current-world-outcome/u)
  assert.match(researchDispatch, /博丽灵梦掷出 1：第 1 回合掷骰结果为 1/u)
  assert.match(researchDispatch, /story:world-turn-transition/u)
  assert.match(researchDispatch, /实际行动人物：博丽灵梦/u)
  assert.match(researchDispatch, /下一行动者与玩家输入点名的刚完成行动者不同不是冲突/u)
  assert.match(researchDispatch, /历史中的较早状态不能覆盖当前状态/u)
  const stageRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data] : [])
  assert.equal(stageRequests.some(request => request.stage === 'world-action'), false)
  assert.equal(stageRequests.find(request => request.stage === 'cast')?.dispatch.reasoningEffort, 'off')
  assert.equal(stageRequests.find(request => request.stage === 'research')?.dispatch.reasoningEffort, 'low')
  assert.equal(stageRequests.find(request => request.stage === 'section')?.dispatch.reasoningEffort, 'low')
  assert.equal(stageRequests.find(request => request.stage === 'editor')?.dispatch.reasoningEffort, 'low')
  const characterRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'character' ? [event.data] : [])
  const reimuRequest = characterRequests.find(request => request.subjectId === reimuId)
  const marisaRequest = characterRequests.find(request => request.subjectId === marisaId)
  const sanaeRequest = characterRequests.find(request => request.subjectId === sanaeId)
  assert.match(JSON.stringify(reimuRequest?.dispatch), /thisCharacterRole=actor/u)
  assert.match(JSON.stringify(reimuRequest?.dispatch.messages), /publicResponse=allowed/u)
  assert.match(JSON.stringify(marisaRequest?.dispatch), /thisCharacterRole=observer/u)
  assert.match(JSON.stringify(marisaRequest?.dispatch.messages), /publicResponse=observe-only/u)
  assert.match(JSON.stringify(sanaeRequest?.dispatch), /thisCharacterRole=observer/u)
  assert.match(JSON.stringify(sanaeRequest?.dispatch.messages), /publicResponse=observe-only/u)
  assert.deepEqual(result.worldEventSequences, [1, 2, 3])
  assert.equal(result.hostOnlyWorldDraft, undefined)
  assert.doesNotMatch(result.directorBrief, /表现刚发生的掷骰结果/u)
  assert.doesNotMatch(result.finalDraft, /## 对局正文|没有可移动的飞机|灵梦视角/u)
  assert.equal(result.finalDraft, '骰子滚过棋盘，在一点上停住；灵梦的四架飞机仍排在基地里。')
  assert.deepEqual(result.publicWorldEvents?.map(event => event.type), ['game.started', 'die.rolled', 'turn.passed'])
  assert.deepEqual(result.privateCharacterStates, [{
    characterId: reimuId,
    insights: [{ kind: 'decision', text: '遇到不利结果时，仍会接受结算并继续这局。' }],
  }])
  assert.equal(result.deterministicWorldMaterialization, true)
  assert.doesNotMatch(result.finalDraft, /前几手全是小点|飞机全压在基地|错误记录|魔理沙视角|下一回合掷骰/u)
  assert.deepEqual(sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'section' ? [event.data.subjectId] : []), [proseId])
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
  const continuityRequest = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'continuity' ? [event.data] : []).at(-1)
  assert.equal(continuityRequest, undefined)
  assert.deepEqual(materialized?.changes.characters, [])
  assert.equal(store.get(installed.id).characters.find(character => character.id === reimuId)?.state.objective, '')
  assert.equal(store.get(installed.id).characters.find(character => character.id === marisaId)?.state.objective, '')
  assert.deepEqual(materialized?.changes.facts, [{
    text: '遇到不利结果时，仍会接受结算并继续这局。',
    knownBy: [reimuId],
  }])
  assert.deepEqual(materialized?.changes.nodes, [])
  assert.deepEqual(materialized?.changes.edges, [])
  assert.equal(materialized?.continuityResultEventSeq, undefined)
  assert.match(materialized?.eventSummary ?? '', /博丽灵梦掷出 1/u)
  assert.doesNotMatch(materialized?.eventSummary ?? '', /错误的模型概括/u)
  assert.deepEqual(store.get(installed.id).events.at(-1)?.worldEventSequences, [1, 2, 3])
  assert.deepEqual(store.get(installed.id).characters.map(item => item.state), [
    { location: '', condition: '', objective: '', notes: '' },
    { location: '', condition: '', objective: '', notes: '' },
    { location: '', condition: '', objective: '', notes: '' },
  ])
  const saved = store.get(installed.id)
  assert.match(compileStoryCharacterContext(saved, reimuId, { playerInput: '继续。' }).privateKnowledge, /遇到不利结果时/u)
  assert.doesNotMatch(compileStoryCharacterContext(saved, reimuId, { playerInput: '继续。' }).privateKnowledge, /前几手全是小点|飞机全压在基地/u)
  assert.doesNotMatch(compileStoryCharacterContext(saved, marisaId, { playerInput: '继续。' }).privateKnowledge, /遇到不利结果时/u)
  assert.equal(sessionEvents(session).some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'continuity'), false)
})

test('prioritizes an open exchange responder over a new automatic world reaction', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-open-exchange-response-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 1 }))
  const store = new StoryWorkspaceStore({ root, worlds, resources: fixtureWorldResources(worlds) })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const created = store.create({ format: 2, name: '开放话轮优先级' })
  const reimu = character(reimuId, '博丽灵梦')
  const configured = store.save({
    ...editable(created),
    characters: [{
      ...reimu,
      profile: { ...reimu.profile, exampleDialogue: '博丽灵梦：“这还用问？”' },
    }, character(marisaId, '雾雨魔理沙')],
    outputs: [{ id: proseId, name: '正文', kind: 'prose', enabled: true, instructions: '写成连续场景。' }],
  })
  const installed = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    resource: { kind: 'world', id: FLYING_CHESS_WORLD_RESOURCE_ID },
    cast: [],
  })
  const session = Session.create(SessionId('open-exchange-response-priority'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const question = '“你打算在基地里待到什么时候啊？”'
  appendAgentRpSessionEvent(session, 'agent-rp/story-turn-brief', {
    format: 1,
    sessionId: String(session.id),
    workspaceId: installed.id,
    workspaceRevision: installed.revision,
    turn: 1,
    step: 1,
    resultEventSeqs: [],
    directorBrief: '',
    finalSections: [],
    finalDraft: question,
    modelContext: '',
    publicDialogues: [{
      characterId: marisaId,
      targetCharacterId: reimuId,
      dialogue: question,
      move: 'question',
    }],
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: `雾雨魔理沙说：${question}` }],
    }),
  }, { surfaceOp: 'append' })
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  const answer = '“骰子不给六，我能怎么办？”'
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      async resolveModelInfo(provider: string, model: string) {
        return {
          provider,
          id: model,
          name: model,
          reasoning: { efforts: [{ id: 'off', name: 'Off' }], defaultEffort: 'off' },
        }
      },
      stream(options: { readonly system?: string; readonly messages?: readonly unknown[] }) {
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages ?? [])
        const referenceMatch = body.match(/\[speech:([^\]]+)\]/u)
        const reference = referenceMatch === null ? `speech:${proseId}:1` : `speech:${referenceMatch[1]}`
        const seedId = body.match(/\[seed:([^\]]+)\]\[目标人物\]/u)?.[1]
        let text: string
        if (system.includes('结构化世界行动 Worker')) {
          text = JSON.stringify({ actionId: 'roll' })
        } else if (system.includes('单个人物的历史检索 Worker')) {
          text = JSON.stringify({ references: [] })
        } else if (system.includes('指定人物认知')) {
          text = body.includes('# 人物：博丽灵梦')
            ? JSON.stringify({
                observation: '魔理沙刚问自己打算在基地里待到什么时候。',
                action: '',
                speech: {
                  respondsTo: `魔理沙问灵梦：${question}`,
                  move: 'answer',
                  focus: '没有掷出六点就不能起飞。',
                  effect: '直接回答魔理沙的问题。',
                },
                opportunityDecisions: [],
                insights: [],
              })
            : JSON.stringify({
                observation: '一阵风掀起棋盘一角，基地里的木机随之晃动。',
                action: '',
                speech: {
                  respondsTo: '一阵风忽然掀起棋盘一角，基地里的木机随之晃动。',
                  move: 'inform',
                  focus: '先把棋盘压稳。',
                  effect: '让两人先处理棋盘。',
                },
                opportunityDecisions: [],
                insights: [],
              })
        } else if (system.includes('人物自己的对白 Worker')) {
          text = JSON.stringify({ lines: [{
            reference,
            move: 'answer',
            seedLineIds: seedId === undefined ? [] : [seedId],
            mechanics: '用反问直接收束对方的问题',
            leftImplicit: '只有六点才能起飞。',
            dialogue: answer,
          }] })
        } else if (system.includes('严格对白审校 Worker')) {
          text = JSON.stringify({ lines: [{ reference, dialogue: answer }] })
        } else if (system.includes('分区的 prose Worker')) {
          text = '<omit-section />'
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
  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    store,
    workspace: installed,
    turn: 2,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }],
    })],
    signal: new AbortController().signal,
  })

  assert.deepEqual(result.publicDialogues?.map(dialogue => ({
    characterId: dialogue.characterId,
    dialogue: dialogue.dialogue,
    move: dialogue.move,
  })), [{ characterId: reimuId, dialogue: answer, move: 'answer' }])
  const stageRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data]
    : [])
  const characterBodies = stageRequests.filter(request => request.stage === 'character')
    .map(request => JSON.stringify(request.dispatch.messages))
  assert.match(characterBodies.find(body => body.includes('# 人物：博丽灵梦')) ?? '', /status=open/u)
  assert.match(characterBodies.find(body => body.includes('# 人物：雾雨魔理沙')) ?? '', /status=closed/u)
  assert.deepEqual(stageRequests.filter(request => request.stage === 'voice')
    .map(request => request.subjectId?.split(':').slice(0, 2).join(':'))
    .filter((value, index, values) => values.indexOf(value) === index), [`draft:${reimuId}`, `review:${reimuId}`])
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
        } else if (system.includes('分区的 prose Worker')) {
          const dialogue = body.includes('都被你接到一块了')
            ? '“都被你接到一块了，怎么反倒来问我？”'
            : '“你自己把两句话接在一起，还问我是哪句？”'
          const prose = `灵梦答道：${dialogue}`
          text = system.includes('每个 sourceId 只能用于一个 passage')
            ? JSON.stringify({ passages: [{
                sourceIds: [`dialogue:speech:${proseId}:1`],
                text: prose,
              }] })
            : prose
        } else if (system.includes('最终正文编辑 Worker')) {
          const dialogue = body.includes('都被你接到一块了')
            ? '“都被你接到一块了，怎么反倒来问我？”'
            : '“你自己把两句话接在一起，还问我是哪句？”'
          const prose = `灵梦答道：${dialogue}`
          text = system.includes('带 sourcePassages 的 prose')
            ? JSON.stringify({ sections: [{
                sectionId: proseId,
                passages: [{ sourceIds: [`dialogue:speech:${proseId}:1`], text: prose }],
              }] })
            : JSON.stringify({ sections: [{ sectionId: proseId, text: prose }] })
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
  assert.equal(result.hostOwnedWorldDraft, undefined)
  assert.deepEqual(result.publicDialogues, [{
    characterId: reimuId,
    dialogue: '“你自己把两句话接在一起，还问我是哪句？”',
    move: 'answer',
  }])
  const stageRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data]
    : [])
  assert.equal(stageRequests.some(request => request.stage === 'world-action'), false)
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
      : []), ['section', 'editor'])
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
  assert.deepEqual(materialized?.changes.facts, [])
  const saved = store.get(installed.id)
  assert.doesNotMatch(compileStoryCharacterContext(saved, reimuId, { playerInput: '继续。' }).privateKnowledge, /博丽灵梦说/u)
  assert.doesNotMatch(compileStoryCharacterContext(saved, marisaId, { playerInput: '继续。' }).privateKnowledge, /博丽灵梦说/u)
  assert.match(saved.events.at(-1)?.summary ?? '', /博丽灵梦说：“你自己把两句话接在一起，还问我是哪句？”/u)
  assert.equal(sessionEvents(session).some(event => event.type === 'agent-rp/story-stage-request'
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
  const sourcedStageRequests = sessionEvents(sourcedSession).flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data]
    : [])
  const sourcedBrief = sessionEvents(sourcedSession).findLast(event => event.type === 'agent-rp/story-turn-brief')?.data
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
  const constrainedTurn = store.worldTurn(constrainedWorkspace.id)
  const constrainedWorldResult = store.dispatchWorldAction(constrainedWorkspace.id, {
    format: 0,
    revision: constrainedWorkspace.revision,
    cycleId: constrainedTurn!.cycleId,
    actionId: 'roll',
  })
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
    workspace: constrainedWorldResult,
    turn: 4,
    step: 1,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '只评价规则结果；不要复述棋局事实。' }],
    })],
    signal: new AbortController().signal,
  })
  assert.equal(constrainedResult.publicDialogues?.length ?? 0, 0)
  assert.equal(sessionEvents(constrainedSession).some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'voice'), false)
})
