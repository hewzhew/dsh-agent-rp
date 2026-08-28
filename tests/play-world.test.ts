import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createFlyingChessWorldModule } from '../src/flying-chess-world.ts'
import { FLYING_CHESS_WORLD_MODULE_ID, type FlyingChessWorldState } from '../src/flying-chess-protocol.ts'
import { PlayWorldRegistry } from '../src/play-world.ts'
import { parseAgentRpSessionLaunchRequest } from '../src/session-launch.ts'
import { createStoryWorkspaceSessionSeed, readSessionStoryWorkspaceId } from '../src/session-story-workspace.ts'
import { acceptStorySuggestionBatch } from '../src/story-suggestion-batch.ts'
import { advanceStoryWorldByCharacter, materializeStoryTurn, runStoryTurnPipeline } from '../src/story-turn-pipeline.ts'
import type { StoryCharacter, StoryWorkspaceSaveRequest, StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import {
  compileStoryCharacterContext,
  compileStoryDirectorWorldContext,
  createStoryCharacterId,
  createStoryNodeId,
  createStoryOutputId,
  StoryWorkspaceStore,
} from '../src/story-workspace.ts'
import { installIgnorableSessionEventFixture } from './session-event-fixture.ts'

installIgnorableSessionEventFixture()

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

test('advances a host-owned flying-chess world only through typed actions', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-play-world-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const rolls = [6, 1]
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => rolls.shift() ?? 1 }))
  const store = new StoryWorkspaceStore({ root, worlds })
  const created = store.create({ format: 2, name: '博丽神社飞行棋' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const activeNodeId = createStoryNodeId()
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
  })

  const installed = store.installWorld(withCharacters.id, {
    format: 0,
    revision: withCharacters.revision,
    moduleId: FLYING_CHESS_WORLD_MODULE_ID,
  })
  const initial = installed.world?.state as FlyingChessWorldState
  assert.equal(initial.currentPlayerId, reimuId)
  assert.equal(initial.pieces.length, 8)
  assert.equal(installed.world?.events[0]?.type, 'game.started')
  assert.throws(() => worlds.get(FLYING_CHESS_WORLD_MODULE_ID).normalize({
    ...installed.world,
    state: { ...initial, pendingRoll: { playerId: reimuId, value: 1, legalPieceIds: [] } },
  }, { characters: withCharacters.characters }), /合法棋子集合无效/u)

  const initialTurn = worlds.get(FLYING_CHESS_WORLD_MODULE_ID).characterTurn(installed.world!, { characters: installed.characters })
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

  const moveTurn = worlds.get(FLYING_CHESS_WORLD_MODULE_ID).characterTurn(rolled.world!, { characters: rolled.characters })
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
    { characters: moved.characters },
  ), '博丽灵梦掷出 6。博丽灵梦把 1 号飞机推进到航线第 1 步。')

  const rolledAgain = store.dispatchWorldAction(moved.id, {
    format: 0,
    revision: moved.revision,
    action: { type: 'roll', actorId: reimuId },
  })
  const secondPending = rolledAgain.world?.state as FlyingChessWorldState
  assert.equal(secondPending.pendingRoll?.value, 1)
  const movedAgain = store.dispatchWorldAction(rolledAgain.id, {
    format: 0,
    revision: rolledAgain.revision,
    action: { type: 'move', actorId: reimuId, pieceId },
  })
  const finalState = movedAgain.world?.state as FlyingChessWorldState
  assert.equal(finalState.pieces.find(piece => piece.id === pieceId)?.steps, 2)
  assert.equal(finalState.currentPlayerId, marisaId)
  assert.throws(() => store.dispatchWorldAction(movedAgain.id, {
    format: 0,
    revision: rolledAgain.revision,
    action: { type: 'roll', actorId: marisaId },
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
  const withAcceptedDirection = store.save({ ...editable(firstTurn), graph: accepted.graph })
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
  assert.equal(restarted.facts.some(fact => fact.source.kind === 'event'), false)
  assert.deepEqual(restarted.characters.map(item => item.state), [
    { location: '', condition: '', objective: '', notes: '' },
    { location: '', condition: '', objective: '', notes: '' },
  ])
  assert.equal(restarted.graph.nodes.some(node => node.title === '尚未接受的剧情方向'), false)
  assert.equal(restarted.graph.nodes.some(node => node.title === '已接受的剧情方向'), true)
  assert.equal(restarted.graph.nodes.find(node => node.title === '已接受的剧情方向')?.sourceEventId, undefined)
})

test('keeps executable world state out of whole-workspace edits', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-play-world-save-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '场地' })
  const first = createStoryCharacterId()
  const second = createStoryCharacterId()
  const withCharacters = store.save({
    ...editable(created),
    characters: [
      character(first, '甲'),
      character(second, '乙'),
    ],
  })
  const installed = store.installWorld(withCharacters.id, {
    format: 0,
    revision: withCharacters.revision,
    moduleId: FLYING_CHESS_WORLD_MODULE_ID,
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
  const launched = Session.create(SessionId('play-world-launch'), prepared.seed)
  assert.deepEqual(launched.deriveMessages(), [])
  assert.equal(launched.events.findLast(event => event.type === 'turn/end')?.data.turn, 1)
  const renamed = store.save({ ...editable(installed), name: '新名称' })
  assert.deepEqual(renamed.world, installed.world)
  const bound = store.bindCharacterActor(renamed.id, {
    format: 0,
    revision: renamed.revision,
    characterId: first,
    actor: { kind: 'actor', id: 'actor:reimu' },
  }, { name: '博丽灵梦', profile: character(first, '博丽灵梦', '博丽神社的巫女。').profile })
  assert.equal(bound.characters[0]?.actor?.id, 'actor:reimu')
  const detached = store.bindCharacterActor(bound.id, {
    format: 0,
    revision: bound.revision,
    characterId: first,
  })
  assert.equal(detached.characters[0]?.actor, undefined)
  assert.equal(detached.characters[0]?.name, '博丽灵梦')
  assert.equal(detached.characters[0]?.profile.description, '博丽神社的巫女。')
  assert.deepEqual(detached.world, installed.world)
})

test('lets the current private character Worker complete one world turn exactly once', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-character-world-action-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 6 }))
  const store = new StoryWorkspaceStore({ root, worlds })
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
    moduleId: FLYING_CHESS_WORLD_MODULE_ID,
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

test('keeps the exact world outcome while preserving only private-section character state', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-grounded-world-turn-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 1 }))
  const store = new StoryWorkspaceStore({ root, worlds })
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
  const installed = store.installWorld(configured.id, {
    format: 0,
    revision: configured.revision,
    moduleId: FLYING_CHESS_WORLD_MODULE_ID,
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
                voiceEvidence: [],
                insights: body.includes('# 人物：博丽灵梦')
                  ? [{ kind: 'decision', text: '灵梦决定继续当前棋局，不再要求作废已结算回合。' }]
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
                      facts: [], nodes: [], edges: [],
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
  assert.deepEqual(result.worldEventSequences, [2, 3])
  assert.equal(result.hostOnlyWorldDraft, undefined)
  assert.match(result.finalDraft, /## 对局正文\s+博丽灵梦掷出 1。博丽灵梦没有可移动的飞机，本回合结束。/u)
  assert.equal(result.finalDraft.match(/博丽灵梦没有可移动的飞机，本回合结束。/gu)?.length, 1)
  assert.ok(result.finalDraft.indexOf('## 对局正文') < result.finalDraft.indexOf('## 公开回合记录'))
  assert.match(result.finalDraft, /博丽灵梦掷出 1：第 1 回合掷骰结果为 1/u)
  assert.match(result.finalDraft, /没有可移动的飞机：博丽灵梦结束本回合/u)
  assert.match(result.finalDraft, /## 灵梦视角[\s\S]*继续当前棋局/u)
  assert.doesNotMatch(result.finalDraft, /错误记录|魔理沙视角|下一回合掷骰/u)
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
    text: '灵梦决定继续当前棋局，不再要求作废已结算回合。',
    knownBy: [reimuId],
  }])
  assert.deepEqual(materialized?.changes.nodes, [])
  assert.deepEqual(materialized?.changes.edges, [])
  assert.equal(typeof materialized?.continuityResultEventSeq, 'number')
  assert.match(materialized?.eventSummary ?? '', /博丽灵梦掷出 1/u)
  assert.doesNotMatch(materialized?.eventSummary ?? '', /错误的模型概括/u)
  assert.deepEqual(store.get(installed.id).events.at(-1)?.worldEventSequences, [2, 3])
  assert.deepEqual(store.get(installed.id).characters.map(item => item.state), [
    { location: '', condition: '', objective: '继续当前棋局', notes: '' },
    { location: '', condition: '', objective: '', notes: '' },
    { location: '', condition: '', objective: '', notes: '' },
  ])
  const saved = store.get(installed.id)
  assert.match(compileStoryCharacterContext(saved, reimuId, { playerInput: '继续。' }).privateKnowledge, /不再要求作废/u)
  assert.doesNotMatch(compileStoryCharacterContext(saved, marisaId, { playerInput: '继续。' }).privateKnowledge, /不再要求作废/u)
  assert.equal(session.events.some(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'continuity'), true)
})

test('assembles a grounded world result and approved dialogue without unowned model stages', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-host-world-dialogue-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const worlds = new PlayWorldRegistry()
  worlds.register(createFlyingChessWorldModule({ rollDie: () => 1 }))
  const store = new StoryWorkspaceStore({ root, worlds })
  const created = store.create({ format: 2, name: '权威世界对白' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const proseId = createStoryOutputId()
  const historyId = createStoryOutputId()
  const reimu = character(reimuId, '博丽灵梦')
  const marisa = character(marisaId, '雾雨魔理沙')
  const configured = store.save({
    ...editable(created),
    characters: [
      {
        ...reimu,
        profile: { ...reimu.profile, exampleDialogue: '灵梦：“你自己说过的话，还要问我？”' },
      },
      {
        ...marisa,
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
    moduleId: FLYING_CHESS_WORLD_MODULE_ID,
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
              { id: 'none', name: 'None' },
              { id: 'minimal', name: 'Minimal' },
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
        let text: string
        if (system.includes('结构化世界行动 Worker')) {
          text = JSON.stringify({ actionId: 'roll' })
        } else if (system.includes('人物参与路由 Worker')) {
          text = JSON.stringify({ publicCharacterIds: [reimuId] })
        } else if (system.includes('剧情研究 Worker')) {
          text = JSON.stringify({ findings: [], followUps: [] })
        } else if (system.includes('指定人物认知')) {
          text = body.includes('# 人物：博丽灵梦')
            ? JSON.stringify({
              observation: '听见魔理沙追问。',
              action: '',
              speech: {
                respondsTo: '魔理沙追问她指的是哪句话。',
                move: 'answer',
                content: '指出是魔理沙自己把两个判断接在了一起。',
              },
              voiceEvidence: [`character:${reimuId}:example-dialogue`],
              insights: [],
            })
            : JSON.stringify({
              observation: '灵梦刚完成本轮。',
              action: '抢在灵梦之前追问。',
              speech: {
                respondsTo: '灵梦刚完成本轮。',
                move: 'question',
                content: '追问灵梦为什么不继续说明。',
              },
              voiceEvidence: [`character:${marisaId}:example-dialogue`],
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
            dialogue: '“你自己把两句话接在一起，还问我是哪句？”',
          }] })
        } else if (system.includes('对白审校 Worker')) {
          text = JSON.stringify({ lines: [{ reference: `speech:${proseId}:1`, dialogue: '你自己把两句话接在一起，还问我是哪句？' }] })
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
      content: [{ type: 'text', text: '魔理沙追问灵梦指的是哪句话，请让灵梦回答。' }],
    })],
    signal: new AbortController().signal,
  })

  assert.match(result.finalDraft, /博丽灵梦掷出 1。博丽灵梦没有可移动的飞机，本回合结束。/u)
  assert.match(result.finalDraft, /“你自己把两句话接在一起，还问我是哪句？”/u)
  assert.match(result.finalDraft, /## 公开回合记录/u)
  assert.equal(result.hostOnlyWorldDraft, undefined)
  assert.equal(result.hostOwnedWorldDraft, true)
  assert.deepEqual(result.publicDialogues, [{
    characterId: reimuId,
    dialogue: '“你自己把两句话接在一起，还问我是哪句？”',
  }])
  const stageRequests = session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [event.data]
    : [])
  assert.equal(stageRequests.every(request => request.dispatch.reasoningEffort === 'high'), true)
  assert.equal(stageRequests.some(request => request.stage === 'cast'), true)
  const characterRequests = stageRequests.filter(request => request.stage === 'character')
  assert.match(JSON.stringify(characterRequests.find(request => request.subjectId === reimuId)?.dispatch.messages), /publicResponse=allowed/u)
  assert.match(JSON.stringify(characterRequests.find(request => request.subjectId === marisaId)?.dispatch.messages), /publicResponse=observe-only/u)
  assert.deepEqual(stageRequests.flatMap(request =>
    (request.stage === 'research' || request.stage === 'director' || request.stage === 'section' || request.stage === 'editor')
      ? [request.stage]
      : []), [])
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
})
