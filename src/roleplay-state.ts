/** Durable native Roleplay state reconstructed from required Session events. */

import {
  type Session,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { appendAgentRpSessionEvent } from './session-event-append.ts'

/** Native lifecycle module that owns all source-neutral Roleplay state namespaces. */
export const ROLEPLAY_STATE_MODULE_ID = 'roleplay:state'

/** Durable writer identity reserved for explicit player commands. */
export const ROLEPLAY_STATE_USER_WRITER_ID = 'roleplay:user'

/** One authoritative state revision written to the Session log. */
export interface RoleplayStateRecord {
  readonly format: 0
  readonly id: string
  readonly revision: number
  /** Stable module authority; absent only on records written before ownership was introduced. */
  readonly ownerModuleId?: string
  /** Module or explicit host action that produced this revision. */
  readonly writerModuleId: string
  /** Exact `rp-state` command/run event for an explicit player edit. */
  readonly sourceEventSeq?: number
  readonly value: JsonValue
}

/** Current state plus the exact required event that established it. */
export interface RoleplayStateSnapshot extends RoleplayStateRecord {
  readonly ownerModuleId: string
  readonly eventSeq: number
}

/** Compare-and-set input for one explicit native state write. */
export interface WriteRoleplayStateInput {
  readonly id: string
  /** Zero creates a new namespace; later writes must match the current revision. */
  readonly expectedRevision: number
  readonly writerModuleId: string
  readonly value: JsonValue
}

/** Private browser request for one explicit player state edit. */
export interface RoleplayStateCommandRequest {
  readonly format: 0
  readonly operation: 'set'
  readonly id: string
  readonly expectedRevision: number
  readonly value: JsonValue
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Required native Roleplay state; skipping it would change later model-visible input. */
    'agent-rp/state': RoleplayStateRecord
  }
}

const STATE_ID_PATTERN = /^state:[\p{L}\p{N}](?:[\p{L}\p{N}._:/-]{0,126}[\p{L}\p{N}])?$/u
const MODULE_ID_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}._:/-]{0,158}[\p{L}\p{N}])?$/u

const ROLEPLAY_STATE_RESULT_PREFIX = 'agent-rp-state-v0:'

function identifier(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Roleplay ${label} is invalid: ${JSON.stringify(value)}`)
  }
  return value
}

function revision(value: unknown, allowZero: boolean): number {
  if (!Number.isSafeInteger(value) || (value as number) < (allowZero ? 0 : 1)) {
    throw new Error('Roleplay state revision is invalid')
  }
  return value as number
}

function stateValue(value: JsonValue): JsonValue {
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined) throw new Error('Roleplay state value must be lossless JSON')
  return snapshot
}

function eventSeq(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Roleplay state source event is invalid')
  }
  return value as number
}

/** Parse one private player request without accepting implicit authority fields. */
export function parseRoleplayStateCommandRequest(source: string): RoleplayStateCommandRequest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error: unknown) {
    throw new Error('状态操作请求不是有效 JSON', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('状态操作请求必须是对象')
  }
  const record = value as Record<string, unknown>
  if (record.format !== 0 || record.operation !== 'set'
    || Object.keys(record).some(key => !['format', 'operation', 'id', 'expectedRevision', 'value'].includes(key))
    || !Object.prototype.hasOwnProperty.call(record, 'value')) {
    throw new Error('状态操作请求字段无效')
  }
  return {
    format: 0,
    operation: 'set',
    id: identifier(record.id, 'state id', STATE_ID_PATTERN),
    expectedRevision: revision(record.expectedRevision, true),
    value: stateValue(record.value as JsonValue),
  }
}

/** Validate a borrowed durable record and detach its JSON value. */
export function parseRoleplayStateRecord(value: unknown): RoleplayStateRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Roleplay state record must be an object')
  }
  const record = value as Record<string, unknown>
  if (record.format !== 0
    || Object.keys(record).some(key => ![
      'format', 'id', 'revision', 'ownerModuleId', 'writerModuleId', 'sourceEventSeq', 'value',
    ].includes(key))
    || !Object.prototype.hasOwnProperty.call(record, 'value')) {
    throw new Error('Roleplay state record fields are invalid')
  }
  const ownerModuleId = record.ownerModuleId === undefined
    ? undefined
    : identifier(record.ownerModuleId, 'state owner module id', MODULE_ID_PATTERN)
  const writerModuleId = identifier(record.writerModuleId, 'state writer module id', MODULE_ID_PATTERN)
  const sourceEventSeq = record.sourceEventSeq === undefined ? undefined : eventSeq(record.sourceEventSeq)
  if (ownerModuleId === undefined && writerModuleId === ROLEPLAY_STATE_USER_WRITER_ID) {
    throw new Error('Roleplay player state write cannot use the legacy ownership format')
  }
  if (ownerModuleId !== undefined && writerModuleId !== ownerModuleId
    && writerModuleId !== ROLEPLAY_STATE_USER_WRITER_ID) {
    throw new Error(`Roleplay state ${String(record.id)} cannot be written by ${writerModuleId}`)
  }
  if (ownerModuleId !== undefined && writerModuleId === ROLEPLAY_STATE_USER_WRITER_ID
    ? sourceEventSeq === undefined
    : sourceEventSeq !== undefined) {
    throw new Error('Roleplay state writer attribution is invalid')
  }
  return {
    format: 0,
    id: identifier(record.id, 'state id', STATE_ID_PATTERN),
    revision: revision(record.revision, false),
    ...(ownerModuleId === undefined ? {} : { ownerModuleId }),
    writerModuleId,
    ...(sourceEventSeq === undefined ? {} : { sourceEventSeq }),
    value: stateValue(record.value as JsonValue),
  }
}

/** Encode a state revision into the owning private command's durable result. */
export function encodeRoleplayStateRecord(record: RoleplayStateRecord): string {
  return `${ROLEPLAY_STATE_RESULT_PREFIX}${JSON.stringify(parseRoleplayStateRecord(record))}`
}

/** Decode a state revision while declining unrelated command results. */
export function decodeRoleplayStateRecord(text: string | undefined): RoleplayStateRecord | undefined {
  if (text?.startsWith(ROLEPLAY_STATE_RESULT_PREFIX) !== true) return undefined
  return parseRoleplayStateRecord(JSON.parse(text.slice(ROLEPLAY_STATE_RESULT_PREFIX.length)))
}

function applyRoleplayStateRecord(
  states: readonly RoleplayStateSnapshot[],
  record: RoleplayStateRecord,
  writtenAt: number,
): readonly RoleplayStateSnapshot[] {
  const previous = states.find(state => state.id === record.id)
  const previousRevision = previous?.revision ?? 0
  if (record.revision !== previousRevision + 1) {
    throw new Error(
      `Roleplay state ${record.id} revision is discontinuous: expected ${String(previousRevision + 1)}, received ${String(record.revision)}`,
    )
  }
  const ownerModuleId = record.ownerModuleId ?? previous?.ownerModuleId ?? record.writerModuleId
  if (record.ownerModuleId !== undefined && previous !== undefined
    && record.ownerModuleId !== previous.ownerModuleId) {
    throw new Error(`Roleplay state ${record.id} owner cannot change`)
  }
  const snapshot: RoleplayStateSnapshot = { ...record, ownerModuleId, eventSeq: writtenAt }
  return previous === undefined
    ? [...states, snapshot]
    : states.map(state => state.id === record.id ? snapshot : state)
}

/** Incrementally apply one required state event to a replay projection. */
export function applyRoleplayStateEvent(
  states: readonly RoleplayStateSnapshot[],
  event: SessionEvent,
): readonly RoleplayStateSnapshot[] {
  const record = event.type === 'agent-rp/state'
    ? parseRoleplayStateRecord(event.data)
    : event.type === 'command/done' && event.data.kind === 'success'
      ? decodeRoleplayStateRecord(event.data.text)
      : undefined
  return record === undefined ? states : applyRoleplayStateRecord(states, record, event.seq)
}

function verifyUserWrite(
  events: readonly SessionEvent[],
  event: SessionEvent,
  record: RoleplayStateRecord,
): void {
  if (record.writerModuleId !== ROLEPLAY_STATE_USER_WRITER_ID || record.ownerModuleId === undefined) return
  const source = record.sourceEventSeq === undefined
    ? undefined
    : events.find(candidate => candidate.seq === record.sourceEventSeq)
  if (source?.type !== 'command/run' || source.seq >= event.seq || source.data.name !== 'rp-state'
    || source.data.source.kind !== 'user' || typeof source.data.args !== 'string') {
    throw new Error('Roleplay player state write has no matching command source')
  }
  if (event.type === 'command/done' && String(event.data.commandId) !== String(source.data.commandId)) {
    throw new Error('Roleplay player state result does not match its command source')
  }
  const request = parseRoleplayStateCommandRequest(source.data.args)
  if (request.id !== record.id || request.expectedRevision + 1 !== record.revision
    || JSON.stringify(request.value) !== JSON.stringify(record.value)) {
    throw new Error('Roleplay player state write does not match its command source')
  }
}

/** Fold the latest valid revision of every native state namespace. */
export function readRoleplayStates(
  events: readonly SessionEvent[],
  beforeSeq = Number.POSITIVE_INFINITY,
): readonly RoleplayStateSnapshot[] {
  let current: readonly RoleplayStateSnapshot[] = []
  for (const event of events) {
    if (event.seq >= beforeSeq) continue
    const record = event.type === 'agent-rp/state'
      ? parseRoleplayStateRecord(event.data)
      : event.type === 'command/done' && event.data.kind === 'success'
        ? decodeRoleplayStateRecord(event.data.text)
        : undefined
    if (record === undefined) continue
    verifyUserWrite(events, event, record)
    current = applyRoleplayStateRecord(current, record, event.seq)
  }
  return current
}

/** Append one conflict-checked state revision as required Session history. */
export function appendRoleplayState(
  session: Session,
  input: WriteRoleplayStateInput,
): RoleplayStateSnapshot {
  const id = identifier(input.id, 'state id', STATE_ID_PATTERN)
  const expectedRevision = revision(input.expectedRevision, true)
  const writerModuleId = identifier(input.writerModuleId, 'state writer module id', MODULE_ID_PATTERN)
  const current = readRoleplayStates(session.events).find(state => state.id === id)
  const currentRevision = current?.revision ?? 0
  if (expectedRevision !== currentRevision) {
    throw new Error(
      `Roleplay state ${id} revision conflict: expected ${String(expectedRevision)}, current ${String(currentRevision)}`,
    )
  }
  const ownerModuleId = current?.ownerModuleId ?? writerModuleId
  if (writerModuleId !== ownerModuleId) {
    throw new Error(`Roleplay state ${id} is owned by ${ownerModuleId}, not ${writerModuleId}`)
  }
  const record: RoleplayStateRecord = {
    format: 0,
    id,
    revision: currentRevision + 1,
    ownerModuleId,
    writerModuleId,
    value: stateValue(input.value),
  }
  const event = appendAgentRpSessionEvent(session, 'agent-rp/state', record)
  return { ...event.data, ownerModuleId, eventSeq: event.seq }
}

/** Validate and prepare one player state revision without choosing its Host persistence seam. */
export function prepareUserRoleplayState(
  session: Session,
  request: RoleplayStateCommandRequest,
  sourceEventSeq: number,
): RoleplayStateRecord {
  const source = session.events[sourceEventSeq]
  if (source?.type !== 'command/run' || source.data.name !== 'rp-state' || typeof source.data.args !== 'string') {
    throw new Error('状态操作命令不是当前 Session 事件')
  }
  const sourceRequest = parseRoleplayStateCommandRequest(source.data.args)
  if (sourceRequest.id !== request.id || sourceRequest.expectedRevision !== request.expectedRevision
    || JSON.stringify(sourceRequest.value) !== JSON.stringify(request.value)) {
    throw new Error('状态操作请求与当前 Session 命令不一致')
  }
  const current = readRoleplayStates(session.events).find(state => state.id === request.id)
  const currentRevision = current?.revision ?? 0
  if (request.expectedRevision !== currentRevision) {
    throw new Error(
      `状态“${request.id}”已经变化：界面版本 ${String(request.expectedRevision)}，当前版本 ${String(currentRevision)}`,
    )
  }
  return {
    format: 0,
    id: request.id,
    revision: currentRevision + 1,
    ownerModuleId: current?.ownerModuleId ?? ROLEPLAY_STATE_USER_WRITER_ID,
    writerModuleId: ROLEPLAY_STATE_USER_WRITER_ID,
    sourceEventSeq,
    value: stateValue(request.value),
  }
}

/** Append a player-authorized edit that remains causally tied to its private command. */
export function appendUserRoleplayState(
  session: Session,
  request: RoleplayStateCommandRequest,
  sourceEventSeq: number,
): RoleplayStateSnapshot {
  const record = prepareUserRoleplayState(session, request, sourceEventSeq)
  const event = appendAgentRpSessionEvent(session, 'agent-rp/state', record)
  return { ...event.data, ownerModuleId: record.ownerModuleId!, eventSeq: event.seq }
}

/** Provider-neutral, read-only state context for one exact prepared turn. */
export function renderRoleplayStateContext(states: readonly RoleplayStateSnapshot[]): string {
  if (states.length === 0) return ''
  const payload = states.map(state => ({
    id: state.id,
    revision: state.revision,
    value: state.value,
  }))
  return [
    '当前角色扮演状态（本轮开始时的只读事实快照）：',
    '<roleplay_state>',
    JSON.stringify(payload, undefined, 2),
    '</roleplay_state>',
  ].join('\n')
}
