import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createFlyingChessWorldModule } from '../src/flying-chess-world.ts'
import { FLYING_CHESS_WORLD_MODULE_ID, type FlyingChessWorldState } from '../src/flying-chess-protocol.ts'
import { PlayWorldRegistry } from '../src/play-world.ts'
import { parseAgentRpSessionLaunchRequest } from '../src/session-launch.ts'
import { createStoryWorkspaceSessionSeed, readSessionStoryWorkspaceId } from '../src/session-story-workspace.ts'
import { acceptStorySuggestionBatch } from '../src/story-suggestion-batch.ts'
import type { StoryCharacter, StoryWorkspaceSaveRequest, StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import {
  compileStoryCharacterContext,
  compileStoryDirectorWorldContext,
  createStoryCharacterId,
  createStoryNodeId,
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

  const rolled = store.dispatchWorldAction(installed.id, {
    format: 0,
    revision: installed.revision,
    action: { type: 'roll', actorId: reimuId },
  })
  const pending = rolled.world?.state as FlyingChessWorldState
  assert.equal(pending.pendingRoll?.value, 6)
  assert.equal(pending.pendingRoll?.legalPieceIds.length, 4)
  assert.equal(rolled.world?.events.at(-1)?.type, 'die.rolled')

  const pieceId = pending.pendingRoll?.legalPieceIds[0]
  assert.ok(pieceId)
  const moved = store.dispatchWorldAction(rolled.id, {
    format: 0,
    revision: rolled.revision,
    action: { type: 'move', actorId: reimuId, pieceId },
  })
  const afterMove = moved.world?.state as FlyingChessWorldState
  assert.equal(afterMove.pieces.find(piece => piece.id === pieceId)?.status, 'track')
  assert.equal(afterMove.currentPlayerId, reimuId)

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
  const firstTurn = store.materializeTurn(movedAgain.id, {
    key: 'session-play:turn-1',
    turn: 1,
    title: '灵梦的第一回合',
    summary: '灵梦掷骰并移动棋子。',
    evidence: '棋盘记录了灵梦的行动。',
    participantIds: [reimuId, marisaId],
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
