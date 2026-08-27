/** First-party compact flying-chess world with host-owned dice and transitions. */

import { randomInt, randomUUID } from 'node:crypto'
import {
  FLYING_CHESS_WORLD_MODULE_ID,
  type FlyingChessPiece,
  type FlyingChessWorldAction,
  type FlyingChessWorldState,
} from './flying-chess-protocol.ts'
import type { PlayWorldContext, PlayWorldModule } from './play-world.ts'
import type { PlayWorldEvent } from './play-world-protocol.ts'

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

function requirePlayers(context: PlayWorldContext): readonly string[] {
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
  if (!isRecord(value) || !exactKeys(value, ['id', 'sequence', 'type', 'title', 'summary', 'actorId'])
    || typeof value.id !== 'string' || !EVENT_ID_PATTERN.test(value.id)
    || value.sequence !== index + 1 || typeof value.type !== 'string' || value.type.length === 0 || value.type.length > 80
    || typeof value.title !== 'string' || value.title.length === 0 || value.title.length > 120
    || typeof value.summary !== 'string' || value.summary.length > 2000
    || (value.actorId !== undefined && (typeof value.actorId !== 'string' || !players.has(value.actorId)))) {
    throw new Error('飞行棋事件无效')
  }
  return value as unknown as PlayWorldEvent
}

function event(events: readonly PlayWorldEvent[], type: string, title: string, summary: string, actorId?: string): PlayWorldEvent {
  return {
    id: `world-event-${randomUUID()}`,
    sequence: events.length + 1,
    type,
    title,
    summary,
    ...(actorId === undefined ? {} : { actorId }),
  }
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
        const rolled = event(normalized.events, 'die.rolled', `${playerName(context, action.actorId)}掷出 ${String(value)}`, `第 ${String(state.turn)} 回合掷骰结果为 ${String(value)}。`, action.actorId)
        if (legal.length === 0) {
          const passed = event([...normalized.events, rolled], 'turn.passed', '没有可移动的飞机', `${playerName(context, action.actorId)}结束本回合。`, action.actorId)
          return this.normalize({
            ...normalized,
            state: { ...state, turn: state.turn + 1, currentPlayerId: nextPlayer(state) },
            events: [...normalized.events, rolled, passed],
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
        moved.status === 'home' ? '飞机抵达终点。' : `飞机前进到航线第 ${String(moved.steps)} 步。`, moving.ownerId)
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
    projectForCharacter(snapshot, characterId, context) {
      const normalized = this.normalize(snapshot, context)
      if (!context.characters.some(character => character.id === characterId)) throw new Error('飞行棋投影指向未知人物')
      return { title: normalized.title, text: renderState(normalized.state as FlyingChessWorldState, normalized.events, context) }
    },
    projectForDirector(snapshot, context) {
      const normalized = this.normalize(snapshot, context)
      return { title: normalized.title, text: renderState(normalized.state as FlyingChessWorldState, normalized.events, context) }
    },
  }
}
