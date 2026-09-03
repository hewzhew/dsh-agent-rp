/** First-party compact flying-chess world with host-owned dice and transitions. */

import { randomInt, randomUUID } from 'node:crypto'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  FLYING_CHESS_WORLD_MODULE_ID,
  type FlyingChessNarrativeCard,
  type FlyingChessNarrativeOpportunity,
  type FlyingChessNarrativeTrigger,
  type FlyingChessPiece,
  type FlyingChessWorldAction,
  type FlyingChessWorldState,
} from './flying-chess-protocol.ts'
import type { PlayWorldContext, PlayWorldModule } from './play-world.ts'
import { isPlayWorldOpportunitySpeechMove } from './play-world-protocol.ts'
import type {
  PlayWorldCharacterOpportunity,
  PlayWorldCharacterOpportunityReply,
  PlayWorldCharacterOpportunityResolution,
  PlayWorldEvent,
  PlayWorldNarrativeCue,
  PlayWorldNarrativeFact,
  PlayWorldNarrativeProjection,
  PlayWorldOpportunitySpeechMove,
} from './play-world-protocol.ts'

const INSTANCE_ID_PATTERN = /^world-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const EVENT_ID_PATTERN = /^world-event-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PIECE_ID_PATTERN = /^piece-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const TRACK_LENGTH = 24
const PIECES_PER_PLAYER = 4
const EVENT_SUMMARY_MAX_LENGTH = 2_000
const LEGACY_QUESTION_SLIP = Object.freeze({
  cardId: 'question-slip-step-eight',
  eventTitle: '格子下的折签弹开',
  eventSummary: '一架木机停在航线第 8 步时，格子下压着的折签弹开，正面写着“可以向另一位棋手提一个问题；对方可以拒答”。',
  cueText: '刚移动棋子的人物获得一次明确的提问机会，可以立即使用、留到以后或放弃；只有问题真正说出后，另一位人物才获得回答前提。',
})
const FLYING_CHESS_NARRATIVE_INVARIANTS = Object.freeze([Object.freeze({
  id: 'single-board',
  text: '场景中只有一张棋盘。',
}), Object.freeze({
  id: 'shared-die',
  text: '场景中只有一枚由各回合共用的骰子；投掷次数不能改写成骰子数量。',
})])
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

function normalizeNarrativeTrigger(value: unknown, label: string): FlyingChessNarrativeTrigger {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error(`${label}触发条件无效`)
  if (value.kind === 'consecutive-passes') {
    if (!exactKeys(value, ['kind', 'count']) || !Number.isSafeInteger(value.count)
      || (value.count as number) < 2 || (value.count as number) > 32) {
      throw new Error(`${label}触发条件无效`)
    }
    return { kind: value.kind, count: value.count as number }
  }
  if (value.kind === 'piece-landed' || value.kind === 'piece-crossed-step') {
    if (!exactKeys(value, ['kind', 'step']) || !Number.isSafeInteger(value.step)
      || (value.step as number) < 1 || (value.step as number) >= TRACK_LENGTH) {
      throw new Error(`${label}触发条件无效`)
    }
    return { kind: value.kind, step: value.step as number }
  }
  if (value.kind === 'piece-launched') {
    if (!exactKeys(value, ['kind'])) throw new Error(`${label}触发条件无效`)
    return { kind: value.kind }
  }
  if (value.kind === 'piece-captured') {
    if (!exactKeys(value, ['kind'])) throw new Error(`${label}触发条件无效`)
    return { kind: value.kind }
  }
  if (value.kind === 'player-home-count') {
    if (!exactKeys(value, ['kind', 'count']) || !Number.isSafeInteger(value.count)
      || (value.count as number) < 1 || (value.count as number) > PIECES_PER_PLAYER) {
      throw new Error(`${label}触发条件无效`)
    }
    return { kind: value.kind, count: value.count as number }
  }
  throw new Error(`${label}触发条件无效`)
}

function normalizeNarrativeCard(value: unknown, index: number): FlyingChessNarrativeCard {
  const label = `飞行棋叙事事件牌 ${String(index + 1)}`
  if (!isRecord(value) || !exactKeys(value, ['id', 'afterCardId', 'trigger', 'event', 'cue', 'repeat'])
    || !isRecord(value.event) || !exactKeys(value.event, ['title', 'summary'])
    || !isRecord(value.cue) || !exactKeys(value.cue, ['kind', 'text', 'responders', 'opportunity'])
    || value.cue.kind !== 'change' && value.cue.kind !== 'pressure'
      && value.cue.kind !== 'opportunity' && value.cue.kind !== 'relationship'
    || value.cue.responders !== 'none' && value.cue.responders !== 'actor' && value.cue.responders !== 'opponents'
      && value.cue.responders !== 'all' || typeof value.repeat !== 'boolean'
    || value.cue.opportunity !== undefined && (value.cue.responders === 'none'
      || !isRecord(value.cue.opportunity)
      || !exactKeys(value.cue.opportunity, ['kind', 'move', 'targets'])
      || value.cue.opportunity.kind !== 'speech'
      || !isPlayWorldOpportunitySpeechMove(value.cue.opportunity.move)
      || value.cue.opportunity.targets !== 'opponents')) {
    throw new Error(`${label}无效`)
  }
  const id = configurationText(value.id, `${label} id`, 120)
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(id)) throw new Error(`${label} id 无效`)
  return {
    id,
    ...(value.afterCardId === undefined
      ? {}
      : { afterCardId: configurationText(value.afterCardId, `${label}承接事件牌 id`, 120) }),
    trigger: normalizeNarrativeTrigger(value.trigger, label),
    event: {
      title: configurationText(value.event.title, `${label}事件标题`, 120),
      summary: configurationText(value.event.summary, `${label}事件事实`, 2_000),
    },
    cue: {
      kind: value.cue.kind,
      text: configurationText(value.cue.text, `${label}现场条件`, 2_000),
      responders: value.cue.responders,
      ...(value.cue.opportunity === undefined
        ? {}
        : { opportunity: {
            kind: 'speech',
            move: value.cue.opportunity.move as PlayWorldOpportunitySpeechMove,
            targets: 'opponents',
          } as const }),
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
  const cardsById = new Map(cards.map(card => [card.id, card]))
  for (const card of cards) {
    if (card.afterCardId !== undefined && !cardsById.has(card.afterCardId)) {
      throw new Error(`飞行棋叙事事件牌 ${JSON.stringify(card.id)} 承接了不存在的事件牌`)
    }
    const visited = new Set<string>()
    let current: FlyingChessNarrativeCard | undefined = card
    while (current !== undefined) {
      if (visited.has(current.id)) throw new Error('飞行棋叙事事件牌承接关系形成了循环')
      visited.add(current.id)
      current = current.afterCardId === undefined ? undefined : cardsById.get(current.afterCardId)
    }
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

function normalizeNarrativeOpportunity(
  value: unknown,
  players: ReadonlySet<string>,
): FlyingChessNarrativeOpportunity {
  if (!isRecord(value)
    || !exactKeys(value, ['id', 'cardId', 'sourceEventSequence', 'ownerId', 'responderIds', 'status', 'responderId'])
    || typeof value.id !== 'string' || !/^[A-Za-z0-9:._-]{1,240}$/u.test(value.id)
    || typeof value.cardId !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/u.test(value.cardId)
    || !Number.isSafeInteger(value.sourceEventSequence) || (value.sourceEventSequence as number) < 1
    || typeof value.ownerId !== 'string' || !players.has(value.ownerId)
    || !Array.isArray(value.responderIds) || value.responderIds.length === 0
    || new Set(value.responderIds).size !== value.responderIds.length
    || value.responderIds.some(id => typeof id !== 'string' || id === value.ownerId || !players.has(id))
    || value.status !== 'available' && value.status !== 'retained'
      && value.status !== 'used' && value.status !== 'declined'
    || (value.status === 'used') !== (typeof value.responderId === 'string')
    || value.responderId !== undefined && !(value.responderIds as readonly unknown[]).includes(value.responderId)) {
    throw new Error('飞行棋叙事机会状态无效')
  }
  return {
    id: value.id,
    cardId: value.cardId,
    sourceEventSequence: value.sourceEventSequence as number,
    ownerId: value.ownerId,
    responderIds: value.responderIds as readonly string[],
    status: value.status,
    ...(value.responderId === undefined ? {} : { responderId: value.responderId as string }),
  }
}

function normalizeState(value: unknown, context: PlayWorldContext): FlyingChessWorldState {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'turn', 'playerOrder', 'currentPlayerId', 'pieces', 'opportunities', 'pendingRoll', 'winnerId'])
    || value.kind !== 'flying-chess' || !Number.isSafeInteger(value.turn) || (value.turn as number) < 1
    || !Array.isArray(value.playerOrder) || !Array.isArray(value.pieces)
    || value.opportunities !== undefined && !Array.isArray(value.opportunities)) {
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
  const opportunities = (value.opportunities ?? []).map(item => normalizeNarrativeOpportunity(item, playerSet))
  if (opportunities.length > 64 || new Set(opportunities.map(item => item.id)).size !== opportunities.length) {
    throw new Error('飞行棋叙事机会集合无效')
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
      opportunities,
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
    opportunities,
    ...(pendingRoll === undefined ? {} : { pendingRoll }),
    ...(winnerId === undefined ? {} : { winnerId }),
  }
}

function normalizeEvent(value: unknown, index: number, players: ReadonlySet<string>): PlayWorldEvent {
  if (!isRecord(value) || !exactKeys(value, ['id', 'sequence', 'type', 'title', 'summary', 'actorId', 'data'])
    || typeof value.id !== 'string' || !EVENT_ID_PATTERN.test(value.id)
    || value.sequence !== index + 1 || typeof value.type !== 'string' || value.type.length === 0 || value.type.length > 80
    || typeof value.title !== 'string' || value.title.length === 0 || value.title.length > 120
    || typeof value.summary !== 'string' || value.summary.length > EVENT_SUMMARY_MAX_LENGTH
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

function eventCrossesTrackStep(event: PlayWorldEvent, step: number): boolean {
  const data = eventData(event)
  if (event.type !== 'piece.moved' || data?.kind !== 'piece-moved') return false
  const fromSteps = data.fromStatus === 'base' ? 0 : data.fromStatus === 'track' ? data.fromSteps : undefined
  const toSteps = data.toStatus === 'home' ? TRACK_LENGTH : data.toStatus === 'track' ? data.toSteps : undefined
  return typeof fromSteps === 'number' && typeof toSteps === 'number'
    && fromSteps < step && toSteps >= step
}

function narrativeOpportunityUse(
  item: PlayWorldEvent,
  context: PlayWorldContext,
): FlyingChessNarrativeCard['cue']['opportunity'] | undefined {
  const data = eventData(item)
  if (item.type !== 'scene.changed' || data?.kind !== 'narrative-card'
    || typeof data.cardId !== 'string') return undefined
  if (data.opportunityKind === 'speech'
    && isPlayWorldOpportunitySpeechMove(data.opportunityMove)
    && data.opportunityTargets === 'opponents') {
    return {
      kind: 'speech',
      move: data.opportunityMove,
      targets: 'opponents',
    }
  }
  const card = narrativeCards(context).find(candidate => candidate.id === data.cardId)
  if (card?.cue.opportunity !== undefined) return card.cue.opportunity
  const trigger = card?.trigger
  if (data.cardId === LEGACY_QUESTION_SLIP.cardId
    && exactKeys(data, ['kind', 'cardId', 'cueKind', 'cueText', 'causeSequence', 'characterIds'])
    && data.cueKind === 'relationship' && data.cueText === LEGACY_QUESTION_SLIP.cueText
    && item.title === LEGACY_QUESTION_SLIP.eventTitle && item.summary === LEGACY_QUESTION_SLIP.eventSummary
    && (trigger?.kind === 'piece-landed' || trigger?.kind === 'piece-crossed-step') && trigger.step === 8
    && card?.event.title === LEGACY_QUESTION_SLIP.eventTitle
    && card.event.summary === LEGACY_QUESTION_SLIP.eventSummary
    && card.cue.kind === 'relationship' && card.cue.text === LEGACY_QUESTION_SLIP.cueText
    && card.cue.responders === 'actor' && card.repeat === false) {
    return { kind: 'speech', move: 'question', targets: 'opponents' }
  }
  return undefined
}

function opportunityId(eventId: string, ownerId: string): string {
  return `opportunity:${eventId}:${ownerId}`
}

function eventSummary(text: string): string {
  return text.length <= EVENT_SUMMARY_MAX_LENGTH
    ? text
    : `${text.slice(0, EVENT_SUMMARY_MAX_LENGTH - 1)}…`
}

function usedOpportunityEvent(
  events: readonly PlayWorldEvent[],
  opportunity: FlyingChessNarrativeOpportunity,
  resolution: PlayWorldCharacterOpportunityResolution & {
    readonly disposition: 'use'
    readonly responderId: string
    readonly publicEvidence: string
  },
  move: PlayWorldOpportunitySpeechMove,
  context: PlayWorldContext,
): PlayWorldEvent {
  const actor = playerName(context, opportunity.ownerId)
  const responder = playerName(context, resolution.responderId)
  const title = move === 'question' ? `${actor}公开提问`
    : move === 'command' ? `${actor}提出补偿要求` : `${actor}提出加码条件`
  const statement = move === 'question' ? `${actor}向${responder}问：${resolution.publicEvidence}`
    : move === 'command' ? `${actor}向${responder}提出要求：${resolution.publicEvidence}`
      : `${actor}向${responder}提议：${resolution.publicEvidence}`
  return event(
    events,
    'narrative.opportunity-used',
    title,
    eventSummary(statement),
    opportunity.ownerId,
    {
      kind: 'narrative-opportunity-used',
      opportunityId: opportunity.id,
      cardId: opportunity.cardId,
      sourceEventSequence: opportunity.sourceEventSequence,
      responderId: resolution.responderId,
      move,
      publicEvidence: resolution.publicEvidence,
    },
  )
}

function opportunityReplyEvent(
  events: readonly PlayWorldEvent[],
  opportunity: FlyingChessNarrativeOpportunity,
  reply: PlayWorldCharacterOpportunityReply,
  useEventSequence: number,
  context: PlayWorldContext,
): PlayWorldEvent {
  const responder = playerName(context, reply.characterId)
  const owner = playerName(context, opportunity.ownerId)
  const title = reply.move === 'refuse' ? `${responder}拒绝回应`
    : reply.move === 'propose' ? `${responder}另提条件` : `${responder}作出回应`
  const statement = reply.move === 'refuse' ? `${responder}拒绝了${owner}：${reply.publicEvidence}`
    : reply.move === 'propose' ? `${responder}向${owner}另提条件：${reply.publicEvidence}`
      : `${responder}回应${owner}：${reply.publicEvidence}`
  return event(
    events,
    'narrative.opportunity-replied',
    title,
    eventSummary(statement),
    reply.characterId,
    {
      kind: 'narrative-opportunity-replied',
      opportunityId: opportunity.id,
      cardId: opportunity.cardId,
      sourceEventSequence: opportunity.sourceEventSequence,
      useEventSequence,
      ownerId: opportunity.ownerId,
      move: reply.move,
      publicEvidence: reply.publicEvidence,
    },
  )
}

function recoverNarrativeOpportunities(
  state: FlyingChessWorldState,
  events: readonly PlayWorldEvent[],
  context: PlayWorldContext,
): FlyingChessWorldState {
  const eventBySequence = new Map(events.map(item => [item.sequence, item]))
  for (const opportunity of state.opportunities) {
    const source = eventBySequence.get(opportunity.sourceEventSequence)
    const data = source === undefined ? undefined : eventData(source)
    if (source === undefined || data?.kind !== 'narrative-card' || data.cardId !== opportunity.cardId) {
      throw new Error('飞行棋叙事机会引用了无效的世界事件')
    }
  }
  const existing = new Set(state.opportunities.map(item => item.id))
  const recovered = events.flatMap(item => {
    if (narrativeOpportunityUse(item, context) === undefined) return []
    const data = eventData(item)
    if (typeof data?.cardId !== 'string' || !Array.isArray(data.characterIds)
      || data.characterIds.some(id => typeof id !== 'string' || !state.playerOrder.includes(id))) return []
    return (data.characterIds as readonly string[]).flatMap(ownerId => {
      const id = opportunityId(item.id, ownerId)
      if (existing.has(id)) return []
      existing.add(id)
      return [{
        id,
        cardId: data.cardId as string,
        sourceEventSequence: item.sequence,
        ownerId,
        responderIds: state.playerOrder.filter(id => id !== ownerId),
        status: 'available' as const,
      }]
    })
  })
  return recovered.length === 0
    ? state
    : { ...state, opportunities: [...state.opportunities, ...recovered] }
}

function characterOpportunities(
  state: FlyingChessWorldState,
  events: readonly PlayWorldEvent[],
  characterId: string,
  context: PlayWorldContext,
): readonly PlayWorldCharacterOpportunity[] {
  const eventBySequence = new Map(events.map(item => [item.sequence, item]))
  return state.opportunities.flatMap(opportunity => {
    if (opportunity.ownerId !== characterId
      || opportunity.status !== 'available' && opportunity.status !== 'retained') return []
    const source = eventBySequence.get(opportunity.sourceEventSequence)
    const data = source === undefined ? undefined : eventData(source)
    const use = source === undefined ? undefined : narrativeOpportunityUse(source, context)
    if (typeof data?.cueText !== 'string' || use === undefined) {
      throw new Error('飞行棋叙事机会缺少来源说明')
    }
    return [{
      id: opportunity.id,
      sourceEventSequences: [opportunity.sourceEventSequence],
      characterId,
      responderIds: opportunity.responderIds,
      status: opportunity.status,
      instruction: data.cueText,
      use,
    }]
  })
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
  if (event.type === 'scene.changed') return event.summary
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

function eventNarrativeFacts(
  events: readonly PlayWorldEvent[],
  allEvents: readonly PlayWorldEvent[],
  context: PlayWorldContext,
): readonly PlayWorldNarrativeFact[] {
  const facts: PlayWorldNarrativeFact[] = []
  for (let index = 0; index < events.length; index += 1) {
    const current = events[index]!
    const outcome = events[index + 1]
    const paired = pairedRollNarrative(current, outcome, context)
    if (paired === undefined) {
      facts.push({
        eventSequences: [current.sequence],
        retention: current.type === 'turn.passed' || current.type === 'game.started'
          ? 'compressible'
          : 'essential',
        text: eventNarrative(current, context),
      })
    } else {
      const outcomeData = eventData(outcome!)
      const compressibleMove = outcome!.type === 'piece.moved'
        && outcomeData?.kind === 'piece-moved'
        && outcomeData.toStatus !== 'home'
        && !isFirstCharacterLaunchEvent(outcome!, allEvents)
        && events[index + 2]?.type !== 'piece.captured'
      facts.push({
        eventSequences: [current.sequence, outcome!.sequence],
        retention: outcome!.type === 'turn.passed' || compressibleMove ? 'compressible' : 'essential',
        text: paired,
      })
      index += 1
    }
  }
  return facts
}

function compactTransitionNarrativeFacts(
  events: readonly PlayWorldEvent[],
  allEvents: readonly PlayWorldEvent[],
  context: PlayWorldContext,
): readonly PlayWorldNarrativeFact[] {
  if (events.some(item => item.type !== 'die.rolled'
    && item.type !== 'turn.passed' && item.type !== 'piece.moved')) {
    return eventNarrativeFacts(events, allEvents, context)
  }
  const moves = new Map<string, {
    readonly actor: string
    readonly pieceNumber: number
    readonly fromStatus: string
    readonly fromSteps?: number
    toStatus: string
    toSteps: number | undefined
  }>()
  for (const item of events) {
    if (item.type !== 'piece.moved') continue
    const data = eventData(item)
    const actor = eventActor(item, context)
    if (data?.kind !== 'piece-moved' || typeof data.pieceId !== 'string'
      || typeof data.pieceNumber !== 'number' || typeof data.fromStatus !== 'string'
      || typeof data.toStatus !== 'string' || actor === undefined
      || data.fromSteps !== undefined && typeof data.fromSteps !== 'number'
      || data.toSteps !== undefined && typeof data.toSteps !== 'number') {
      return eventNarrativeFacts(events, allEvents, context)
    }
    const key = `${item.actorId ?? actor}:${data.pieceId}`
    const previous = moves.get(key)
    if (previous === undefined) {
      moves.set(key, {
        actor,
        pieceNumber: data.pieceNumber,
        fromStatus: data.fromStatus,
        ...(data.fromSteps === undefined ? {} : { fromSteps: data.fromSteps }),
        toStatus: data.toStatus,
        toSteps: data.toSteps,
      })
    } else {
      previous.toStatus = data.toStatus
      previous.toSteps = data.toSteps
    }
  }
  const clauses = [...moves.values()].flatMap(move => {
    if (move.toStatus !== 'track' || move.toSteps === undefined) return []
    if (move.fromStatus === 'base') {
      return [`${move.actor}的 ${String(move.pieceNumber)} 号飞机离开基地，推进到航线第 ${String(move.toSteps)} 步`]
    }
    if (move.fromStatus === 'track' && move.fromSteps !== undefined) {
      return [`${move.actor}的 ${String(move.pieceNumber)} 号飞机从航线第 ${String(move.fromSteps)} 步推进到第 ${String(move.toSteps)} 步`]
    }
    return []
  })
  const eventSequences = events.map(item => item.sequence)
  if (clauses.length > 0) {
    const severalTurns = events.filter(item => item.type === 'die.rolled').length > 1
    return [{
      eventSequences,
      retention: 'compressible',
      text: `${severalTurns ? '几轮下来，' : ''}${clauses.join('；')}。`,
    }]
  }
  const actors = [...new Set(events.flatMap(item => {
    const actor = eventActor(item, context)
    return actor === undefined ? [] : [actor]
  }))]
  if (actors.length === 0) return eventNarrativeFacts(events, allEvents, context)
  return [{
    eventSequences,
    retention: 'compressible',
    text: actors.length === 1 && events.filter(item => item.type === 'die.rolled').length <= 1
      ? `${actors[0]}这一轮没有飞机移动。`
      : `几轮过去，${actors.join('与')}的飞机都没有移动。`,
  }]
}

function compactRoutineNarrativeFacts(
  events: readonly PlayWorldEvent[],
  allEvents: readonly PlayWorldEvent[],
  context: PlayWorldContext,
): readonly PlayWorldNarrativeFact[] {
  const facts = eventNarrativeFacts(events, allEvents, context)
  const eventsBySequence = new Map(events.map(item => [item.sequence, item]))
  const output: PlayWorldNarrativeFact[] = []
  let routine: PlayWorldEvent[] = []
  const flush = (): void => {
    if (routine.length === 0) return
    output.push(...compactTransitionNarrativeFacts(routine, allEvents, context))
    routine = []
  }
  for (const fact of facts) {
    const sourceEvents = fact.eventSequences.flatMap(sequence => {
      const item = eventsBySequence.get(sequence)
      return item === undefined ? [] : [item]
    })
    const compressibleRoutine = fact.retention === 'compressible'
      && sourceEvents.length === fact.eventSequences.length
      && sourceEvents.every(item => item.type === 'die.rolled'
        || item.type === 'turn.passed' || item.type === 'piece.moved')
    if (compressibleRoutine) {
      routine.push(...sourceEvents)
      continue
    }
    flush()
    output.push(fact)
  }
  flush()
  return output
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

function isFirstCharacterLaunchEvent(
  event: PlayWorldEvent,
  allEvents: readonly PlayWorldEvent[],
): boolean {
  const data = eventData(event)
  if (event.type !== 'piece.moved' || data?.kind !== 'piece-moved' || data.fromStatus !== 'base') return false
  return allEvents.find(item => {
    const itemData = eventData(item)
    return item.type === 'piece.moved' && itemData?.kind === 'piece-moved' && itemData.fromStatus === 'base'
      && item.actorId === event.actorId
  })?.sequence === event.sequence
}

function appendNarrativeCardEvents(
  events: readonly PlayWorldEvent[],
  triggerEvents: readonly PlayWorldEvent[],
  state: FlyingChessWorldState,
  context: PlayWorldContext,
): readonly PlayWorldEvent[] {
  const passedTurns = consecutivePassedTurns(events)
  const fired = new Map(events.flatMap(item => {
    const data = eventData(item)
    return item.type === 'scene.changed' && data?.kind === 'narrative-card'
      && typeof data.cardId === 'string' ? [[data.cardId, item] as const] : []
  }))
  const matches = narrativeCards(context).flatMap(card => {
    if (!card.repeat && fired.has(card.id)) return []
    const predecessor = card.afterCardId === undefined ? undefined : fired.get(card.afterCardId)
    if (card.afterCardId !== undefined && predecessor === undefined) return []
    const trigger = card.trigger
    let cause: PlayWorldEvent | undefined
    if (trigger.kind === 'consecutive-passes') {
      cause = triggerEvents.find(item => item.type === 'turn.passed')
      if (cause === undefined || passedTurns < trigger.count
        || card.repeat && passedTurns % trigger.count !== 0) return []
    } else if (trigger.kind === 'piece-launched') {
      cause = triggerEvents.find(item => {
        const data = eventData(item)
        return item.type === 'piece.moved' && data?.kind === 'piece-moved'
          && data.fromStatus === 'base'
      })
    } else if (trigger.kind === 'piece-landed') {
      cause = triggerEvents.find(item => {
        const data = eventData(item)
        return item.type === 'piece.moved' && data?.toStatus === 'track'
          && data.toSteps === trigger.step
      })
    } else if (trigger.kind === 'piece-crossed-step') {
      cause = triggerEvents.find(item => eventCrossesTrackStep(item, trigger.step))
    } else if (trigger.kind === 'piece-captured') {
      cause = triggerEvents.find(item => item.type === 'piece.captured')
    } else {
      cause = triggerEvents.find(item => {
        const data = eventData(item)
        return item.type === 'piece.moved' && data?.toStatus === 'home'
          && item.actorId !== undefined
          && state.pieces.filter(piece => piece.ownerId === item.actorId && piece.status === 'home').length === trigger.count
      })
    }
    return cause?.actorId === undefined ? [] : [{
      card,
      actorId: cause.actorId,
      causeSequence: cause.sequence,
      predecessorSequence: predecessor?.sequence,
    }]
  })
  return matches.reduce<readonly PlayWorldEvent[]>((current, match) => {
    const { card, actorId, causeSequence, predecessorSequence } = match
    const characterIds = card.cue.responders === 'none'
      ? []
      : card.cue.responders === 'all'
      ? state.playerOrder
      : card.cue.responders === 'actor'
        ? [actorId]
        : state.playerOrder.filter(characterId => characterId !== actorId)
    return [
      ...current,
      event(current, 'scene.changed', card.event.title, card.event.summary, undefined, {
        kind: 'narrative-card',
        cardId: card.id,
        cueKind: card.cue.kind,
        cueText: card.cue.text,
        causeSequence,
        characterIds: [...characterIds],
        ...(card.afterCardId === undefined || predecessorSequence === undefined ? {} : {
          afterCardId: card.afterCardId,
          predecessorSequence,
        }),
        ...(card.cue.opportunity === undefined ? {} : {
          opportunityKind: card.cue.opportunity.kind,
          opportunityMove: card.cue.opportunity.move,
          opportunityTargets: card.cue.opportunity.targets,
        }),
      }),
    ]
  }, events)
}

function unresolvedNarrativeEvents(
  events: readonly PlayWorldEvent[],
  context: PlayWorldContext,
): readonly PlayWorldEvent[] {
  const cards = narrativeCards(context)
  const fired = new Map(events.flatMap(item => {
    const data = eventData(item)
    return item.type === 'scene.changed' && data?.kind === 'narrative-card'
      && typeof data.cardId === 'string' ? [[data.cardId, item] as const] : []
  }))
  const successors = new Map<string, string[]>()
  for (const card of cards) {
    if (card.afterCardId === undefined) continue
    const items = successors.get(card.afterCardId) ?? []
    items.push(card.id)
    successors.set(card.afterCardId, items)
  }
  return [...successors].flatMap(([cardId, successorIds]) => {
    const source = fired.get(cardId)
    return source !== undefined && successorIds.some(id => !fired.has(id)) ? [source] : []
  })
}

function narrativeCues(
  events: readonly PlayWorldEvent[],
  state: FlyingChessWorldState,
): readonly PlayWorldNarrativeCue[] {
  const everyone = state.playerOrder
  return events.flatMap((item): readonly PlayWorldNarrativeCue[] => {
    const data = eventData(item)
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
  const cues = narrativeCues(events, state)
  const selectedSequences = new Set(events.map(item => item.sequence))
  const unresolvedInvariants = unresolvedNarrativeEvents(allEvents, context)
    .filter(item => !selectedSequences.has(item.sequence))
    .map(item => ({
      id: `unresolved-narrative-${String(item.sequence)}`,
      text: `未完现场线索“${item.title}”只表示已经记录的公开状态仍然成立；除非本轮世界事件明确改变它，物件的位置、朝向、可见内容与处置状态都保持不变，也不能仅据此补写人物动作。`,
    }))
  const cadence = events.some(item => item.type === 'game.finished')
    ? 'resolution'
    : cues.length > 0 || events.some(item => item.type === 'game.started'
      || isFirstCharacterLaunchEvent(item, allEvents)
      || item.type === 'piece.captured'
      || item.type === 'scene.changed'
      || item.type === 'piece.moved' && eventData(item)?.toStatus === 'home')
      ? 'scene'
      : 'transition'
  return {
    cadence,
    facts: compactRoutineNarrativeFacts(events, allEvents, context),
    cues,
    invariants: [...FLYING_CHESS_NARRATIVE_INVARIANTS, ...unresolvedInvariants],
  }
}

function renderState(
  state: FlyingChessWorldState,
  events: readonly PlayWorldEvent[],
  context: PlayWorldContext,
  characterId?: string,
): string {
  const names = characterMap(context)
  const lines = state.playerOrder.map(playerId => {
    const pieces = state.pieces.filter(piece => piece.ownerId === playerId)
    const base = pieces.filter(piece => piece.status === 'base').length
    const track = pieces.filter(piece => piece.status === 'track').map(piece => `${piece.number}号:${String(piece.steps)}`).join('、') || '无'
    const home = pieces.filter(piece => piece.status === 'home').length
    return `- ${names.get(playerId) ?? playerId}：基地 ${String(base)}，航线 ${track}，到达 ${String(home)}`
  })
  const recent = events.slice(-8).map(item => `- ${item.title}：${item.summary}`).join('\n')
  const eventBySequence = new Map(events.map(item => [item.sequence, item]))
  const opportunities = characterId === undefined
    ? []
    : state.opportunities.flatMap(opportunity => {
        if (opportunity.ownerId !== characterId) return []
        const source = eventBySequence.get(opportunity.sourceEventSequence)
        const data = source === undefined ? undefined : eventData(source)
        if (typeof data?.cueText !== 'string' || source === undefined
          || narrativeOpportunityUse(source, context) === undefined) {
          throw new Error('飞行棋叙事机会缺少来源说明')
        }
        const status = opportunity.status === 'available'
          ? '尚未处置'
          : opportunity.status === 'retained'
            ? '已保留'
            : opportunity.status === 'declined'
              ? '已放弃'
              : `已使用${opportunity.responderId === undefined
                ? ''
                : `，回应者为 ${names.get(opportunity.responderId) ?? opportunity.responderId}`}`
        return [`- [${opportunity.id}] ${status}：${data.cueText}`]
      })
  const unresolvedNarrative = unresolvedNarrativeEvents(events, context)
    .map(item => `- ${item.title}：${item.summary}`)
  return [
    '执行约束：棋局状态与世界事件只能由场地程序写入。只能描写下列已记录事件及人物反应；禁止自行掷骰、移动棋子、切换回合、决定胜负或声称任何未记录的棋局变化。',
    `当前第 ${String(state.turn)} 回合，轮到 ${names.get(state.currentPlayerId) ?? state.currentPlayerId}。`,
    state.pendingRoll === undefined ? '尚未掷骰。' : `已掷出 ${String(state.pendingRoll.value)}，等待选择合法棋子。`,
    ...lines,
    state.winnerId === undefined ? '' : `胜者：${names.get(state.winnerId) ?? state.winnerId}`,
    unresolvedNarrative.length === 0
      ? ''
      : `持续只读的公开现场状态（只有新的世界事件可以改变，不能据此补写物件变化或人物动作）：\n${unresolvedNarrative.join('\n')}`,
    opportunities.length === 0 ? '' : `你拥有的世界机会：\n${opportunities.join('\n')}`,
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
        state: {
          kind: 'flying-chess',
          turn: 1,
          playerOrder: players,
          currentPlayerId: players[0]!,
          pieces,
          opportunities: [],
        } satisfies FlyingChessWorldState,
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
      const events = value.events.map((item, index) => normalizeEvent(item, index, players))
      const state = recoverNarrativeOpportunities(normalizeState(value.state, context), events, context)
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
          const settledEvents = [...normalized.events, rolled, passed]
          const nextState = { ...state, turn: state.turn + 1, currentPlayerId: nextPlayerId }
          const nextEvents = appendNarrativeCardEvents(settledEvents, [rolled, passed], nextState, context)
          return this.normalize({
            ...normalized,
            state: nextState,
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
      const settledEvents = [...normalized.events, movedEvent, ...collisionEvents, ...winnerEvents]
      const nextEvents = appendNarrativeCardEvents(
        settledEvents,
        [movedEvent, ...collisionEvents, ...winnerEvents],
        nextState,
        context,
      )
      return this.normalize({ ...normalized, state: nextState, events: nextEvents }, context)
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
      return {
        title: normalized.title,
        text: renderState(normalized.state as FlyingChessWorldState, normalized.events, context, characterId),
      }
    },
    characterOpportunities(snapshot, characterId, context) {
      const normalized = this.normalize(snapshot, context)
      if (!context.characters.some(character => character.id === characterId)) throw new Error('飞行棋机会投影指向未知人物')
      return characterOpportunities(
        normalized.state as FlyingChessWorldState,
        normalized.events,
        characterId,
        context,
      )
    },
    resolveCharacterOpportunity(snapshot, resolution: PlayWorldCharacterOpportunityResolution, context) {
      const normalized = this.normalize(snapshot, context)
      const state = normalized.state as FlyingChessWorldState
      const selected = state.opportunities.find(item => item.id === resolution.opportunityId)
      if (selected === undefined || selected.ownerId !== resolution.characterId) {
        throw new Error('飞行棋叙事机会不存在或不属于这位人物')
      }
      const unchanged = selected.status === 'retained' && resolution.disposition === 'retain'
        || selected.status === 'used' && resolution.disposition === 'use'
          && selected.responderId === resolution.responderId
        || selected.status === 'declined' && resolution.disposition === 'decline'
      if (unchanged) return normalized
      if (selected.status === 'used' || selected.status === 'declined') {
        throw new Error('飞行棋叙事机会已经终结')
      }
      if (resolution.disposition === 'retain') {
        if (resolution.responderId !== undefined || resolution.publicEvidence !== undefined) {
          throw new Error('保留飞行棋叙事机会时不能附带使用结果')
        }
      } else if (resolution.disposition === 'decline') {
        if (resolution.responderId !== undefined || resolution.publicEvidence !== undefined) {
          throw new Error('放弃飞行棋叙事机会时不能附带使用结果')
        }
      } else {
        const source = normalized.events.find(item => item.sequence === selected.sourceEventSequence)
        const use = source === undefined ? undefined : narrativeOpportunityUse(source, context)
        if (source === undefined || use === undefined
          || resolution.responderId === undefined || !selected.responderIds.includes(resolution.responderId)
          || typeof resolution.publicEvidence !== 'string' || resolution.publicEvidence.trim() === '') {
          throw new Error('使用飞行棋叙事机会缺少有效的公开话语')
        }
      }
      const opportunities = state.opportunities.map(item => item.id !== selected.id
        ? item
        : resolution.disposition === 'retain'
          ? { ...item, status: 'retained' as const }
          : resolution.disposition === 'decline'
            ? { ...item, status: 'declined' as const }
            : { ...item, status: 'used' as const, responderId: resolution.responderId })
      if (resolution.disposition !== 'use') {
        return this.normalize({ ...normalized, state: { ...state, opportunities } }, context)
      }
      const source = normalized.events.find(item => item.sequence === selected.sourceEventSequence)!
      const use = narrativeOpportunityUse(source, context)!
      const used = usedOpportunityEvent(
        normalized.events,
        selected,
        resolution as PlayWorldCharacterOpportunityResolution & {
          readonly disposition: 'use'
          readonly responderId: string
          readonly publicEvidence: string
        },
        use.move,
        context,
      )
      return this.normalize({
        ...normalized,
        state: { ...state, opportunities },
        events: [...normalized.events, used],
      }, context)
    },
    resolveCharacterOpportunityReply(snapshot, reply: PlayWorldCharacterOpportunityReply, context) {
      const normalized = this.normalize(snapshot, context)
      const state = normalized.state as FlyingChessWorldState
      const selected = state.opportunities.find(item => item.id === reply.opportunityId)
      if (selected === undefined || selected.status !== 'used' || selected.responderId !== reply.characterId
        || selected.ownerId !== reply.ownerId || reply.characterId === reply.ownerId
        || typeof reply.publicEvidence !== 'string' || reply.publicEvidence.trim() === '') {
        throw new Error('飞行棋叙事机会回应缺少有效的公开话语或对应关系')
      }
      const existingReply = normalized.events.find(item => {
        const data = eventData(item)
        return item.type === 'narrative.opportunity-replied'
          && data?.kind === 'narrative-opportunity-replied' && data.opportunityId === selected.id
      })
      if (existingReply !== undefined) {
        const data = eventData(existingReply)
        if (existingReply.actorId === reply.characterId && data?.ownerId === reply.ownerId
          && data.move === reply.move && data.publicEvidence === reply.publicEvidence) return normalized
        throw new Error('飞行棋叙事机会已经由另一项公开回应关闭')
      }
      const useEvent = normalized.events.find(item => {
        const data = eventData(item)
        return item.type === 'narrative.opportunity-used'
          && data?.kind === 'narrative-opportunity-used' && data.opportunityId === selected.id
          && item.actorId === selected.ownerId && data.responderId === selected.responderId
      })
      if (useEvent === undefined) throw new Error('飞行棋叙事机会回应缺少公开使用事件')
      const replied = opportunityReplyEvent(normalized.events, selected, reply, useEvent.sequence, context)
      return this.normalize({ ...normalized, events: [...normalized.events, replied] }, context)
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
