/** Durable standalone World Info replay from native tool events. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { parseWorldInfoJson } from './world-info.ts'
import { WORLD_INFO_IMPORT_DEGRADATIONS } from './types.ts'
import type { ImportedWorldInfo, WorldInfoImportDegradation } from './types.ts'
import type { FileAttachmentRef } from './session-character.ts'
import { decodeWorldInfoLibraryImport } from '../world-info-library-protocol.ts'

/** Model-facing canonical value for one completed World Info import. */
export interface WorldInfoImportResult {
  readonly version: 0
  readonly name: string
  readonly sourceEventSeq: number
  readonly sourceAttachmentId: string
  readonly entryCount: number
  readonly degradations: WorldInfoImportDegradation[]
}

/** Execution-only import value projected into compact text and durable metadata. */
export interface WorldInfoImportValue extends WorldInfoImportResult {
  readonly raw: JsonValue
}

/** Replayable presentation metadata carrying the lossless World Info JSON. */
export interface WorldInfoImportMeta {
  readonly format: 0
  readonly result: WorldInfoImportResult
  readonly raw: JsonValue
}

/** One active standalone World Info book in a Session. */
export interface ActiveSessionWorldInfo {
  readonly result: WorldInfoImportResult
  readonly meta: WorldInfoImportMeta
  readonly worldInfo: ImportedWorldInfo
  /** Semantic owner used by the Roleplay runtime after transport parsing. */
  readonly placement: 'actor' | 'experience'
  /** Why this immutable snapshot was added to the Session. */
  readonly purpose: 'character-binding' | 'selected' | 'scenario'
}

/** Durable model-free activation of one Host-owned World Info source. */
export interface WorldInfoLibrarySeedRecord {
  readonly format: 0
  readonly worldInfoLibraryId: string
  readonly placement: 'actor' | 'experience'
  readonly purpose: 'character-binding' | 'selected' | 'scenario'
  readonly meta: WorldInfoImportMeta
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable World Info activation available before the Agent is constructed. */
    'agent-rp/world-info-library-seed': WorldInfoLibrarySeedRecord
  }
}

function jsonObject(value: JsonValue | undefined, label: string): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function parseResult(value: JsonValue | undefined): WorldInfoImportResult {
  const record = jsonObject(value, 'import_world_info result')
  if (record.version !== 0 || typeof record.name !== 'string' || record.name.trim().length === 0
    || typeof record.sourceEventSeq !== 'number' || !Number.isSafeInteger(record.sourceEventSeq)
    || typeof record.sourceAttachmentId !== 'string'
    || typeof record.entryCount !== 'number' || !Number.isSafeInteger(record.entryCount) || record.entryCount < 0
    || !Array.isArray(record.degradations)
    || record.degradations.some(value => typeof value !== 'string'
      || !WORLD_INFO_IMPORT_DEGRADATIONS.includes(value as WorldInfoImportDegradation))) {
    throw new Error('import_world_info result has invalid fields')
  }
  return record as unknown as WorldInfoImportResult
}

/** Parse replayable World Info metadata from a tool or private command result. */
export function parseWorldInfoImportMeta(value: JsonValue | undefined): WorldInfoImportMeta {
  const meta = jsonObject(value, 'import_world_info metadata')
  if (meta.format !== 0) throw new Error('import_world_info metadata has an unsupported format')
  const result = parseResult(meta.result)
  if (meta.raw === undefined) throw new Error('import_world_info metadata is missing raw data')
  return { format: 0, result, raw: meta.raw }
}

/** Recognize one standalone JSON file usable as a World Info transport. */
export function isJsonWorldInfoAttachment(value: unknown): value is FileAttachmentRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.kind === 'file' && typeof record.attachmentId === 'string'
    && typeof record.bytes === 'number' && typeof record.name === 'string' && /\.json$/iu.test(record.name)
    && (record.mediaType === undefined || typeof record.mediaType === 'string')
}

function sourceAttachments(events: readonly SessionEvent[], sourceEventSeq: number): FileAttachmentRef[] {
  const source = events[sourceEventSeq]
  if (source?.type !== 'user/message' || source.seq !== sourceEventSeq || source.data.source.kind !== 'user') {
    throw new Error('import_world_info sourceEventSeq does not reference a user message')
  }
  const sourceMeta = source.data.source as unknown as Record<string, JsonValue>
  const attachments = sourceMeta.attachmentConsumer === 'dsh-agent-rp' && Array.isArray(sourceMeta.attachments)
    ? sourceMeta.attachments
    : []
  return attachments.filter(isJsonWorldInfoAttachment) as unknown as FileAttachmentRef[]
}

function validateImport(events: readonly SessionEvent[], resultEvent: SessionEvent<'tool/result'>): ActiveSessionWorldInfo {
  const meta = parseWorldInfoImportMeta(resultEvent.data.meta)
  const result = meta.result
  const worldInfo = parseWorldInfoJson(JSON.stringify(meta.raw))
  const call = resultEvent.sourceEventSeqs?.length === 1 ? events[resultEvent.sourceEventSeqs[0]!] : undefined
  if (call?.type !== 'tool/call' || call.data.name !== 'import_world_info'
    || call.seq >= resultEvent.seq
    || String(call.data.callId) !== String(resultEvent.data.message.content[0].toolCallId)) {
    throw new Error('import_world_info result does not cite its direct tool call')
  }
  let callArguments: unknown
  try {
    callArguments = JSON.parse(call.data.arguments)
  } catch {
    throw new Error('import_world_info source call has invalid JSON arguments')
  }
  if (typeof callArguments !== 'object' || callArguments === null || Array.isArray(callArguments)) {
    throw new Error('import_world_info source call has invalid arguments')
  }
  const attachmentIndex = (callArguments as Record<string, unknown>).attachmentIndex ?? 0
  if (typeof attachmentIndex !== 'number' || !Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0) {
    throw new Error('import_world_info source call has an invalid attachmentIndex')
  }
  if (result.sourceEventSeq >= call.seq) throw new Error('import_world_info source attachment does not precede its tool call')
  const attachment = sourceAttachments(events, result.sourceEventSeq)[attachmentIndex]
  if (attachment === undefined || String(attachment.attachmentId) !== result.sourceAttachmentId) {
    throw new Error('import_world_info source attachment is absent from its user message')
  }
  const name = worldInfo.name?.trim() || attachment.name.replace(/\.json$/iu, '')
  // Degradations describe the importer version that wrote the event, not an immutable source fact.
  if (result.name !== name || result.entryCount !== worldInfo.lorebook.entries.length) {
    throw new Error('import_world_info result summary does not match durable metadata')
  }
  return {
    result,
    meta: { ...meta, raw: worldInfo.raw },
    worldInfo,
    placement: 'experience',
    purpose: 'selected',
  }
}

/** Resolve explicit or legacy placement metadata from one replayable library seed. */
export function worldInfoLibrarySeedSemantics(event: SessionEvent<'agent-rp/world-info-library-seed'>): {
  readonly placement: ActiveSessionWorldInfo['placement']
  readonly purpose: ActiveSessionWorldInfo['purpose']
} {
  const data = event.data as unknown as Record<string, unknown>
  const placement = data.placement === undefined ? 'experience' : data.placement
  const purpose = data.purpose === undefined
    ? (event.seq === 0 ? 'scenario' : 'selected')
    : data.purpose
  if ((placement !== 'actor' && placement !== 'experience')
    || (purpose !== 'character-binding' && purpose !== 'selected' && purpose !== 'scenario')
    || (purpose === 'character-binding' && placement !== 'actor')
    || (purpose === 'scenario' && placement !== 'experience')) {
    throw new Error('世界书启动种子的用途无效')
  }
  return { placement, purpose }
}

/**
 * Find and validate active standalone World Info books in one Session.
 * @param events - complete chronological Session history.
 * @returns successful imports in log order, with a repeated attachment replacing its prior import.
 */
export function readActiveSessionWorldInfos(events: readonly SessionEvent[]): ActiveSessionWorldInfo[] {
  const active = new Map<string, ActiveSessionWorldInfo>()
  for (const event of events) {
    if (event.type === 'agent-rp/world-info-library-seed') {
      if (event.data.format !== 0 || !/^world-info-[a-f0-9]{32}$/u.test(event.data.worldInfoLibraryId)) {
        throw new Error('世界书启动种子字段无效')
      }
      const expectedAttachment = `library:${event.data.worldInfoLibraryId}`
      const meta = parseWorldInfoImportMeta(event.data.meta as unknown as JsonValue)
      if (meta.result.sourceEventSeq !== event.seq || meta.result.sourceAttachmentId !== expectedAttachment) {
        throw new Error('世界书启动种子与来源不一致')
      }
      const worldInfo = parseWorldInfoJson(JSON.stringify(meta.raw))
      if (meta.result.name !== (worldInfo.name?.trim() || meta.result.name)
        || meta.result.entryCount !== worldInfo.lorebook.entries.length) {
        throw new Error('世界书启动种子与内容不一致')
      }
      const semantics = worldInfoLibrarySeedSemantics(event)
      active.set(expectedAttachment, { result: meta.result, meta, worldInfo, ...semantics })
      continue
    }
    if (event.type === 'command/done' && event.data.kind === 'success') {
      const direct = decodeWorldInfoLibraryImport(event.data.text)
      if (direct === undefined) continue
      const meta = parseWorldInfoImportMeta(direct.meta)
      const source = events[meta.result.sourceEventSeq]
      const expectedAttachment = `library:${direct.importId}`
      if (source?.type !== 'command/run' || source.data.name !== 'rp-world-info-import'
        || source.seq >= event.seq || String(source.data.commandId) !== String(event.data.commandId)
        || meta.result.sourceAttachmentId !== expectedAttachment) {
        throw new Error('世界书导入结果没有对应的命令来源')
      }
      const worldInfo = parseWorldInfoJson(JSON.stringify(meta.raw))
      if (meta.result.name !== (worldInfo.name?.trim() || meta.result.name)
        || meta.result.entryCount !== worldInfo.lorebook.entries.length) {
        throw new Error('世界书导入结果与来源不一致')
      }
      active.set(expectedAttachment, {
        result: meta.result,
        meta,
        worldInfo,
        placement: 'experience',
        purpose: 'selected',
      })
      continue
    }
    if (event.type !== 'tool/result' || event.data.message.content[0].isError === true) continue
    const callId = String(event.data.message.content[0].toolCallId)
    const call = events.find(candidate => candidate.type === 'tool/call' && String(candidate.data.callId) === callId)
    if (call?.type !== 'tool/call' || call.data.name !== 'import_world_info') continue
    const imported = validateImport(events, event)
    active.set(imported.result.sourceAttachmentId, imported)
  }
  return [...active.values()]
}

/** Return the latest marker proving this Session was deliberately started from standalone World Info. */
export function readWorldInfoLibrarySessionSeed(
  events: readonly SessionEvent[],
): WorldInfoLibrarySeedRecord | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'agent-rp/world-info-library-seed'
      && worldInfoLibrarySeedSemantics(event).purpose === 'scenario') return event.data
  }
  return undefined
}

/**
 * Build the canonical World Info summary associated with its source file.
 * @param worldInfo - parsed standalone World Info.
 * @param sourceEventSeq - exact user message carrying the attachment.
 * @param attachment - matching durable JSON attachment.
 * @returns compact canonical tool result plus lossless raw JSON.
 */
export function prepareWorldInfoImportResult(
  worldInfo: ImportedWorldInfo,
  sourceEventSeq: number,
  attachment: FileAttachmentRef,
): WorldInfoImportValue {
  const name = worldInfo.name?.trim() || attachment.name.replace(/\.json$/iu, '')
  if (name.trim().length === 0) throw new Error('World Info attachment must have a non-empty filename or name')
  return {
    version: 0,
    name,
    sourceEventSeq,
    sourceAttachmentId: String(attachment.attachmentId),
    entryCount: worldInfo.lorebook.entries.length,
    degradations: [...worldInfo.degradations],
    raw: worldInfo.raw,
  }
}
