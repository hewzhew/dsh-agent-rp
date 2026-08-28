/** Durable per-Session choice between compatibility dialogue and native Agent turns. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { appendAgentRpSessionEvent } from './session-event-append.ts'

/** Compatibility dialogue preserves author-defined output formats; Agent turns use runtime actions. */
export type RoleplayTurnMode = 'conversation' | 'agent'

/** One authoritative turn-mode selection reconstructed from the Session log. */
export interface RoleplayTurnModeRecord {
  readonly format: 0
  readonly mode: RoleplayTurnMode
  readonly source: 'default' | 'user'
  /** Exact user command that selected this mode. */
  readonly sourceEventSeq?: number
}

/** Private browser request for changing the active turn mode. */
export interface RoleplayTurnModeCommandRequest {
  readonly format: 0
  readonly mode: RoleplayTurnMode
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Required capability selection that changes later model-visible tools and prompts. */
    'agent-rp/turn-mode': RoleplayTurnModeRecord
  }
}

function mode(value: unknown): RoleplayTurnMode {
  if (value !== 'conversation' && value !== 'agent') throw new Error('Roleplay turn mode is invalid')
  return value
}

/** Parse one private player request without accepting implicit authority fields. */
export function parseRoleplayTurnModeCommandRequest(source: string): RoleplayTurnModeCommandRequest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error: unknown) {
    throw new Error('回合方式请求不是有效 JSON', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('回合方式请求必须是对象')
  }
  const record = value as Record<string, unknown>
  if (record.format !== 0 || Object.keys(record).some(key => !['format', 'mode'].includes(key))) {
    throw new Error('回合方式请求字段无效')
  }
  return { format: 0, mode: mode(record.mode) }
}

/** Validate one borrowed durable turn-mode record. */
export function parseRoleplayTurnModeRecord(value: unknown): RoleplayTurnModeRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Roleplay turn mode record must be an object')
  }
  const record = value as Record<string, unknown>
  if (record.format !== 0 || (record.source !== 'default' && record.source !== 'user')
    || Object.keys(record).some(key => !['format', 'mode', 'source', 'sourceEventSeq'].includes(key))) {
    throw new Error('Roleplay turn mode record fields are invalid')
  }
  const sourceEventSeq = record.sourceEventSeq
  if (record.source === 'user'
    ? !Number.isSafeInteger(sourceEventSeq) || Number(sourceEventSeq) < 0
    : sourceEventSeq !== undefined) {
    throw new Error('Roleplay turn mode attribution is invalid')
  }
  return {
    format: 0,
    mode: mode(record.mode),
    source: record.source,
    ...(sourceEventSeq === undefined ? {} : { sourceEventSeq: Number(sourceEventSeq) }),
  }
}

function verifyUserSelection(events: readonly SessionEvent[], event: SessionEvent<'agent-rp/turn-mode'>): void {
  const record = parseRoleplayTurnModeRecord(event.data)
  if (record.source !== 'user') return
  const source = events[record.sourceEventSeq!]
  if (source?.type !== 'command/run' || source.seq >= event.seq || source.data.name !== 'rp-turn-mode'
    || source.data.source.kind !== 'user' || typeof source.data.args !== 'string') {
    throw new Error('Roleplay turn mode has no matching player command')
  }
  const request = parseRoleplayTurnModeCommandRequest(source.data.args)
  if (request.mode !== record.mode) throw new Error('Roleplay turn mode does not match its player command')
}

/** Fold the latest capability selection; old logs remain compatibility dialogue until initialized. */
export function readRoleplayTurnMode(events: readonly SessionEvent[]): RoleplayTurnMode {
  let current: RoleplayTurnMode = 'conversation'
  for (const event of events) {
    if (event.type !== 'agent-rp/turn-mode') continue
    verifyUserSelection(events, event)
    current = parseRoleplayTurnModeRecord(event.data).mode
  }
  return current
}

/** Initialize a Session once without rewriting an explicit player choice. */
export function ensureDefaultRoleplayTurnMode(session: Session, value: RoleplayTurnMode): void {
  if (session.events.some(event => event.type === 'agent-rp/turn-mode')) return
  appendAgentRpSessionEvent(session, 'agent-rp/turn-mode', { format: 0, mode: value, source: 'default' })
}

/** Append one player-authorized mode selection tied to its private command. */
export function appendUserRoleplayTurnMode(
  session: Session,
  request: RoleplayTurnModeCommandRequest,
  sourceEventSeq: number,
): void {
  const source = session.events[sourceEventSeq]
  if (source?.type !== 'command/run' || source.data.name !== 'rp-turn-mode'
    || source.data.source.kind !== 'user' || typeof source.data.args !== 'string'
    || parseRoleplayTurnModeCommandRequest(source.data.args).mode !== request.mode) {
    throw new Error('回合方式命令不是当前 Session 事件')
  }
  appendAgentRpSessionEvent(session, 'agent-rp/turn-mode', {
    format: 0,
    mode: request.mode,
    source: 'user',
    sourceEventSeq,
  })
}
