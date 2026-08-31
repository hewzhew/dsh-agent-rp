/** Durable Agent RP memory reconstructed from native tool events. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import { Session, SessionId, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

const PERSISTENT_MEMORY_INTENT = /(?:记住|记得|别忘|不要忘|以后|今后|下次|从现在起|remember|do(?:n['’]?t| not) forget|from now on|next time)/iu

/** Whether one direct user message explicitly asks for cross-turn retention. */
export function requestsPersistentMemory(message: UserMessage): boolean {
  if (message.source.kind !== 'user') return false
  const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  return PERSISTENT_MEMORY_INTENT.test(text)
}

/** Stable identity of one memory record inside a Session. */
export type AgentRpMemoryId = Branded<'AgentRpMemoryId'>

/** Supported reasons for retaining information across turns. */
export const AGENT_RP_MEMORY_KINDS = [
  'fact',
  'promise',
  'relationship',
  'preference',
  'event',
] as const

/** Semantic class of one durable memory. */
export type AgentRpMemoryKind = typeof AGENT_RP_MEMORY_KINDS[number]

/** One durable memory; corrections supersede rather than rewrite history. */
export interface AgentRpMemoryRecord {
  readonly version: 0
  readonly id: AgentRpMemoryId
  readonly kind: AgentRpMemoryKind
  readonly subject: string
  readonly text: string
  /** Exact `remember` call or private user command that created this record. */
  readonly sourceEventSeq: number
  /** Earlier active record replaced by this correction. */
  readonly supersedes?: AgentRpMemoryId
}

/** Input accepted after the model-facing tool schema has validated primitive types. */
export interface AgentRpMemoryInput {
  readonly kind: AgentRpMemoryKind
  readonly subject: string
  readonly text: string
  readonly supersedes?: string
}

/** Validated chronological and active views of one Session's memory log. */
export interface AgentRpMemoryHistory {
  readonly all: readonly AgentRpMemoryRecord[]
  readonly active: readonly AgentRpMemoryRecord[]
}

/** Minimal active-memory entry copied into a newly started Session. */
export interface AgentRpMemorySeedEntry {
  readonly kind: AgentRpMemoryKind
  readonly subject: string
  readonly text: string
}

/** Opt-in memory snapshot carried from an earlier Session of the same character. */
export interface AgentRpMemorySeedRecord {
  readonly format: 0
  readonly sourceSessionId: string
  readonly memories: readonly AgentRpMemorySeedEntry[]
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable active-memory snapshot explicitly carried into a new Roleplay Session. */
    'agent-rp/memory-seed': AgentRpMemorySeedRecord
  }
}

/** Browser request for adding, correcting, or forgetting persistent memory. */
export type AgentRpMemoryCommandRequest = {
  readonly format: 0
  readonly operation: 'add'
  readonly kind: AgentRpMemoryKind
  readonly subject: string
  readonly text: string
} | {
  readonly format: 0
  readonly operation: 'correct'
  readonly id: AgentRpMemoryId
  readonly kind: AgentRpMemoryKind
  readonly subject: string
  readonly text: string
} | {
  readonly format: 0
  readonly operation: 'forget'
  readonly id: AgentRpMemoryId
}

/** Durable result of one user-initiated memory command. */
export type AgentRpMemoryCommandRecord = AgentRpMemoryCommandRequest & {
  readonly sourceEventSeq: number
}

const SUBJECT_MAX_LENGTH = 120
const TEXT_MAX_LENGTH = 1_000
const MEMORY_ID_PATTERN = /^memory-(?:(?:0|[1-9]\d*)|seed-(?:0|[1-9]\d*)-(?:0|[1-9]\d*))$/u
const COMMAND_RESULT_PREFIX = 'agent-rp-memory-v0:'

/** Brand a validated memory id at the Session boundary. */
export function AgentRpMemoryId(value: string): AgentRpMemoryId {
  if (!MEMORY_ID_PATTERN.test(value)) throw new Error(`invalid Agent RP memory id ${JSON.stringify(value)}`)
  return value as AgentRpMemoryId
}

function normalizeText(value: string, field: string, maximum: number): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`Agent RP memory ${field} must contain non-whitespace text`)
  if (normalized.length > maximum) throw new Error(`Agent RP memory ${field} exceeds ${maximum} characters`)
  return normalized
}

function memorySubjectKey(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** Find another active record that already owns one stable topic. */
export function findAgentRpMemorySubjectConflict(
  active: readonly AgentRpMemoryRecord[],
  subject: string,
  replacing?: AgentRpMemoryId,
): AgentRpMemoryRecord | undefined {
  const key = memorySubjectKey(subject)
  return active.find(record => record.id !== replacing && memorySubjectKey(record.subject) === key)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}不是对象`)
  return value as Record<string, unknown>
}

function memoryCommandRequest(value: unknown): AgentRpMemoryCommandRequest {
  const record = object(value, '记忆操作请求')
  if (record.format !== 0) throw new Error('记忆操作请求字段无效')
  if (record.operation === 'add') {
    if (typeof record.kind !== 'string' || !AGENT_RP_MEMORY_KINDS.includes(record.kind as AgentRpMemoryKind)
      || typeof record.subject !== 'string' || typeof record.text !== 'string'
      || Object.keys(record).some(key => !['format', 'operation', 'kind', 'subject', 'text'].includes(key))) {
      throw new Error('记忆操作请求字段无效')
    }
    return {
      format: 0,
      operation: 'add',
      kind: record.kind as AgentRpMemoryKind,
      subject: normalizeText(record.subject, 'subject', SUBJECT_MAX_LENGTH),
      text: normalizeText(record.text, 'text', TEXT_MAX_LENGTH),
    }
  }
  if (typeof record.id !== 'string') throw new Error('记忆操作请求字段无效')
  const id = AgentRpMemoryId(record.id)
  if (record.operation === 'forget') {
    if (Object.keys(record).some(key => !['format', 'operation', 'id'].includes(key))) {
      throw new Error('记忆操作请求字段无效')
    }
    return { format: 0, operation: 'forget', id }
  }
  if (record.operation !== 'correct' || typeof record.kind !== 'string'
    || !AGENT_RP_MEMORY_KINDS.includes(record.kind as AgentRpMemoryKind)
    || typeof record.subject !== 'string' || typeof record.text !== 'string'
    || Object.keys(record).some(key => !['format', 'operation', 'id', 'kind', 'subject', 'text'].includes(key))) {
    throw new Error('记忆操作请求字段无效')
  }
  return {
    format: 0,
    operation: 'correct',
    id,
    kind: record.kind as AgentRpMemoryKind,
    subject: normalizeText(record.subject, 'subject', SUBJECT_MAX_LENGTH),
    text: normalizeText(record.text, 'text', TEXT_MAX_LENGTH),
  }
}

function memoryCommandMatches(
  request: AgentRpMemoryCommandRequest,
  command: AgentRpMemoryCommandRecord,
): boolean {
  if (request.operation !== command.operation) return false
  switch (request.operation) {
    case 'add':
      return command.operation === 'add' && request.kind === command.kind
        && request.subject === command.subject && request.text === command.text
    case 'correct':
      return command.operation === 'correct' && request.id === command.id && request.kind === command.kind
        && request.subject === command.subject && request.text === command.text
    case 'forget':
      return command.operation === 'forget' && request.id === command.id
  }
}

/** Validate one private user memory request. */
export function parseAgentRpMemoryCommandRequest(source: string): AgentRpMemoryCommandRequest {
  try {
    return memoryCommandRequest(JSON.parse(source))
  } catch (error: unknown) {
    if (error instanceof SyntaxError) throw new Error('记忆操作请求不是有效 JSON', { cause: error })
    throw error
  }
}

/** Serialize one user memory operation into the Session command log. */
export function encodeAgentRpMemoryCommandRecord(record: AgentRpMemoryCommandRecord): string {
  return `${COMMAND_RESULT_PREFIX}${JSON.stringify(record)}`
}

/** Decode one user memory operation while declining unrelated command output. */
export function decodeAgentRpMemoryCommandRecord(source: string | undefined): AgentRpMemoryCommandRecord | undefined {
  if (source?.startsWith(COMMAND_RESULT_PREFIX) !== true) return undefined
  let value: unknown
  try {
    value = JSON.parse(source.slice(COMMAND_RESULT_PREFIX.length))
  } catch (error: unknown) {
    throw new Error('记忆操作结果不是有效 JSON', { cause: error })
  }
  const record = object(value, '记忆操作结果')
  if (typeof record.sourceEventSeq !== 'number' || !Number.isSafeInteger(record.sourceEventSeq)
    || record.sourceEventSeq < 0) throw new Error('记忆操作结果来源无效')
  const request = memoryCommandRequest(Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'sourceEventSeq'),
  ))
  return { ...request, sourceEventSeq: record.sourceEventSeq }
}

function sourceCall(events: readonly SessionEvent[], record: AgentRpMemoryRecord): SessionEvent<'tool/call'> {
  if (!Number.isSafeInteger(record.sourceEventSeq) || record.sourceEventSeq < 0) {
    throw new Error('Agent RP memory sourceEventSeq must be a non-negative safe integer')
  }
  const source = events[record.sourceEventSeq]
  if (source?.type !== 'tool/call' || source.seq !== record.sourceEventSeq || source.data.name !== 'remember') {
    throw new Error(`Agent RP memory ${record.id} does not reference its direct remember tool call`)
  }
  return source
}

function sourceArguments(call: SessionEvent<'tool/call'>): AgentRpMemoryInput {
  let parsed: unknown
  try {
    parsed = JSON.parse(call.data.arguments)
  } catch {
    throw new Error(`Agent RP memory source call at seq ${call.seq} has invalid JSON arguments`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Agent RP memory source call at seq ${call.seq} has invalid arguments`)
  }
  const input = parsed as Record<string, unknown>
  if (typeof input.kind !== 'string' || !AGENT_RP_MEMORY_KINDS.includes(input.kind as AgentRpMemoryKind)
    || typeof input.subject !== 'string' || typeof input.text !== 'string'
    || (input.supersedes !== undefined && typeof input.supersedes !== 'string')) {
    throw new Error(`Agent RP memory source call at seq ${call.seq} has invalid arguments`)
  }
  return {
    kind: input.kind as AgentRpMemoryKind,
    subject: input.subject,
    text: input.text,
    ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
  }
}

function canonicalRecord(value: JsonValue, call: SessionEvent<'tool/call'>): AgentRpMemoryRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`remember result for call ${call.data.callId} has invalid canonical value`)
  }
  const record = value as Record<string, JsonValue>
  if (record.version !== 0 || typeof record.id !== 'string'
    || typeof record.kind !== 'string' || !AGENT_RP_MEMORY_KINDS.includes(record.kind as AgentRpMemoryKind)
    || typeof record.subject !== 'string' || typeof record.text !== 'string'
    || !Number.isSafeInteger(record.sourceEventSeq)
    || (record.supersedes !== undefined && typeof record.supersedes !== 'string')) {
    throw new Error(`remember result for call ${call.data.callId} has invalid canonical value`)
  }
  return {
    version: 0,
    id: AgentRpMemoryId(record.id),
    kind: record.kind as AgentRpMemoryKind,
    subject: record.subject,
    text: record.text,
    sourceEventSeq: record.sourceEventSeq as number,
    ...(record.supersedes === undefined ? {} : { supersedes: AgentRpMemoryId(record.supersedes) }),
  }
}

function parseCanonicalResult(
  result: SessionEvent<'tool/result'>,
  call: SessionEvent<'tool/call'>,
): JsonValue {
  const block = result.data.message.content[0]
  if (String(block.toolCallId) !== String(call.data.callId)
    || String(result.data.message.source.callId) !== String(call.data.callId)) {
    throw new Error(`remember result for call ${call.data.callId} has inconsistent call identity`)
  }
  if (result.sourceEventSeqs?.length !== 1 || result.sourceEventSeqs[0] !== call.seq) {
    throw new Error(`remember result for call ${call.data.callId} does not cite its direct tool call`)
  }
  if (block.content.length !== 1 || block.content[0]?.type !== 'text') {
    throw new Error(`remember result for call ${call.data.callId} has invalid canonical content`)
  }
  try {
    return JSON.parse(block.content[0].text) as JsonValue
  } catch {
    throw new Error(`remember result for call ${call.data.callId} has invalid canonical JSON`)
  }
}

function successfulRememberResults(events: readonly SessionEvent[]): Map<string, SessionEvent<'tool/result'>> {
  const rememberCallIds = new Set(events.flatMap(event => event.type === 'tool/call'
    && event.data.name === 'remember' ? [String(event.data.callId)] : []))
  const results = new Map<string, SessionEvent<'tool/result'>>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const block = event.data.message.content[0]
    if (block.isError === true || event.data.error !== undefined) continue
    const callId = String(block.toolCallId)
    if (!rememberCallIds.has(callId)) continue
    if (results.has(callId)) throw new Error(`tool call ${callId} has multiple successful results`)
    results.set(callId, event)
  }
  return results
}

function validateRecord(
  events: readonly SessionEvent[],
  call: SessionEvent<'tool/call'>,
  result: SessionEvent<'tool/result'>,
  active: Map<AgentRpMemoryId, AgentRpMemoryRecord>,
): AgentRpMemoryRecord {
  const record = canonicalRecord(parseCanonicalResult(result, call), call)
  const id = record.id
  sourceCall(events, record)
  const input = sourceArguments(call)
  if (record.sourceEventSeq !== call.seq || call.seq >= result.seq || id !== `memory-${call.seq}`) {
    throw new Error(`Agent RP memory ${record.id} has invalid source ordering or identity`)
  }
  normalizeText(record.subject, 'subject', SUBJECT_MAX_LENGTH)
  normalizeText(record.text, 'text', TEXT_MAX_LENGTH)
  if (record.subject !== record.subject.trim() || record.text !== record.text.trim()) {
    throw new Error(`Agent RP memory ${record.id} text is not normalized`)
  }
  if (record.kind !== input.kind
    || record.subject !== input.subject.trim()
    || record.text !== input.text.trim()
    || record.supersedes !== input.supersedes) {
    throw new Error(`Agent RP memory ${record.id} does not match its source call arguments`)
  }
  if (record.supersedes !== undefined) {
    const superseded = AgentRpMemoryId(record.supersedes)
    if (!active.delete(superseded)) {
      throw new Error(`Agent RP memory ${record.id} supersedes a missing or inactive record`)
    }
  }
  active.set(id, record)
  return record
}

function applyCommandRecord(
  events: readonly SessionEvent[],
  done: SessionEvent<'command/done'>,
  command: AgentRpMemoryCommandRecord,
  active: Map<AgentRpMemoryId, AgentRpMemoryRecord>,
): AgentRpMemoryRecord | undefined {
  const source = events[command.sourceEventSeq]
  if (source?.type !== 'command/run' || source.seq !== command.sourceEventSeq
    || source.data.name !== 'rp-memory' || String(source.data.commandId) !== String(done.data.commandId)) {
    throw new Error('记忆操作结果没有对应的命令来源')
  }
  // rp-memory deliberately sets recordInput:false, so the Host normally omits
  // command/run.args. The canonical command/done record remains replayable;
  // only perform the additional request/result comparison when an older or
  // explicitly recorded source actually carries the raw input.
  if (source.data.args !== undefined) {
    if (typeof source.data.args !== 'string') throw new Error('记忆操作请求记录无效')
    const request = parseAgentRpMemoryCommandRequest(source.data.args)
    if (!memoryCommandMatches(request, command)) throw new Error('记忆操作结果与请求不一致')
  }
  if (command.operation === 'add') {
    const conflict = findAgentRpMemorySubjectConflict([...active.values()], command.subject)
    if (conflict !== undefined) throw new Error(`记忆操作新增了重复主题 ${JSON.stringify(command.subject)}`)
    const added: AgentRpMemoryRecord = {
      version: 0,
      id: AgentRpMemoryId(`memory-${command.sourceEventSeq}`),
      kind: command.kind,
      subject: command.subject,
      text: command.text,
      sourceEventSeq: command.sourceEventSeq,
    }
    if (active.has(added.id)) throw new Error(`重复的 Agent RP 记忆编号 ${added.id}`)
    active.set(added.id, added)
    return added
  }
  if (!active.has(command.id)) throw new Error(`记忆操作引用了不存在或已失效的记录 ${JSON.stringify(command.id)}`)
  active.delete(command.id)
  if (command.operation === 'forget') return undefined
  const replacement: AgentRpMemoryRecord = {
    version: 0,
    id: AgentRpMemoryId(`memory-${command.sourceEventSeq}`),
    kind: command.kind,
    subject: command.subject,
    text: command.text,
    sourceEventSeq: command.sourceEventSeq,
    supersedes: command.id,
  }
  if (active.has(replacement.id)) throw new Error(`重复的 Agent RP 记忆编号 ${replacement.id}`)
  active.set(replacement.id, replacement)
  return replacement
}

function applySeedRecord(
  event: SessionEvent<'agent-rp/memory-seed'>,
  active: Map<AgentRpMemoryId, AgentRpMemoryRecord>,
): readonly AgentRpMemoryRecord[] {
  if (event.data.format !== 0 || event.data.sourceSessionId.trim() === '' || event.data.sourceSessionId.length > 512
    || !Array.isArray(event.data.memories) || event.data.memories.length > 1_000) {
    throw new Error('Agent RP 继承记忆事件无效')
  }
  return event.data.memories.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null
      || !AGENT_RP_MEMORY_KINDS.includes(entry.kind)
      || typeof entry.subject !== 'string' || typeof entry.text !== 'string') {
      throw new Error('Agent RP 继承记忆内容无效')
    }
    const subject = normalizeText(entry.subject, 'subject', SUBJECT_MAX_LENGTH)
    const text = normalizeText(entry.text, 'text', TEXT_MAX_LENGTH)
    if (subject !== entry.subject || text !== entry.text) throw new Error('Agent RP 继承记忆内容未规范化')
    const record: AgentRpMemoryRecord = {
      version: 0,
      id: AgentRpMemoryId(`memory-seed-${event.seq}-${index}`),
      kind: entry.kind,
      subject,
      text,
      sourceEventSeq: event.seq,
    }
    if (active.has(record.id)) throw new Error(`重复的 Agent RP 记忆编号 ${record.id}`)
    active.set(record.id, record)
    return record
  })
}

/**
 * Replay and validate all Agent RP memory records in one Session log.
 * @param events - complete chronological Session history.
 * @returns immutable chronological and currently active record lists.
 */
export function readAgentRpMemoryHistory(events: readonly SessionEvent[]): AgentRpMemoryHistory {
  const all: AgentRpMemoryRecord[] = []
  const active = new Map<AgentRpMemoryId, AgentRpMemoryRecord>()
  const results = successfulRememberResults(events)
  for (const event of events) {
    if (event.type === 'agent-rp/memory-seed') {
      all.push(...applySeedRecord(event, active))
      continue
    }
    if (event.type === 'tool/call' && event.data.name === 'remember') {
      const result = results.get(String(event.data.callId))
      if (result !== undefined) all.push(validateRecord(events, event, result, active))
      continue
    }
    if (event.type !== 'command/done' || event.data.kind !== 'success') continue
    const command = decodeAgentRpMemoryCommandRecord(event.data.text)
    if (command === undefined) continue
    const replacement = applyCommandRecord(events, event, command, active)
    if (replacement !== undefined) all.push(replacement)
  }
  return { all: Object.freeze(all), active: Object.freeze([...active.values()]) }
}

/** Append an opt-in active-memory snapshot to an otherwise complete new-Session seed. */
export function appendAgentRpMemorySeed(
  seed: readonly SessionEvent[],
  memories: readonly AgentRpMemoryRecord[],
  sourceSessionId: string,
): readonly SessionEvent[] {
  if (memories.length === 0) return seed
  if (sourceSessionId.trim() === '' || sourceSessionId.length > 512) throw new Error('来源角色会话编号无效')
  const time = Math.max(Date.now(), (seed.at(-1)?.time ?? 0) + 1)
  const events: SessionEvent[] = [...seed, {
    type: 'agent-rp/memory-seed',
    seq: seed.length,
    time,
    ignorable: true,
    data: {
      format: 0,
      sourceSessionId,
      memories: memories.map(memory => ({ kind: memory.kind, subject: memory.subject, text: memory.text })),
    },
  }]
  return Object.freeze(Session.create(SessionId('agent-rp-memory-seed-validation'), events).events.slice(0, events.length))
}

function findRememberCall(session: Session, callId: string): SessionEvent<'tool/call'> {
  const call = session.events.findLast(event => event.type === 'tool/call' && event.data.callId === callId)
  if (call?.type !== 'tool/call' || call.data.name !== 'remember') {
    throw new Error('remember execution has no matching direct Session tool call')
  }
  return call
}

/**
 * Prepare one normalized result for the current direct `remember` tool call.
 * @param session - Session that owns both source call and durable memory.
 * @param callId - execution call id recorded by the Agent loop.
 * @param input - model-selected memory content and optional correction target.
 * @returns the canonical record that the Agent loop persists as the tool result.
 */
export function prepareAgentRpMemory(
  session: Session,
  callId: string,
  input: AgentRpMemoryInput,
): AgentRpMemoryRecord {
  const history = readAgentRpMemoryHistory(session.events)
  const call = findRememberCall(session, callId)
  const sourceInput = sourceArguments(call)
  if (sourceInput.kind !== input.kind
    || sourceInput.subject !== input.subject
    || sourceInput.text !== input.text
    || sourceInput.supersedes !== input.supersedes) {
    throw new Error('remember execution arguments do not match its Session tool call')
  }
  const supersedes = input.supersedes === undefined ? undefined : AgentRpMemoryId(input.supersedes)
  if (supersedes !== undefined && !history.active.some(record => record.id === supersedes)) {
    throw new Error(`cannot supersede missing or inactive Agent RP memory ${JSON.stringify(supersedes)}`)
  }
  const subject = normalizeText(input.subject, 'subject', SUBJECT_MAX_LENGTH)
  const text = normalizeText(input.text, 'text', TEXT_MAX_LENGTH)
  const conflict = findAgentRpMemorySubjectConflict(history.active, subject, supersedes)
  if (conflict !== undefined) {
    throw new Error(`memory subject ${JSON.stringify(subject)} is already active as ${conflict.id}; use supersedes to update it`)
  }
  return {
    version: 0,
    id: AgentRpMemoryId(`memory-${call.seq}`),
    kind: input.kind,
    subject,
    text,
    sourceEventSeq: call.seq,
    ...(supersedes === undefined ? {} : { supersedes }),
  }
}
