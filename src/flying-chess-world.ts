/** First-party compact flying-chess world with host-owned dice and transitions. */

import { randomInt, randomUUID } from 'node:crypto'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  FLYING_CHESS_WORLD_MODULE_ID,
  type FlyingChessNarrativeCard,
  type FlyingChessPiece,
  type FlyingChessWorldAction,
  type FlyingChessWorldState,
} from './flying-chess-protocol.ts'
import type { PlayWorldContext, PlayWorldModule } from './play-world.ts'
import type {
  PlayWorldEvent,
  PlayWorldNarrativeCue,
  PlayWorldNarrativeProjection,
} from './play-world-protocol.ts'

const INSTANCE_ID_PATTERN = /^world-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const EVENT_ID_PATTERN = /^world-event-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PIECE_ID_PATTERN = /^piece-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const TRACK_LENGTH = 24
const PIECES_PER_PLAYER = 4

interface FlyingChessWorldModuleOptions {
  readonly rollDie?: () => number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function characterMap(context: PlayWorldContext): ReadonlyMap<string, string> {
  return new Map(context.characters.map(character => [character.id, character.name]))
}

function configurationText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value === '' || value.length > maxLength) {
    throw new Error(`${label}无效`)
  }
  return value
}

function normalizeNarrativeCard(value: unknown, index: number): FlyingChessNarrativeCard {
  const label = `飞行棋叙事事件牌 ${String(index + 1)}`
  if (!isRecord(value) || !exactKeys(value, ['id', 'trigger', 'event', 'cue', 'repeat'])
    || !isRecord(value.trigger) || !exactKeys(value.trigger, ['kind', 'count'])
    || value.trigger.kind !== 'consecutive-passes'
    || !Number.isSafeInteger(value.trigger.count) || (value.trigger.count as number) < 2 || (value.trigger.count as number) > 32
    || !isRecord(value.event) || !exactKeys(value.event, ['title', 'summary'])
    || !isRecord(value.cue) || !exactKeys(value.cue, ['kind', 'text', 'responders'])
    || value.cue.kind !== 'change' && value.cue.kind !== 'pressure'
      && value.cue.kind !== 'opportunity' && value.cue.kind !== 'relationship'
    || value.cue.responders !== 'all' || typeof value.repeat !== 'boolean') {
    throw new Error(`${label}无效`)
  }
  const id = configurationText(value.id, `${label} id`, 120)
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(id)) throw new Error(`${label} id 无效`)
  return {
    id,
    trigger: { kind: 'consecutive-passes', count: value.trigger.count as number },
    event: {
      title: configurationText(value.event.title, `${label}事件标题`, 120),
      summary: configurationText(value.event.summary, `${label}事件事实`, 2_000),
    },
    cue: {
      kind: value.cue.kind,
      text: configurationText(value.cue.text, `${label}现场条件`, 2_000),
      responders: 'all',
    },
    repeat: value.repeat,
  }
}

function narrativeCards(context: PlayWorldContext): readonly FlyingChessNarrativeCard[] {
  const value = context.configuration
  if (isRecord(value) && Object.keys(value).length === 0) return []
  if (!isRecord(value) || !exactKeys(value, ['format', 'ruleset', 'narrativeCards'])
    || value.format !== 0 || value.ruleset !== 'classic-24'
    || value.narrativeCards !== undefined && !Array.isArray(value.narrativeCards)) {
    throw new Error('飞行棋世界配置无效')
  }
  const cards = (value.narrativeCards ?? []).map(normalizeNarrativeCard)
  if (cards.length > 64 || new Set(cards.map(card => card.id)).size !== cards.length) {
    throw new Error('飞行棋叙事事件牌集合无效')
  }
  return cards
}

function requirePlayers(context: PlayWorldContext): readonly string[] {
  narrativeCards(context)
  if (context.characters.length < 2 || context.characters.length > 4) {
    throw new Error('飞行棋需要 2 至 4 位人物')
  }
  return context.characters.map(character => character.id)
}

function normalizePiece(value: unknown, players: ReadonlySet<string>): FlyingChessPiece {
  if (!isRecord(value) || !exactKeys(value, ['id', 'ownerId', 'number', 'status', 'steps'])
    || typeof value.id !== 'string' || !PIECE_ID_PATTERN.test(value.id)
    || typeof value.ownerId !== 'string' || !players.has(value.ownerId)
    || !Number.isSafeInteger(value.number) || (value.number as number) < 1 || (value.number as number) > PIECES_PER_PLAYER
    || (value.status !== 'base' && value.status !== 'track' && value.status !== 'home')
    || !Number.isSafeInteger(value.steps) || (value.steps as number) < 0 || (value.steps as number) > TRACK_LENGTH) {
    throw new Error('飞行棋棋子状态无效')
  }
  if ((value.status === 'base' && value.steps !== 0)
    || (value.status === 'track' && (value.steps as number) >= TRACK_LENGTH)
    || (value.status === 'home' && value.steps !== TRACK_LENGTH)) {
    throw new Error('飞行棋棋子位置无效')
  }
  return value as unknown as FlyingChessPiece
}

function normalizeState(value: unknown, context: PlayWorldContext): FlyingChessWorldState {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'turn', 'playerOrder', 'currentPlayerId', 'pieces', 'pendingRoll', 'winnerId'])
    || value.kind !== 'flying-chess' || !Number.isSafeInteger(value.turn) || (value.turn as number) < 1
    || !Array.isArray(value.playerOrder) || !Array.isArray(value.pieces)) {
    throw new Error('飞行棋世界状态无效')
  }
  const expectedPlayers = requirePlayers(context)
  if (value.playerOrder.length !== expectedPlayers.length
    || value.playerOrder.some(player => typeof player !== 'string')
    || new Set(value.playerOrder).size !== value.playerOrder.length
    || expectedPlayers.some(player => !(value.playerOrder as readonly unknown[]).includes(player))) {
    throw new Error('飞行棋玩家顺序与场地人物不一致')
  }
  if (typeof value.currentPlayerId !== 'string' || !(value.playerOrder as readonly unknown[]).includes(value.currentPlayerId)) {
    throw new Error('飞行棋当前玩家无效')
  }
  const playerSet = new Set(value.playerOrder as readonly string[])
  const pieces = value.pieces.map(piece => normalizePiece(piece, playerSet))
  if (pieces.length !== expectedPlayers.length * PIECES_PER_PLAYER
    || new Set(pieces.map(piece => piece.id)).size !== pieces.length
    || new Set(pieces.map(piece => `${piece.ownerId}\u0000${String(piece.number)}`)).size !== pieces.length
    || expectedPlayers.some(player => pieces.filter(piece => piece.ownerId === player).length !== PIECES_PER_PLAYER)) {
    throw new Error('飞行棋棋子集合无效')
  }
  let pendingRoll: FlyingChessWorldState['pendingRoll']
  if (value.pendingRoll !== undefined) {
    if (!isRecord(value.pendingRoll) || !exactKeys(value.pendingRoll, ['playerId', 'value', 'legalPieceIds'])
      || value.pendingRoll.playerId !== value.currentPlayerId
      || !Number.isSafeInteger(value.pendingRoll.value) || (value.pendingRoll.value as number) < 1 || (value.pendingRoll.value as number) > 6
      || !Array.isArray(value.pendingRoll.legalPieceIds)
      || value.pendingRoll.legalPieceIds.some(id => typeof id !== 'string' || !pieces.some(piece => piece.id === id && piece.ownerId === value.currentPlayerId))) {
      throw new Error('飞行棋待执行骰点无效')
    }
    pendingRoll = {
      playerId: value.pendingRoll.playerId as string,
      value: value.pendingRoll.value as number,
      legalPieceIds: [...new Set(value.pendingRoll.legalPieceIds as readonly string[])],
    }
    const expected = legalPieces({
      kind: 'flying-chess',
      turn: value.turn as number,
      playerOrder: value.playerOrder as readonly string[],
      currentPlayerId: value.currentPlayerId,
      pieces,
    }, pendingRoll.playerId, pendingRoll.value).map(piece => piece.id).sort()
    if (expected.length === 0 || pendingRoll.legalPieceIds.length !== expected.length
      || [...pendingRoll.legalPieceIds].sort().some((id, index) => id !== expected[index])) {
      throw new Error('飞行棋待执行骰点的合法棋子集合无效')
    }
  }
  const winnerId = value.winnerId
  const completedPlayers = [...playerSet].filter(playerId => pieces
    .filter(piece => piece.ownerId === playerId).every(piece => piece.status === 'home'))
  if ((winnerId === undefined && completedPlayers.length !== 0)
    || (winnerId !== undefined && (typeof winnerId !== 'string' || completedPlayers.length !== 1
      || completedPlayers[0] !== winnerId || pendingRoll !== undefined))) {
    throw new Error('飞行棋胜者无效')
  }
  return {
    kind: 'flying-chess',
    turn: value.turn as number,
    playerOrder: value.playerOrder as readonly string[],
    currentPlayerId: value.currentPlayerId,
    pieces,
    ...(pendingRoll === undefined ? {} : { pendingRoll }),
    ...(winnerId === undefined ? {} : { winnerId }),
  }
}

function normalizeEvent(value: unknown, index: number, players: ReadonlySet<string>): PlayWorldEvent {
  if (!isRecord(value) || !exactKeys(value, ['id', 'sequence', 'type', 'title', 'summary', 'actorId', 'data'])
    || typeof value.id !== 'string' || !EVENT_ID_PATTERN.test(value.id)
    || value.sequence !== index + 1 || typeof value.type !== 'string' || value.type.length === 0 || value.type.length > 80
    || typeof value.title !== 'string' || value.title.length === 0 || value.title.length > 120
    || typeof value.summary !== 'string' || value.summary.length > 2000
    || (value.actorId !== undefined && (typeof value.actorId !== 'string' || !players.has(value.actorId)))) {
    throw new Error('飞行棋事件无效')
  }
  const data = value.data === undefined ? undefined : snapshotJsonValue(value.data) as JsonValue | undefined
  if (value.data !== undefined && data === undefined) throw new Error('飞行棋事件数据不是 JSON')
  return {
    id: value.id,
    sequence: value.sequence,
    type: value.type,
    title: value.title,
    summary: value.summary,
    ...(value.actorId === undefined ? {} : { actorId: value.actorId as string }),
    ...(data === undefined ? {} : { data }),
  }
}

function event(
  events: readonly PlayWorldEvent[],
  type: string,
  title: string,
  summary: string,
  actorId?: string,
  data?: JsonValue,
): PlayWorldEvent {
  return {
    id: `world-event-${randomUUID()}`,
    sequence: events.length + 1,
    type,
    title,
    summary,
    ...(actorId === undefined ? {} : { actorId }),
    ...(data === undefined ? {} : { data }),
  }
}

function eventData(event: PlayWorldEvent): Record<string, JsonValue> | undefined {
  return isRecord(event.data) ? event.data as Record<string, JsonValue> : undefined
}

function legalPieces(state: FlyingChessWorldState, playerId: string, value: number): readonly FlyingChessPiece[] {
  return state.pieces.filter(piece => piece.ownerId === playerId && (
    (piece.status === 'base' && value === 6)
    || (piece.status === 'track' && piece.steps + value <= TRACK_LENGTH)
  ))
}

function boardCell(state: FlyingChessWorldState, piece: FlyingChessPiece): number | undefined {
  if (piece.status !== 'track') return undefined
  const playerIndex = state.playerOrder.indexOf(piece.ownerId)
  return (playerIndex * Math.floor(TRACK_LENGTH / state.playerOrder.length) + piece.steps - 1) % TRACK_LENGTH
}

function nextPlayer(state: FlyingChessWorldState): string {
  const current = state.playerOrder.indexOf(state.currentPlayerId)
  return state.playerOrder[(current + 1) % state.playerOrder.length]!
}

function playerName(context: PlayWorldContext, id: string): string {
  return characterMap(context).get(id) ?? id
}

function eventActor(event: PlayWorldEvent, context: PlayWorldContext): string | undefined {
  return event.actorId === undefined ? undefined : playerName(context, event.actorId)
}

function eventNarrative(event: PlayWorldEvent, context: PlayWorldContext): string {
  const actor = eventActor(event, context)
  if (event.type === 'game.started') {
    return `${context.characters.map(character => character.name).join('、')}在棋盘两侧坐定。`
  }
  if (event.type === 'die.rolled' && actor !== undefined) {
    const value = eventData(event)?.value ?? event.summary.match(/结果为 ([1-6])。/u)?.[1]
    if (value !== undefined) return `${actor}掷出的骰子停在 ${value} 点。`
  }
  if (event.type === 'turn.passed' && actor !== undefined) {
    const data = eventData(event)
    if (data?.reason === 'launch-roll-required'
      && typeof data.rolled === 'number' && typeof data.required === 'number'
      && typeof data.nextPlayerId === 'string') {
      return `${actor}的四架飞机仍留在基地。`
    }
    return `${actor}没有可以移动的飞机。`
  }
  if (event.type === 'piece.moved' && actor !== undefined) {
    const piece = event.title.match(/移动 (\d+) 号飞机/u)?.[1]
    if (piece !== undefined && event.summary === '飞机抵达终点。') return `${actor}的 ${piece} 号飞机抵达终点。`
    const step = event.summary.match(/航线第 (\d+) 步/u)?.[1]
    if (piece !== undefined && step !== undefined) return `${actor}把 ${piece} 号飞机推进到航线第 ${step} 步。`
  }
  if (event.type === 'piece.captured' && actor !== undefined) {
    const count = event.summary.match(/^(\d+) 架/u)?.[1]
    if (count !== undefined) return `${actor}撞回 ${count} 架对方飞机。`
  }
  if (event.type === 'game.finished' && actor !== undefined) {
    return `${actor}的四架飞机全部抵达终点，赢得棋局。`
  }
  return `${event.title}：${event.summary}`
}

function pairedRollNarrative(
  roll: PlayWorldEvent,
  outcome: PlayWorldEvent | undefined,
  context: PlayWorldContext,
): string | undefined {
  if (roll.type !== 'die.rolled' || outcome === undefined || outcome.actorId !== roll.actorId) return undefined
  const actor = eventActor(roll, context)
  const value = eventData(roll)?.value ?? roll.summary.match(/结果为 ([1-6])。/u)?.[1]
  if (actor === undefined || value === undefined) return undefined
  if (outcome.type === 'turn.passed') {
    const data = eventData(outcome)
    if (data?.reason === 'launch-roll-required') {
      return `${actor}掷出的骰子停在 ${value} 点，四架飞机仍留在基地。`
    }
  }
  if (outcome.type === 'piece.moved') {
    const piece = outcome.title.match(/移动 (\d+) 号飞机/u)?.[1]
    if (piece !== undefined && outcome.summary === '飞机抵达终点。') {
      return `${actor}掷出的骰子停在 ${value} 点，${piece} 号飞机随即抵达终点。`
    }
    const step = outcome.summary.match(/航线第 (\d+) 步/u)?.[1]
    if (piece !== undefined && step !== undefined) {
      return `${actor}掷出的骰子停在 ${value} 点，随后把 ${piece} 号飞机推进到航线第 ${step} 步。`
    }
  }
  return undefined
}

function renderEventNarratives(events: readonly PlayWorldEvent[], context: PlayWorldContext): string {
  const narratives: string[] = []
  for (let index = 0; index < events.length; index += 1) {
    const paired = pairedRollNarrative(events[index]!, events[index + 1], context)
    if (paired === undefined) {
      narratives.push(eventNarrative(events[index]!, context))
    } else {
      narratives.push(paired)
      index += 1
    }
  }
  return narratives.join('')
}

function consecutivePassedTurns(events: readonly PlayWorldEvent[]): number {
  let count = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const item = events[index]!
    if (item.type === 'turn.passed') {
      count += 1
    } else if (item.type !== 'die.rolled') {
      break
    }
  }
  return count
}

function appendNarrativeCardEvents(
  events: readonly PlayWorldEvent[],
  state: FlyingChessWorldState,
  context: PlayWorldContext,
): readonly PlayWorldEvent[] {
  const passedTurns = consecutivePassedTurns(events)
  const fired = new Set(events.flatMap(item => {
    const data = eventData(item)
    return item.type === 'scene.changed' && data?.kind === 'narrative-card'
      && typeof data.cardId === 'string' ? [data.cardId] : []
  }))
  const matching = narrativeCards(context).filter(card =>
    passedTurns >= card.trigger.count
      && (card.repeat ? passedTurns % card.trigger.count === 0 : !fired.has(card.id)))
  return matching.reduce<readonly PlayWorldEvent[]>((current, card) => [
    ...current,
    event(current, 'scene.changed', card.event.title, card.event.summary, undefined, {
      kind: 'narrative-card',
      cardId: card.id,
      cueKind: card.cue.kind,
      cueText: card.cue.text,
      characterIds: [...state.playerOrder],
    }),
  ], events)
}

function narrativeCues(
  events: readonly PlayWorldEvent[],
  allEvents: readonly PlayWorldEvent[],
  state: FlyingChessWorldState,
  context: PlayWorldContext,
): readonly PlayWorldNarrativeCue[] {
  const everyone = state.playerOrder
  const firstLaunchSequence = allEvents.find(item => {
    const data = eventData(item)
    return item.type === 'piece.moved' && data?.kind === 'piece-moved' && data.fromStatus === 'base'
  })?.sequence
  return events.flatMap((item): readonly PlayWorldNarrativeCue[] => {
    const data = eventData(item)
    if (item.type === 'game.started') {
      return [{
        eventSequences: [item.sequence],
        kind: 'change',
        text: '这是棋局进入当前场景的开场。可依据人物档案与故事地图，用一个具体行动建立人物关系和现场气氛。',
        characterIds: everyone,
      }]
    }
    if (item.type === 'scene.changed' && data?.kind === 'narrative-card'
      && (data.cueKind === 'change' || data.cueKind === 'pressure'
        || data.cueKind === 'opportunity' || data.cueKind === 'relationship')
      && typeof data.cueText === 'string' && Array.isArray(data.characterIds)
      && data.characterIds.every(id => typeof id === 'string')) {
      return [{
        eventSequences: [item.sequence],
        kind: data.cueKind,
        text: data.cueText,
        characterIds: data.characterIds as string[],
      }]
    }
    if (item.type === 'piece.moved' && data?.kind === 'piece-moved'
      && item.sequence === firstLaunchSequence) {
      const actor = eventActor(item, context)
      return [{
        eventSequences: [item.sequence],
        kind: 'change',
        text: `${actor ?? '当前棋手'}让本局第一阶段的僵持出现了明确变化。人物可以回应领先关系的变化，也可以不把它说出口。`,
        characterIds: everyone,
      }]
    }
    if (item.type === 'piece.captured') {
      return [{
        eventSequences: [item.sequence],
        kind: 'relationship',
        text: '这次碰撞直接改变了两位棋手之间的得失关系，适合承载一次有对象、有结果的反应。',
        characterIds: everyone,
      }]
    }
    if (item.type === 'game.finished') {
      return [{
        eventSequences: [item.sequence],
        kind: 'relationship',
        text: '棋局已经分出胜负；用人物实际在意的关系或先前约定收束现场，不要继续制造新的规则回合。',
        characterIds: everyone,
      }]
    }
    return []
  })
}

function projectNarrative(
  events: readonly PlayWorldEvent[],
  allEvents: readonly PlayWorldEvent[],
  state: FlyingChessWorldState,
  context: PlayWorldContext,
): PlayWorldNarrativeProjection {
  const text = renderEventNarratives(events, context)
  const cues = narrativeCues(events, allEvents, state, context)
  const cadence = events.some(item => item.type === 'game.finished')
    ? 'resolution'
    : cues.length > 0 || events.some(item => item.type === 'piece.captured'
      || item.type === 'scene.changed'
      || item.type === 'piece.moved' && eventData(item)?.toStatus === 'home')
      ? 'scene'
      : 'transition'
  return {
    cadence,
    facts: [{ eventSequences: events.map(item => item.sequence), text }],
    cues,
  }
}

function renderState(state: FlyingChessWorldState, events: readonly PlayWorldEvent[], context: PlayWorldContext): string {
  const names = characterMap(context)
  const lines = state.playerOrder.map(playerId => {
    const pieces = state.pieces.filter(piece => piece.ownerId === playerId)
    const base = pieces.filter(piece => piece.status === 'base').length
    const track = pieces.filter(piece => piece.status === 'track').map(piece => `${piece.number}号:${String(piece.steps)}`).join('、') || '无'
    const home = pieces.filter(piece => piece.status === 'home').length
    return `- ${names.get(playerId) ?? playerId}：基地 ${String(base)}，航线 ${track}，到达 ${String(home)}`
  })
  const recent = events.slice(-8).map(item => `- ${item.title}：${item.summary}`).join('\n')
  return [
    '执行约束：棋局状态与世界事件只能由场地程序写入。只能描写下列已记录事件及人物反应；禁止自行掷骰、移动棋子、切换回合、决定胜负或声称任何未记录的棋局变化。',
    `当前第 ${String(state.turn)} 回合，轮到 ${names.get(state.currentPlayerId) ?? state.currentPlayerId}。`,
    state.pendingRoll === undefined ? '尚未掷骰。' : `已掷出 ${String(state.pendingRoll.value)}，等待选择合法棋子。`,
    ...lines,
    state.winnerId === undefined ? '' : `胜者：${names.get(state.winnerId) ?? state.winnerId}`,
    recent === '' ? '' : `最近世界事件：\n${recent}`,
  ].filter(Boolean).join('\n')
}

/** Create one flying-chess module; tests may inject a deterministic die. */
export function createFlyingChessWorldModule(options: FlyingChessWorldModuleOptions = {}): PlayWorldModule {
  const rollDie = options.rollDie ?? (() => randomInt(1, 7))
  return {
    descriptor: {
      id: FLYING_CHESS_WORLD_MODULE_ID,
      name: '幻想乡飞行棋',
      summary: '两至四名人物在 24 格航线上掷骰、起飞、碰撞并率先让四架飞机到达终点。',
      category: 'game',
      minCharacters: 2,
      maxCharacters: 4,
    },
    createWorkspaceScaffold(context) {
      const players = requirePlayers(context)
      const names = characterMap(context)
      return {
        activeNodeKey: 'match',
        nodes: [{
          key: 'match',
          kind: 'beat',
          title: '幻想乡飞行棋对局',
          summary: `${players.map(id => names.get(id) ?? id).join('、')} 正在进行一局飞行棋。`,
          status: 'active',
          audience: 'public',
          position: { x: 0, y: 0 },
          content: '',
          participantIds: players,
          knowledge: { mode: 'participants', characterIds: [] },
        }],
        edges: [],
        outputs: [
          {
            key: 'prose',
            name: '正文',
            kind: 'prose',
            enabled: true,
            instructions: '把本轮权威棋局结果写成承接上一段正文的小说场景。让骰子、棋子与人物反应处在同一条时间流里；重复的无效回合要压缩，不逐项报点，不解释规则，不写系统结算。人物可以沉默，只有获准对白才进入正文。',
          },
        ],
      }
    },
    create(context) {
      const players = requirePlayers(context)
      const pieces = players.flatMap(ownerId => Array.from({ length: PIECES_PER_PLAYER }, (_, index): FlyingChessPiece => ({
        id: `piece-${randomUUID()}`,
        ownerId,
        number: index + 1,
        status: 'base',
        steps: 0,
      })))
      const title = '幻想乡飞行棋'
      const events: readonly PlayWorldEvent[] = [event([], 'game.started', '棋局开始', `${players.map(id => playerName(context, id)).join('、')} 已就位。`)]
      return {
        format: 0,
        instanceId: `world-${randomUUID()}`,
        moduleId: FLYING_CHESS_WORLD_MODULE_ID,
        moduleVersion: 0,
        title,
        state: { kind: 'flying-chess', turn: 1, playerOrder: players, currentPlayerId: players[0]!, pieces } satisfies FlyingChessWorldState,
        events,
      }
    },
    normalize(value, context) {
      if (!isRecord(value) || !exactKeys(value, ['format', 'instanceId', 'moduleId', 'moduleVersion', 'title', 'state', 'events'])
        || value.format !== 0 || typeof value.instanceId !== 'string' || !INSTANCE_ID_PATTERN.test(value.instanceId)
        || value.moduleId !== FLYING_CHESS_WORLD_MODULE_ID || value.moduleVersion !== 0
        || typeof value.title !== 'string' || value.title.trim() === '' || value.title.length > 120
        || !Array.isArray(value.events)) {
        throw new Error('飞行棋世界快照无效')
      }
      const players = new Set(requirePlayers(context))
      const state = normalizeState(value.state, context)
      const events = value.events.map((item, index) => normalizeEvent(item, index, players))
      return { format: 0, instanceId: value.instanceId, moduleId: FLYING_CHESS_WORLD_MODULE_ID, moduleVersion: 0, title: value.title, state, events }
    },
    dispatch(snapshot, action, context) {
      const normalized = this.normalize(snapshot, context)
      if (!isRecord(action) || typeof action.type !== 'string' || typeof action.actorId !== 'string') {
        throw new Error('飞行棋动作无效')
      }
      const state = normalized.state as FlyingChessWorldState
      if (state.winnerId !== undefined) throw new Error('飞行棋已经结束')
      if (action.actorId !== state.currentPlayerId) throw new Error('还没有轮到这位人物')
      if (action.type === 'roll') {
        if (!exactKeys(action, ['type', 'actorId']) || state.pendingRoll !== undefined) throw new Error('当前不能掷骰')
        const value = rollDie()
        if (!Number.isSafeInteger(value) || value < 1 || value > 6) throw new Error('飞行棋骰子实现返回了无效点数')
        const legal = legalPieces(state, action.actorId, value)
        const rolled = event(normalized.events, 'die.rolled', `${playerName(context, action.actorId)}掷出 ${String(value)}`, `第 ${String(state.turn)} 回合掷骰结果为 ${String(value)}。`, action.actorId, {
          kind: 'die-roll',
          value,
        })
        if (legal.length === 0) {
          const nextPlayerId = nextPlayer(state)
          const onlyBasePieces = state.pieces
            .filter(piece => piece.ownerId === action.actorId)
            .every(piece => piece.status === 'base')
          const reason = onlyBasePieces && value !== 6 ? 'launch-roll-required' : 'no-legal-move'
          const passed = event(
            [...normalized.events, rolled],
            'turn.passed',
            reason === 'launch-roll-required' ? '未达到起飞点数' : '没有合法移动',
            reason === 'launch-roll-required'
              ? `基地中的飞机需要掷出 6 点才能起飞；本轮掷出 ${String(value)} 点。`
              : `本轮掷出 ${String(value)} 点，没有可执行的合法移动。`,
            action.actorId,
            { kind: 'turn-passed', reason, rolled: value, required: 6, nextPlayerId },
          )
          const nextEvents = appendNarrativeCardEvents([...normalized.events, rolled, passed], state, context)
          return this.normalize({
            ...normalized,
            state: { ...state, turn: state.turn + 1, currentPlayerId: nextPlayerId },
            events: nextEvents,
          }, context)
        }
        return this.normalize({
          ...normalized,
          state: { ...state, pendingRoll: { playerId: action.actorId, value, legalPieceIds: legal.map(piece => piece.id) } },
          events: [...normalized.events, rolled],
        }, context)
      }
      if (action.type !== 'move' || !exactKeys(action, ['type', 'actorId', 'pieceId']) || typeof action.pieceId !== 'string'
        || state.pendingRoll === undefined || !state.pendingRoll.legalPieceIds.includes(action.pieceId)) {
        throw new Error('当前棋子不能执行这个骰点')
      }
      const moving = state.pieces.find(piece => piece.id === action.pieceId)
      if (moving === undefined) throw new Error('飞行棋棋子不存在')
      const value = state.pendingRoll.value
      const moved: FlyingChessPiece = moving.status === 'base'
        ? { ...moving, status: 'track', steps: 1 }
        : moving.steps + value === TRACK_LENGTH
          ? { ...moving, status: 'home', steps: TRACK_LENGTH }
          : { ...moving, steps: moving.steps + value }
      let pieces = state.pieces.map(piece => piece.id === moved.id ? moved : piece)
      const temporary = { ...state, pieces }
      const destination = boardCell(temporary, moved)
      const captured = destination === undefined ? [] : pieces.filter(piece => piece.ownerId !== moved.ownerId && boardCell(temporary, piece) === destination)
      if (captured.length > 0) {
        const capturedIds = new Set(captured.map(piece => piece.id))
        pieces = pieces.map(piece => capturedIds.has(piece.id) ? { ...piece, status: 'base' as const, steps: 0 } : piece)
      }
      const winnerId = pieces.filter(piece => piece.ownerId === moving.ownerId).every(piece => piece.status === 'home') ? moving.ownerId : undefined
      const keepTurn = value === 6 && winnerId === undefined
      const { pendingRoll: _pendingRoll, ...settledState } = state
      const nextState: FlyingChessWorldState = {
        ...settledState,
        turn: state.turn + 1,
        currentPlayerId: keepTurn ? state.currentPlayerId : nextPlayer(state),
        pieces,
        ...(winnerId === undefined ? {} : { winnerId }),
      }
      const movedEvent = event(normalized.events, 'piece.moved', `${playerName(context, moving.ownerId)}移动 ${String(moving.number)} 号飞机`,
        moved.status === 'home' ? '飞机抵达终点。' : `飞机前进到航线第 ${String(moved.steps)} 步。`, moving.ownerId, {
          kind: 'piece-moved',
          pieceId: moving.id,
          pieceNumber: moving.number,
          fromStatus: moving.status,
          fromSteps: moving.steps,
          toStatus: moved.status,
          toSteps: moved.steps,
          rolled: value,
        })
      const collisionEvents = captured.length === 0 ? [] : [event([...normalized.events, movedEvent], 'piece.captured', '发生碰撞',
        `${String(captured.length)} 架对方飞机返回基地。`, moving.ownerId)]
      const winnerEvents = winnerId === undefined ? [] : [event([...normalized.events, movedEvent, ...collisionEvents], 'game.finished',
        `${playerName(context, winnerId)}获胜`, '四架飞机全部抵达终点。', winnerId)]
      return this.normalize({ ...normalized, state: nextState, events: [...normalized.events, movedEvent, ...collisionEvents, ...winnerEvents] }, context)
    },
    characterTurn(snapshot, context) {
      const normalized = this.normalize(snapshot, context)
      const state = normalized.state as FlyingChessWorldState
      if (state.winnerId !== undefined) return undefined
      const actorId = state.currentPlayerId
      const turnId = `turn:${String(state.turn)}:${actorId}`
      if (state.pendingRoll === undefined) {
        return {
          id: turnId,
          characterId: actorId,
          instruction: '轮到你行动。掷骰后，世界程序会给出结果与下一步合法选择。',
          actions: [{
            id: 'roll',
            label: '掷骰',
            description: '让世界程序生成本回合骰点。',
            action: { type: 'roll', actorId } satisfies FlyingChessWorldAction,
          }],
        }
      }
      const pieces = new Map(state.pieces.map(piece => [piece.id, piece]))
      return {
        id: turnId,
        characterId: actorId,
        instruction: `你掷出了 ${String(state.pendingRoll.value)}。选择一架合法飞机完成本回合。`,
        actions: state.pendingRoll.legalPieceIds.map(pieceId => {
          const piece = pieces.get(pieceId)
          if (piece === undefined) throw new Error('飞行棋合法动作指向未知棋子')
          const location = piece.status === 'base' ? '基地' : piece.status === 'home' ? '终点' : `航线第 ${String(piece.steps)} 步`
          return {
            id: `move:${piece.id}`,
            label: `移动 ${String(piece.number)} 号飞机`,
            description: `${String(piece.number)} 号飞机当前位于${location}。`,
            action: { type: 'move', actorId, pieceId: piece.id } satisfies FlyingChessWorldAction,
          }
        }),
      }
    },
    projectSurface(snapshot, context) {
      const normalized = this.normalize(snapshot, context)
      const state = normalized.state as FlyingChessWorldState
      const currentName = playerName(context, state.currentPlayerId)
      const latest = normalized.events.at(-1)
      const status = state.winnerId === undefined
        ? `第 ${String(state.turn)} 回合 · ${currentName}`
        : `${playerName(context, state.winnerId)}获胜`
      const summary = state.pendingRoll === undefined
        ? latest?.summary ?? '棋局已经准备好。'
        : `骰点是 ${String(state.pendingRoll.value)}；请选择一架高亮的飞机。`
      const arrived = state.pieces.filter(piece => piece.status === 'home').length
      const viewportData = snapshotJsonValue(state) as JsonValue | undefined
      if (viewportData === undefined) throw new Error('飞行棋场地视图无效')
      return {
        title: normalized.title,
        status,
        summary,
        facts: [
          { label: '回合', value: String(state.turn) },
          { label: '行动', value: currentName },
          { label: '已到达', value: `${String(arrived)}/${String(state.pieces.length)}` },
        ],
        viewport: { kind: 'flying-chess/board-v0', data: viewportData },
        composerSuggestions: [],
      }
    },
    projectForCharacter(snapshot, characterId, context) {
      const normalized = this.normalize(snapshot, context)
      if (!context.characters.some(character => character.id === characterId)) throw new Error('飞行棋投影指向未知人物')
      return { title: normalized.title, text: renderState(normalized.state as FlyingChessWorldState, normalized.events, context) }
    },
    projectForDirector(snapshot, context) {
      const normalized = this.normalize(snapshot, context)
      return { title: normalized.title, text: renderState(normalized.state as FlyingChessWorldState, normalized.events, context) }
    },
    projectNarrative(snapshot, eventSequences, context) {
      const normalized = this.normalize(snapshot, context)
      const selected = new Set(eventSequences)
      const events = normalized.events.filter(item => selected.has(item.sequence))
      if (events.length !== selected.size) throw new Error('飞行棋叙事引用了不存在的世界事件')
      if (events.length === 0) throw new Error('飞行棋叙事至少需要一个世界事件')
      return projectNarrative(events, normalized.events, normalized.state as FlyingChessWorldState, context)
    },
  }
}
