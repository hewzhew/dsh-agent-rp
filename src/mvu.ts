/** Minimal persistent MVU state for imported Character Cards. */

import { snapshotJsonValue, type JsonValue, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { ImportedCharacterCard, ImportedLorebook } from './import/types.ts'
import { appendAgentRpSessionEvent } from './session-event-append.ts'
import type { RoleplayTurnSettlementContribution } from './roleplay-runtime.ts'
import { decodeActiveTavernHelperState } from './tavern-helper.ts'
import { decodeGenerationMvuCheckpoint } from './generation-command-result.ts'
import {
  substituteSillyTavernIdentityMacros,
  type SillyTavernIdentityMacroValues,
} from './sillytavern-identity-macro.ts'

export const MVU_ROLEPLAY_MODULE_ID = 'adapter:mvu'
export const MVU_ROLEPLAY_STATE_ID = 'state:mvu'

/** Semantic state operation shared by legacy MVU blocks and native Agent actions. */
export interface MvuStateOperation {
  readonly op: 'replace' | 'delta' | 'insert' | 'remove' | 'move'
  readonly path?: string
  readonly from?: string
  readonly to?: string
  readonly value?: JsonValue
}

/** Complete MVU state selected for one visible reply version. */
export interface MvuStateSnapshot {
  readonly statData: JsonValue
  readonly updateCount: number
  readonly lastError?: string
  /** Causal settlement record for a native Agent state action. */
  readonly source?: {
    readonly kind: 'agent-action'
    readonly turn: number
    readonly resultEventSeqs: readonly number[]
  }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** @mode event Complete MVU state selected for the active reply version. */
    'agent-rp/mvu-state': MvuStateSnapshot
  }
}

function jsonRecord(value: JsonValue): Record<string, JsonValue> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function unwrapInitializer(content: string): string {
  const tagged = content.match(/<initvar>\s*([\s\S]*?)\s*<\/initvar>/iu)?.[1]
  const source = tagged ?? content
  return source.trim().match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/u)?.[1] ?? source
}

function orderedLorebookEntries(lorebooks: readonly ImportedLorebook[]) {
  return lorebooks.flatMap(lorebook => [...lorebook.entries]
    .sort((left, right) => left.insertionOrder - right.insertionOrder))
}

function initializerContents(lorebooks: readonly ImportedLorebook[]): string[] {
  return orderedLorebookEntries(lorebooks)
    .flatMap(entry => {
      const tagged = /<initvar>[\s\S]*?<\/initvar>/iu.test(entry.content)
      const named = /\[initvar\]/iu.test(`${entry.comment ?? ''}\n${entry.name ?? ''}`)
      if (!tagged && !named) return []
      const content = unwrapInitializer(entry.content).trim()
      return content === '' ? [] : [content]
    })
}

function mergeInitialRecord(target: Record<string, JsonValue>, source: Record<string, JsonValue>): void {
  for (const [key, value] of Object.entries(source)) {
    const current = jsonRecord(target[key] as JsonValue)
    const incoming = jsonRecord(value)
    if (current !== undefined && incoming !== undefined) mergeInitialRecord(current, incoming)
    else target[key] = value
  }
}

/** Read and merge initial `stat_data` from the effective Session worlds. */
export function readInitialMvuStateFromLorebooks(
  lorebooks: readonly ImportedLorebook[],
): JsonValue | undefined {
  const contents = initializerContents(lorebooks)
  if (contents.length === 0) return undefined
  const merged: Record<string, JsonValue> = {}
  for (const content of contents) {
    const parsed: unknown = parseYaml(content, { maxAliasCount: 100 })
    const snapshot = snapshotJsonValue(parsed) as JsonValue | undefined
    const record = snapshot === undefined ? undefined : jsonRecord(snapshot)
    if (record === undefined) {
      throw new Error('Character Card MVU initializer must contain one JSON-compatible object')
    }
    mergeInitialRecord(merged, record)
  }
  return merged
}

/** Read an imported card initializer before it has been materialized as Session worlds. */
export function readInitialMvuState(card: ImportedCharacterCard): JsonValue | undefined {
  return readInitialMvuStateFromLorebooks(card.lorebook === undefined ? [] : [card.lorebook])
}

/** Fold the latest durable MVU snapshot over the effective Session worlds. */
export function readCurrentMvuStateFromLorebooks(
  lorebooks: readonly ImportedLorebook[],
  events: readonly SessionEvent[],
): MvuStateSnapshot | undefined {
  let statData = readInitialMvuStateFromLorebooks(lorebooks)
  let updateCount = 0
  let lastError: string | undefined
  let source: MvuStateSnapshot['source']
  for (const event of events) {
    if (event.type === 'agent-rp/mvu-state') {
      statData = event.data.statData
      updateCount = event.data.updateCount
      lastError = event.data.lastError
      source = event.data.source
      continue
    }
    if (event.type === 'command/done' && event.data.kind === 'success') {
      const checkpoint = decodeGenerationMvuCheckpoint(event.data.text)
      const surface = checkpoint === undefined
        ? undefined
        : events.find(candidate => candidate.seq === checkpoint.surfaceSeq)
      if (surface?.type === 'assistant/message') {
        statData = checkpoint!.mvu.statData
        updateCount = checkpoint!.mvu.updateCount
        lastError = checkpoint!.mvu.lastError
        source = undefined
        continue
      }
    }
    if (event.type === 'agent-rp/tavern-state' || event.type === 'agent-rp/tavern-state-attachment'
      || (event.type === 'command/done' && event.data.kind === 'success')) {
      const scriptState = event.type === 'agent-rp/tavern-state'
        ? event.data
        : event.type === 'agent-rp/tavern-state-attachment'
          ? event.data.active ? event.data.state : undefined
          : decodeActiveTavernHelperState(event.data.text)
      const scope = scriptState?.lastMutation?.scope
      if (scriptState !== undefined && (scope === 'message' || scope === 'chat')) {
        const variables = scriptState.scopes[scope]
        const replacement = variables.stat_data
        if (replacement !== undefined && jsonRecord(replacement) !== undefined) {
          const initializing = statData === undefined
          statData = replacement
          if (!initializing) updateCount += 1
          lastError = undefined
          source = undefined
        }
      }
      continue
    }
    if (event.type !== 'assistant/message' || statData === undefined) continue
    const text = event.data.message.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('\n')
    if (!/<UpdateVariable(?:variable)?>/iu.test(text)) continue
    source = undefined
    try {
      const update = applyMvuReply(statData, text)
      if (update === undefined) continue
      statData = update.statData
      updateCount += 1
      lastError = undefined
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  if (statData === undefined) return undefined
  return {
    statData,
    updateCount,
    ...(lastError === undefined ? {} : { lastError }),
    ...(source === undefined ? {} : { source }),
  }
}

/** Fold MVU state for an imported card before world-resource materialization. */
export function readCurrentMvuState(
  card: ImportedCharacterCard,
  events: readonly SessionEvent[],
): MvuStateSnapshot | undefined {
  return readCurrentMvuStateFromLorebooks(card.lorebook === undefined ? [] : [card.lorebook], events)
}

/** Append an exact MVU state selection after a reply-version surface change. */
export function appendMvuState(
  session: Session,
  state: MvuStateSnapshot,
): SessionEvent<'agent-rp/mvu-state'> {
  return appendAgentRpSessionEvent(session, 'agent-rp/mvu-state', state)
}

/** Fold MVU updates from the current model-visible Session surface plus durable script mutations. */
export function readCurrentSessionMvuState(
  card: ImportedCharacterCard,
  session: Session,
): ReturnType<typeof readCurrentMvuState> {
  return readCurrentSessionMvuStateFromLorebooks(
    card.lorebook === undefined ? [] : [card.lorebook],
    session,
  )
}

/** Fold MVU updates from the visible surface over the effective Session worlds. */
export function readCurrentSessionMvuStateFromLorebooks(
  lorebooks: readonly ImportedLorebook[],
  session: Session,
): ReturnType<typeof readCurrentMvuStateFromLorebooks> {
  const surface = new Set(session.surface.nodes)
  return readCurrentMvuStateFromLorebooks(lorebooks, session.events.filter(event =>
    event.type !== 'assistant/message' || surface.has(event.seq)))
}

/** Report a visible MVU patch failure at the exact completed-turn boundary. */
export function mvuTurnSettlementContribution(input: {
  readonly session: Session
  readonly turn: number
  readonly firstSeq: number
  readonly state?: MvuStateSnapshot
}): RoleplayTurnSettlementContribution | undefined {
  const error = input.state?.lastError
  if (error === undefined) return undefined
  if (input.state?.source?.kind === 'agent-action' && input.state.source.turn === input.turn) {
    return { moduleId: MVU_ROLEPLAY_MODULE_ID, outcome: 'failed', error }
  }
  const visible = new Set(input.session.surface.nodes)
  const failedThisTurn = input.session.events.some(event => event.seq >= input.firstSeq
    && event.type === 'assistant/message' && event.data.turn === input.turn && visible.has(event.seq)
    && /<UpdateVariable(?:variable)?>/iu.test(event.data.message.content
      .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')))
  return failedThisTurn
    ? { moduleId: MVU_ROLEPLAY_MODULE_ID, outcome: 'failed', error }
    : undefined
}

function pointerSegments(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return []
  if (!pointer.startsWith('/')) throw new Error(`MVU path must be a JSON Pointer: ${pointer}`)
  const segments = pointer.slice(1).split('/').map(segment => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'))
  return segments[0] === 'stat_data' ? segments.slice(1) : segments
}

function parentAt(root: JsonValue, pointer: string): { parent: Record<string, JsonValue> | JsonValue[]; key: string } {
  const segments = pointerSegments(pointer)
  const key = segments.pop()
  if (key === undefined) throw new Error('MVU operation cannot replace the stat_data root')
  let current: JsonValue = root
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) throw new Error(`MVU path does not exist: ${pointer}`)
      current = current[index]!
      continue
    }
    const record = jsonRecord(current)
    if (record === undefined || !(segment in record)) throw new Error(`MVU path does not exist: ${pointer}`)
    current = record[segment]!
  }
  const parent = Array.isArray(current) ? current : jsonRecord(current)
  if (parent === undefined) throw new Error(`MVU path parent is not a container: ${pointer}`)
  return { parent, key }
}

function arrayIndex(array: JsonValue[], key: string, append: boolean): number {
  if (append && key === '-') return array.length
  const index = Number(key)
  if (!Number.isSafeInteger(index) || index < 0 || index > array.length || (!append && index === array.length)) {
    throw new Error(`MVU array index is unavailable: ${key}`)
  }
  return index
}

function readAt(root: JsonValue, pointer: string): JsonValue {
  const { parent, key } = parentAt(root, pointer)
  if (Array.isArray(parent)) return parent[arrayIndex(parent, key, false)]!
  if (!(key in parent)) throw new Error(`MVU path does not exist: ${pointer}`)
  return parent[key]!
}

function removeAt(root: JsonValue, pointer: string): JsonValue {
  const { parent, key } = parentAt(root, pointer)
  if (Array.isArray(parent)) return parent.splice(arrayIndex(parent, key, false), 1)[0]!
  if (!(key in parent)) throw new Error(`MVU path does not exist: ${pointer}`)
  const value = parent[key]!
  delete parent[key]
  return value
}

function insertAt(root: JsonValue, pointer: string, value: JsonValue): void {
  const { parent, key } = parentAt(root, pointer)
  if (Array.isArray(parent)) {
    parent.splice(arrayIndex(parent, key, true), 0, value)
    return
  }
  if (key in parent) throw new Error(`MVU insert path already exists: ${pointer}`)
  parent[key] = value
}

function replaceAt(root: JsonValue, pointer: string, value: JsonValue): void {
  const { parent, key } = parentAt(root, pointer)
  if (Array.isArray(parent)) parent[arrayIndex(parent, key, false)] = value
  else {
    if (!(key in parent)) throw new Error(`MVU replace path does not exist: ${pointer}`)
    parent[key] = value
  }
}

/** Normalize one untrusted semantic operation into a detached JSON value. */
export function parseMvuStateOperation(value: unknown): MvuStateOperation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('MVU patch entries must be objects')
  const record = value as Record<string, unknown>
  if (record.op !== 'replace' && record.op !== 'delta' && record.op !== 'insert'
    && record.op !== 'remove' && record.op !== 'move') throw new Error(`Unsupported MVU operation: ${String(record.op)}`)
  if (record.path !== undefined && typeof record.path !== 'string') throw new Error('MVU operation path must be a string')
  if (record.from !== undefined && typeof record.from !== 'string') throw new Error('MVU move source must be a string')
  if (record.to !== undefined && typeof record.to !== 'string') throw new Error('MVU move destination must be a string')
  const snapshot = record.value === undefined ? undefined : snapshotJsonValue(record.value) as JsonValue | undefined
  if (record.value !== undefined && snapshot === undefined) throw new Error('MVU operation value must be JSON-compatible')
  return { op: record.op, ...(record.path === undefined ? {} : { path: record.path }), ...(record.from === undefined ? {} : { from: record.from }), ...(record.to === undefined ? {} : { to: record.to }), ...(snapshot === undefined ? {} : { value: snapshot }) }
}

function patchArrays(text: string): MvuStateOperation[][] {
  const openingCount = text.match(/<UpdateVariable(?:variable)?>/giu)?.length ?? 0
  const closingCount = text.match(/<\/UpdateVariable(?:variable)?>/giu)?.length ?? 0
  if (openingCount !== closingCount) throw new Error('UpdateVariable 缺少闭合标签')
  const blocks = [...text.matchAll(/<UpdateVariable(?:variable)?>\s*([\s\S]*?)\s*<\/UpdateVariable(?:variable)?>/giu)]
  if (blocks.length !== openingCount) throw new Error('UpdateVariable 结构无效')
  return blocks.map(match => {
    const body = match[1] ?? ''
    const jsonPatchOpeningCount = body.match(/<JSONPatch>/giu)?.length ?? 0
    const jsonPatchClosingCount = body.match(/<\/JSONPatch>/giu)?.length ?? 0
    if (jsonPatchOpeningCount !== jsonPatchClosingCount) throw new Error('JSONPatch 缺少闭合标签')
    if (jsonPatchOpeningCount !== 1) throw new Error('UpdateVariable 必须包含一个 JSONPatch')
    const encoded = body.match(/<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/iu)?.[1]
    if (encoded === undefined) throw new Error('JSONPatch 结构无效')
    const parsed: unknown = JSON.parse(encoded)
    if (!Array.isArray(parsed)) throw new Error('MVU JSONPatch must be an array')
    return parsed.map(parseMvuStateOperation)
  })
}

/** Apply semantic MVU operations atomically while the runtime computes final values. */
export function applyMvuOperations(
  current: JsonValue,
  operations: readonly MvuStateOperation[],
): { readonly statData: JsonValue; readonly appliedOperations: number } {
  const cloned = snapshotJsonValue(current) as JsonValue | undefined
  if (cloned === undefined) throw new Error('Current MVU state is not JSON-compatible')
  let count = 0
  for (const item of operations.map(parseMvuStateOperation)) {
    const path = item.path
    if (item.op === 'move') {
      const from = item.from
      const to = item.to ?? path
      if (from === undefined || to === undefined) throw new Error('MVU move requires from and to')
      insertAt(cloned, to, removeAt(cloned, from))
    } else if (item.op === 'remove') {
      if (path === undefined) throw new Error('MVU remove requires path')
      removeAt(cloned, path)
    } else if (item.op === 'insert') {
      if (path === undefined || item.value === undefined) throw new Error('MVU insert requires path and value')
      insertAt(cloned, path, item.value)
    } else if (item.op === 'replace') {
      if (path === undefined || item.value === undefined) throw new Error('MVU replace requires path and value')
      replaceAt(cloned, path, item.value)
    } else {
      if (path === undefined || typeof item.value !== 'number') throw new Error('MVU delta requires path and numeric value')
      const before = readAt(cloned, path)
      if (typeof before !== 'number') throw new Error(`MVU delta path is not numeric: ${path}`)
      replaceAt(cloned, path, before + item.value)
    }
    count += 1
  }
  return { statData: cloned, appliedOperations: count }
}

/** Apply every complete `<UpdateVariable>` JSON Patch block atomically. */
export function applyMvuReply(
  current: JsonValue,
  text: string,
): { readonly statData: JsonValue; readonly appliedOperations: number } | undefined {
  if (!/<UpdateVariable(?:variable)?>/iu.test(text)) return undefined
  const batches = patchArrays(text)
  let result = { statData: current, appliedOperations: 0 }
  for (const batch of batches) {
    const applied = applyMvuOperations(result.statData, batch)
    result = {
      statData: applied.statData,
      appliedOperations: result.appliedOperations + applied.appliedOperations,
    }
  }
  return result
}

/** Collect effective World-authored rules for a dedicated MVU update call. */
export function renderMvuUpdateInstructions(
  lorebooks: readonly ImportedLorebook[],
  statData: JsonValue,
  identity: SillyTavernIdentityMacroValues,
): string | undefined {
  const entries = orderedLorebookEntries(lorebooks).filter(entry => entry.enabled
    && !entry.hasDecorators
    && !/<%[\s\S]*?%>/u.test(entry.content)
    && /(?:变量更新规则|变量输出格式|<UpdateVariable>)/iu.test(entry.content))
  if (entries.length === 0) return undefined
  return entries
    .map(entry => substituteSillyTavernIdentityMacros(substituteMvuMacros(entry.content, statData), identity))
    .join('\n\n')
}

/** Collect a ten-choice contract from the effective Session worlds. */
export function renderChoiceInstructions(lorebooks: readonly ImportedLorebook[]): string | undefined {
  const symbols = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
  return orderedLorebookEntries(lorebooks)
    .filter(entry => entry.enabled
      && entry.constant
      && !entry.hasDecorators
      && !/<%[\s\S]*?%>/u.test(entry.content)
      && symbols.every(symbol => entry.content.includes(`<${symbol}>`) && entry.content.includes(`</${symbol}>`)))
    .map(entry => entry.content)
    .join('\n\n') || undefined
}

/** Normalize one complete card-authored ten-choice module. */
export function normalizeChoiceSupplement(raw: string): string | undefined {
  const symbols = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
  const choices = symbols.map(symbol => {
    const matches = [...raw.matchAll(new RegExp(`<${symbol}>\\s*([\\s\\S]*?)\\s*</${symbol}>`, 'gu'))]
    if (matches.length !== 1) return undefined
    const value = matches[0]?.[1]?.trim()
    return value === undefined || value.length === 0 || /<[①②③④⑤⑥⑦⑧⑨⑩]>/u.test(value)
      ? undefined
      : `<${symbol}>${value}</${symbol}>`
  })
  return choices.some(choice => choice === undefined) ? undefined : choices.join('\n')
}

/** Normalize a narrow model response to one complete, valid MVU block. */
export function normalizeMvuSupplement(current: JsonValue, raw: string): string | undefined {
  const fenced = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim()
  const complete = fenced.match(/<UpdateVariable(?:variable)?>[\s\S]*?<\/UpdateVariable(?:variable)>/iu)?.[0]
  const jsonPatch = fenced.match(/<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/iu)?.[1]
  let candidate = complete
  if (candidate === undefined && jsonPatch !== undefined) {
    candidate = `<UpdateVariable>\n<Analysis>Dedicated MVU state update.</Analysis>\n<JSONPatch>\n${jsonPatch}\n</JSONPatch>\n</UpdateVariable>`
  }
  if (candidate === undefined) {
    try {
      const parsed: unknown = JSON.parse(fenced)
      if (Array.isArray(parsed)) {
        candidate = `<UpdateVariable>\n<Analysis>Dedicated MVU state update.</Analysis>\n<JSONPatch>\n${JSON.stringify(parsed)}\n</JSONPatch>\n</UpdateVariable>`
      } else if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>
        const patch = record.json_patch ?? record.JSONPatch
        if (Array.isArray(patch)) {
          const analysis = typeof record.analysis === 'string' ? record.analysis : 'Dedicated MVU state update.'
          candidate = `<UpdateVariable>\n<Analysis>${analysis}</Analysis>\n<JSONPatch>\n${JSON.stringify(patch)}\n</JSONPatch>\n</UpdateVariable>`
        }
      }
    } catch {
      return undefined
    }
  }
  if (candidate === undefined) return undefined
  try {
    return applyMvuReply(current, candidate) === undefined ? undefined : candidate
  } catch {
    return undefined
  }
}

/** Replace the two MVU state macros used by compatible lorebook entries. */
export function substituteMvuMacros(text: string, statData: JsonValue | undefined): string {
  if (statData === undefined) return text
  const yaml = stringifyYaml(statData, { lineWidth: 0 }).trimEnd()
  const json = JSON.stringify(statData)
  return text
    .replace(/\{\{format_message_variable::stat_data\}\}/giu, yaml)
    .replace(/\{\{get_message_variable::stat_data\}\}/giu, json)
}
