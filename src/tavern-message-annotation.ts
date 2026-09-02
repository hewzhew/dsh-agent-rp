/** Replayable per-message compatibility fields owned by isolated Tavern Helper scripts. */

import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { decodeGenerationCommandResult } from './generation-command-result.ts'
import { appendAgentRpSessionEvent } from './session-event-append.ts'
import { tavernScriptIdentity, type TavernScriptScope } from './tavern-script-identity.ts'

export type TavernMessageAnnotationValue = Readonly<Record<string, JsonValue>>

/** Host-owned script namespace for one set of SillyTavern message root fields. */
export interface TavernMessageAnnotationOwner {
  readonly scriptScope: TavernScriptScope
  readonly scriptId: string
}

/** Complete annotation namespace selected for one durable transcript message. */
export interface TavernMessageAnnotationRecord {
  readonly format: 0
  readonly messageSeq: number
  readonly owner: TavernMessageAnnotationOwner
  readonly value: TavernMessageAnnotationValue
}

/** Latest annotation record for every `(message event, script owner)` pair. */
export type TavernMessageAnnotationState = Readonly<Record<string, TavernMessageAnnotationRecord>>

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** @mode event Script-owned SillyTavern message root fields bound to one transcript event. */
    'agent-rp/tavern-message-annotation': TavernMessageAnnotationRecord
  }
}

const COMMAND_RESULT_PREFIX = 'agent-rp-tavern-message-annotations-v0:'
const MAX_ANNOTATED_MESSAGES_PER_OWNER = 10_000
const MAX_ANNOTATION_STATE_BYTES = 64 * 1024 * 1024

function jsonRecord(value: unknown, label: string): TavernMessageAnnotationValue {
  const snapshot = snapshotJsonValue(value) as JsonValue | undefined
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return snapshot
}

function owner(value: unknown): TavernMessageAnnotationOwner {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Tavern message annotation owner is invalid')
  }
  const candidate = value as Record<string, unknown>
  if ((candidate.scriptScope !== 'global' && candidate.scriptScope !== 'preset'
      && candidate.scriptScope !== 'character')
    || typeof candidate.scriptId !== 'string' || candidate.scriptId === '' || candidate.scriptId.length > 512) {
    throw new Error('Tavern message annotation owner is invalid')
  }
  return { scriptScope: candidate.scriptScope, scriptId: candidate.scriptId }
}

/** Validate one record recovered from an event or fallback command result. */
export function parseTavernMessageAnnotationRecord(value: unknown): TavernMessageAnnotationRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Tavern message annotation record is invalid')
  }
  const candidate = value as Record<string, unknown>
  if (candidate.format !== 0 || !Number.isSafeInteger(candidate.messageSeq) || Number(candidate.messageSeq) < 0) {
    throw new Error('Tavern message annotation record is invalid')
  }
  return {
    format: 0,
    messageSeq: Number(candidate.messageSeq),
    owner: owner(candidate.owner),
    value: jsonRecord(candidate.value, 'Tavern message annotation value'),
  }
}

/** Collision-free state key for a message event and its Host-authenticated script owner. */
export function tavernMessageAnnotationKey(
  messageSeq: number,
  annotationOwner: TavernMessageAnnotationOwner,
): string {
  return JSON.stringify([messageSeq, annotationOwner.scriptScope, annotationOwner.scriptId])
}

/** Apply complete namespace replacements; an empty object removes the namespace. */
export function applyTavernMessageAnnotationRecords(
  state: TavernMessageAnnotationState,
  records: readonly TavernMessageAnnotationRecord[],
): TavernMessageAnnotationState {
  if (records.length === 0) return state
  const next: Record<string, TavernMessageAnnotationRecord> = { ...state }
  for (const record of records) {
    const key = tavernMessageAnnotationKey(record.messageSeq, record.owner)
    if (Object.keys(record.value).length === 0) delete next[key]
    else next[key] = record
  }
  return next
}

/** Return every script namespace for one logical message, keyed by Host script identity. */
export function tavernMessageAnnotationsForMessage(
  state: TavernMessageAnnotationState,
  messageSeq: number,
): Readonly<Record<string, TavernMessageAnnotationValue>> {
  return indexTavernMessageAnnotations(state).get(messageSeq) ?? {}
}

/** Index the latest namespaces once when projecting a complete transcript. */
export function indexTavernMessageAnnotations(
  state: TavernMessageAnnotationState,
): ReadonlyMap<number, Readonly<Record<string, TavernMessageAnnotationValue>>> {
  const index = new Map<number, Record<string, TavernMessageAnnotationValue>>()
  for (const record of Object.values(state)) {
    const annotations = index.get(record.messageSeq) ?? {}
    annotations[tavernScriptIdentity(record.owner.scriptScope, record.owner.scriptId)] = record.value
    index.set(record.messageSeq, annotations)
  }
  return index
}

function annotationRecordsFromEvent(event: SessionEvent): readonly TavernMessageAnnotationRecord[] {
  if (event.type === 'agent-rp/tavern-message-annotation') {
    return [parseTavernMessageAnnotationRecord(event.data)]
  }
  if (event.type !== 'command/done' || event.data.kind !== 'success') return []
  return decodeTavernMessageAnnotationCommandResult(event.data.text)
}

/** Fold every current annotation namespace from the complete Session Log. */
export function readTavernMessageAnnotations(events: readonly SessionEvent[]): TavernMessageAnnotationState {
  let state: TavernMessageAnnotationState = {}
  for (const event of events) {
    let records: readonly TavernMessageAnnotationRecord[]
    try {
      records = annotationRecordsFromEvent(event)
    } catch {
      continue
    }
    const valid = records.filter(record => {
      const message = events[record.messageSeq]
      return record.messageSeq < event.seq && (message?.type === 'user/message' || message?.type === 'assistant/message')
    })
    state = applyTavernMessageAnnotationRecords(state, valid)
  }
  return state
}

/** Apply one matching Session event to projection-owned annotation state. */
export function applyTavernMessageAnnotationEvent(
  state: TavernMessageAnnotationState,
  event: SessionEvent,
): TavernMessageAnnotationState {
  try {
    return applyTavernMessageAnnotationRecords(
      state,
      annotationRecordsFromEvent(event).filter(record => record.messageSeq < event.seq),
    )
  } catch {
    return state
  }
}

/** Reject a replacement that would create an unbounded latest-state snapshot. */
export function validateTavernMessageAnnotationState(state: TavernMessageAnnotationState): void {
  const owners = new Map<string, number>()
  for (const record of Object.values(state)) {
    const identity = tavernScriptIdentity(record.owner.scriptScope, record.owner.scriptId)
    owners.set(identity, (owners.get(identity) ?? 0) + 1)
  }
  if ([...owners.values()].some(count => count > MAX_ANNOTATED_MESSAGES_PER_OWNER)) {
    throw new Error('Tavern message annotations exceed the per-script message limit')
  }
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_ANNOTATION_STATE_BYTES) {
    throw new Error('Tavern message annotations exceed the Session state limit')
  }
}

/** Persist validated records through the replay-safe plugin event seam. */
export function appendTavernMessageAnnotationRecords(
  session: Session,
  records: readonly TavernMessageAnnotationRecord[],
): readonly SessionSeq[] {
  return records.map(record => appendAgentRpSessionEvent(
    session,
    'agent-rp/tavern-message-annotation',
    record,
  ).seq)
}

/** Encode annotations into an ordinary command result for older official Hosts. */
export function encodeTavernMessageAnnotationCommandResult(
  records: readonly TavernMessageAnnotationRecord[],
): string {
  return `${COMMAND_RESULT_PREFIX}${JSON.stringify({ format: 0, records })}`
}

/** Decode fallback command persistence while declining unrelated command results. */
export function decodeTavernMessageAnnotationCommandResult(
  text: string | undefined,
): readonly TavernMessageAnnotationRecord[] {
  if (text?.startsWith(COMMAND_RESULT_PREFIX) !== true) return []
  const parsed = JSON.parse(text.slice(COMMAND_RESULT_PREFIX.length)) as Record<string, unknown>
  if (parsed.format !== 0 || !Array.isArray(parsed.records)) {
    throw new Error('Tavern message annotation command result is invalid')
  }
  return parsed.records.map(parseTavernMessageAnnotationRecord)
}

/** Resolve a generated surface clone to the reply-version event it presents. */
export function logicalTavernMessageSeq(events: readonly SessionEvent[], surfaceSeq: number): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    let generation: Record<string, unknown> | undefined
    try {
      generation = event.type === 'command/done' && event.data.kind === 'success'
        ? decodeGenerationCommandResult(event.data.text)
        : event.type === ('agent-rp/generation-state' as SessionEvent['type'])
          ? (event as SessionEvent & { readonly data: Record<string, unknown> }).data
          : undefined
    } catch {
      continue
    }
    if (generation?.surfaceSeq === surfaceSeq && Number.isSafeInteger(generation.selectedVersionSeq)
      && Number(generation.selectedVersionSeq) >= 0) return Number(generation.selectedVersionSeq)
  }
  return surfaceSeq
}
