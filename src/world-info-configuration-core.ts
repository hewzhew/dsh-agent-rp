/** Pure World Info overlay parsing, persistence, and state transitions. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ImportedLorebook, ImportedLorebookEntry } from './import/types.ts'
import type { TavernHelperState, TavernWorldbookEntry } from './tavern-helper.ts'
import type {
  WorldInfoConfigurationRequest,
  WorldInfoConfigurationState,
  WorldInfoEditableEntry,
  WorldInfoEntryOverride,
} from './world-info-configuration-types.ts'

/** One immutable imported book addressable by the session overlay. */
export interface SessionLorebookSource {
  readonly id: string
  readonly name: string
  readonly source: 'character' | 'standalone'
  readonly lorebook: ImportedLorebook
  readonly degradations: readonly string[]
}

/** Resolve the SillyTavern primary character-world identity without consulting global or chat bindings. */
export function characterWorldInfoBookName(
  sources: readonly SessionLorebookSource[],
  state: Pick<TavernHelperState, 'worldbookBindings'> | undefined,
): string | undefined {
  const explicit = state?.worldbookBindings?.character
  const name = explicit === undefined
    ? sources.find(source => source.source === 'character')?.name
    : explicit.primary ?? undefined
  return name === undefined || name.trim() === '' ? undefined : name
}

function importedScriptEntry(entry: TavernWorldbookEntry): ImportedLorebookEntry {
  const logic = entry.strategy.keys_secondary.logic
  const position = entry.position.type === 'before_character_definition' ? 'before_char'
    : entry.position.type === 'after_character_definition' ? 'after_char'
      : entry.position.type === 'at_depth' ? 'at_depth' : 'after_char'
  const validAtDepth = position !== 'at_depth' || (
    Number.isSafeInteger(entry.position.depth) && entry.position.depth >= 0 && entry.position.depth <= 10_000
    && (entry.position.role === 'system' || entry.position.role === 'user' || entry.position.role === 'assistant')
  )
  const unsupportedPosition = !validAtDepth || (entry.position.type !== 'before_character_definition'
    && entry.position.type !== 'after_character_definition' && entry.position.type !== 'at_depth')
  return {
    sourceId: String(entry.uid),
    ...(entry.name === '' ? {} : { name: entry.name }),
    keys: entry.strategy.keys,
    secondaryKeys: entry.strategy.keys_secondary.keys,
    content: entry.content,
    enabled: entry.enabled && entry.probability > 0,
    insertionOrder: entry.position.order,
    selective: entry.strategy.type === 'selective',
    constant: entry.strategy.type === 'constant',
    caseSensitive: false,
    matchWholeWords: false,
    secondaryLogic: logic === 'and_all' ? 'and-all' : logic === 'not_all' ? 'not-all'
      : logic === 'not_any' ? 'not-any' : 'and-any',
    ...(entry.strategy.scan_depth === 'same_as_global' ? {} : { scanDepth: entry.strategy.scan_depth }),
    position,
    ...(position === 'at_depth' && validAtDepth ? {
      injectionDepth: entry.position.depth,
      injectionRole: entry.position.role,
    } : {}),
    priority: entry.position.order,
    ignoreBudget: entry.ignoreBudget === true,
    useRegex: false,
    hasDecorators: false,
    ...(unsupportedPosition ? { compatibilityBlockers: ['entry-unsupported-position' as const] } : {}),
  }
}

/** Convert one script-authored Tavern Helper book into the prompt runtime representation. */
export function tavernWorldbookLorebook(name: string, entries: readonly TavernWorldbookEntry[]): ImportedLorebook {
  return { name, recursiveScanning: false, entries: entries.map(importedScriptEntry) }
}

/** Apply script replacements, creations, and deletions without mutating imported sources. */
export function withTavernWorldbooks(
  sources: readonly SessionLorebookSource[],
  state: TavernHelperState | undefined,
): readonly SessionLorebookSource[] {
  if (state === undefined) return sources
  const deleted = new Set(state.deletedWorldbookNames ?? [])
  const replacements = state.worldbooks ?? {}
  const names = new Set<string>()
  const result = sources.flatMap(source => {
    names.add(source.name)
    if (deleted.has(source.name)) return []
    const entries = replacements[source.name]
    return [{ ...source, ...(entries === undefined ? {} : { lorebook: tavernWorldbookLorebook(source.name, entries) }) }]
  })
  for (const [name, entries] of Object.entries(replacements)) {
    if (names.has(name) || deleted.has(name)) continue
    result.push({ id: `script:${name}`, name, source: 'standalone', lorebook: tavernWorldbookLorebook(name, entries), degradations: [] })
  }
  return result
}

/** Select prompt-active books from the bindings scripts have explicitly changed. */
export function activeTavernWorldbooks(
  sources: readonly SessionLorebookSource[],
  state: TavernHelperState | undefined,
): readonly SessionLorebookSource[] {
  const bindings = state?.worldbookBindings
  if (bindings === undefined) return sources.filter(source => !source.id.startsWith('script:'))
  const active = new Set<string>()
  if (bindings.character === undefined) {
    for (const source of sources) if (source.source === 'character') active.add(source.name)
  } else {
    if (bindings.character.primary !== null) active.add(bindings.character.primary)
    for (const name of bindings.character.additional) active.add(name)
  }
  if (bindings.global === undefined) {
    for (const source of sources) {
      if (source.source === 'standalone' && !source.id.startsWith('script:')) active.add(source.name)
    }
  } else {
    for (const name of bindings.global) active.add(name)
  }
  if (bindings.chat !== undefined && bindings.chat !== null) active.add(bindings.chat)
  return sources.filter(source => active.has(source.name))
}

const RESULT_PREFIX = 'agent-rp-world-info-v0:'
const INITIAL_STATE: WorldInfoConfigurationState = { format: 0, revision: 0, overrides: [] }

/** Largest player-selected aggregate World Info cap accepted by the Session manager. */
export const MAX_SESSION_WORLD_INFO_TOKEN_BUDGET = 100_000

/** Resolve the optional player-selected aggregate cap; omission leaves final capacity to the model context. */
export function worldInfoTokenBudget(state: WorldInfoConfigurationState): number | undefined {
  return state.tokenBudget === undefined || state.tokenBudget === 0 ? undefined : state.tokenBudget
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label}必须是非负整数`)
  return value as number
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是有限数字`)
  return value
}

function optionalFinite(value: unknown, label: string): number | undefined {
  return value === undefined || value === null ? undefined : finite(value, label)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是文本`)
  return value
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : text(value, label)
}

function textArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label}必须是文本数组`)
  return [...value] as string[]
}

function editable(value: unknown, label: string): WorldInfoEditableEntry {
  const entry = object(value, label)
  const secondaryLogic = entry.secondaryLogic
  const position = entry.position
  if (secondaryLogic !== 'and-any' && secondaryLogic !== 'and-all'
    && secondaryLogic !== 'not-any' && secondaryLogic !== 'not-all') throw new Error(`${label}.secondaryLogic 无效`)
  if (position !== 'before_char' && position !== 'after_char' && position !== 'at_depth') {
    throw new Error(`${label}.position 无效`)
  }
  for (const key of ['enabled', 'selective', 'constant', 'caseSensitive', 'matchWholeWords', 'ignoreBudget'] as const) {
    if (typeof entry[key] !== 'boolean') throw new Error(`${label}.${key} 必须是布尔值`)
  }
  const scanDepth = optionalFinite(entry.scanDepth, `${label}.scanDepth`)
  if (scanDepth !== undefined && scanDepth < 0) throw new Error(`${label}.scanDepth 不能小于零`)
  const priority = optionalFinite(entry.priority, `${label}.priority`)
  const injectionDepth = optionalFinite(entry.injectionDepth, `${label}.injectionDepth`)
  const injectionRole = entry.injectionRole === 'system' || entry.injectionRole === 'user'
    || entry.injectionRole === 'assistant' ? entry.injectionRole : undefined
  let placement: Pick<WorldInfoEditableEntry, 'injectionDepth' | 'injectionRole'> | undefined
  if (position === 'at_depth') {
    if (typeof injectionDepth !== 'number' || !Number.isSafeInteger(injectionDepth)
      || injectionDepth < 0 || injectionDepth > 10_000) {
      throw new Error(`${label}.injectionDepth 必须是 0 到 10000 的整数`)
    }
    if (injectionRole === undefined) {
      throw new Error(`${label}.injectionRole 无效`)
    }
    placement = { injectionDepth, injectionRole }
  }
  const name = optionalText(entry.name, `${label}.name`)
  const comment = optionalText(entry.comment, `${label}.comment`)
  return {
    ...(name === undefined ? {} : { name }),
    ...(comment === undefined ? {} : { comment }),
    keys: textArray(entry.keys, `${label}.keys`),
    secondaryKeys: textArray(entry.secondaryKeys, `${label}.secondaryKeys`),
    content: text(entry.content, `${label}.content`),
    enabled: entry.enabled as boolean,
    insertionOrder: finite(entry.insertionOrder, `${label}.insertionOrder`),
    selective: entry.selective as boolean,
    constant: entry.constant as boolean,
    caseSensitive: entry.caseSensitive as boolean,
    matchWholeWords: entry.matchWholeWords as boolean,
    secondaryLogic,
    ...(scanDepth === undefined ? {} : { scanDepth }),
    position,
    ...(placement ?? {}),
    ...(priority === undefined ? {} : { priority }),
    ignoreBudget: entry.ignoreBudget as boolean,
  }
}

function target(record: Record<string, unknown>, label: string): { readonly bookId: string; readonly entryIndex: number } {
  const bookId = text(record.bookId, `${label}.bookId`)
  if (bookId.trim() === '') throw new Error(`${label}.bookId 不能为空`)
  return { bookId, entryIndex: nonNegativeInteger(record.entryIndex, `${label}.entryIndex`) }
}

function requestedBookId(record: Record<string, unknown>, label: string): string {
  const bookId = text(record.bookId, `${label}.bookId`)
  if (bookId.trim() === '') throw new Error(`${label}.bookId 不能为空`)
  return bookId
}

/** Parse one private World Info manager request. */
export function parseWorldInfoConfigurationRequest(source: string): WorldInfoConfigurationRequest {
  let value: unknown
  try { value = JSON.parse(source) } catch (error: unknown) {
    throw new Error('世界书操作请求不是有效 JSON', { cause: error })
  }
  const record = object(value, '世界书操作请求')
  const revision = nonNegativeInteger(record.revision, 'revision')
  if (record.operation === 'reset-all') return { operation: 'reset-all', revision }
  if (record.operation === 'set-budget') {
    const tokenBudget = nonNegativeInteger(record.tokenBudget, 'tokenBudget')
    if (tokenBudget > MAX_SESSION_WORLD_INFO_TOKEN_BUDGET) throw new Error('tokenBudget 过大')
    return { operation: 'set-budget', revision, tokenBudget }
  }
  if (record.operation === 'reset-book') {
    return { operation: 'reset-book', revision, bookId: requestedBookId(record, '世界书操作请求') }
  }
  if (record.operation === 'set-book-enabled') {
    if (typeof record.enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
    return {
      operation: 'set-book-enabled',
      revision,
      bookId: requestedBookId(record, '世界书操作请求'),
      enabled: record.enabled,
    }
  }
  const addressed = target(record, '世界书操作请求')
  if (record.operation === 'toggle') {
    if (typeof record.enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
    return { operation: 'toggle', revision, ...addressed, enabled: record.enabled }
  }
  if (record.operation === 'edit') return { operation: 'edit', revision, ...addressed, entry: editable(record.entry, 'entry') }
  if (record.operation === 'delete') {
    if (typeof record.deleted !== 'boolean') throw new Error('deleted 必须是布尔值')
    return { operation: 'delete', revision, ...addressed, deleted: record.deleted }
  }
  if (record.operation === 'reset-entry') return { operation: 'reset-entry', revision, ...addressed }
  throw new Error('未知的世界书操作')
}

function parseOverride(value: unknown, index: number): WorldInfoEntryOverride {
  const record = object(value, `overrides[${index}]`)
  const addressed = target(record, `overrides[${index}]`)
  if (typeof record.deleted !== 'boolean') throw new Error(`overrides[${index}].deleted 必须是布尔值`)
  return {
    ...addressed,
    deleted: record.deleted,
    ...(record.entry === undefined ? {} : { entry: editable(record.entry, `overrides[${index}].entry`) }),
  }
}

function parseState(value: unknown): WorldInfoConfigurationState {
  const record = object(value, '世界书配置')
  if (record.format !== 0 || !Array.isArray(record.overrides)) throw new Error('世界书配置格式无效')
  const parsed = record.overrides.map(parseOverride)
  const keys = parsed.map(item => `${item.bookId}\u0000${item.entryIndex}`)
  if (new Set(keys).size !== keys.length) throw new Error('世界书配置包含重复条目')
  const overrides = parsed.filter(item => item.deleted || item.entry !== undefined)
  const parsedTokenBudget = record.tokenBudget === undefined
    ? undefined : nonNegativeInteger(record.tokenBudget, 'tokenBudget')
  if (parsedTokenBudget !== undefined && parsedTokenBudget > MAX_SESSION_WORLD_INFO_TOKEN_BUDGET) {
    throw new Error('世界书配置 tokenBudget 过大')
  }
  const tokenBudget = parsedTokenBudget === 0 ? undefined : parsedTokenBudget
  return {
    format: 0,
    revision: nonNegativeInteger(record.revision, 'revision'),
    overrides,
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
  }
}

/** Encode one complete overlay snapshot into a supported command result. */
export function encodeWorldInfoConfiguration(state: WorldInfoConfigurationState): string {
  return `${RESULT_PREFIX}${JSON.stringify(state)}`
}

/** Decode one overlay snapshot, declining unrelated command output. */
export function decodeWorldInfoConfiguration(source: string | undefined): WorldInfoConfigurationState | undefined {
  if (source?.startsWith(RESULT_PREFIX) !== true) return undefined
  let value: unknown
  try { value = JSON.parse(source.slice(RESULT_PREFIX.length)) } catch (error: unknown) {
    throw new Error('世界书配置结果不是有效 JSON', { cause: error })
  }
  return parseState(value)
}

/** Read the last complete World Info overlay snapshot from one Session. */
export function readWorldInfoConfiguration(events: readonly SessionEvent[]): WorldInfoConfigurationState {
  let state = INITIAL_STATE
  for (const event of events) {
    if (event.type !== 'command/done' || event.data.kind !== 'success') continue
    state = decodeWorldInfoConfiguration(event.data.text) ?? state
  }
  return state
}

/** Extract the safe editable fields while retaining unsupported source fields separately. */
export function editableWorldInfoEntry(entry: ImportedLorebookEntry): WorldInfoEditableEntry {
  return {
    ...(entry.name === undefined ? {} : { name: entry.name }),
    ...(entry.comment === undefined ? {} : { comment: entry.comment }),
    keys: entry.keys,
    secondaryKeys: entry.secondaryKeys,
    content: entry.content,
    enabled: entry.enabled,
    insertionOrder: entry.insertionOrder,
    selective: entry.selective,
    constant: entry.constant,
    caseSensitive: entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords,
    secondaryLogic: entry.secondaryLogic,
    ...(entry.scanDepth === undefined ? {} : { scanDepth: entry.scanDepth }),
    position: entry.position,
    ...(entry.injectionDepth === undefined ? {} : { injectionDepth: entry.injectionDepth }),
    ...(entry.injectionRole === undefined ? {} : { injectionRole: entry.injectionRole }),
    ...(entry.priority === undefined ? {} : { priority: entry.priority }),
    ignoreBudget: entry.ignoreBudget,
  }
}

function applyEditable(entry: ImportedLorebookEntry, value: WorldInfoEditableEntry): ImportedLorebookEntry {
  return {
    sourceId: entry.sourceId,
    ...value,
    useRegex: entry.useRegex,
    hasDecorators: entry.hasDecorators,
    ...(entry.compatibilityBlockers === undefined ? {} : { compatibilityBlockers: entry.compatibilityBlockers }),
  }
}

/** Apply one session overlay while retaining deleted entries for management UI. */
export function configuredLorebook(
  source: SessionLorebookSource,
  state: WorldInfoConfigurationState,
): { readonly lorebook: ImportedLorebook; readonly deleted: ReadonlySet<number> } {
  const overrides = new Map(state.overrides.filter(item => item.bookId === source.id).map(item => [item.entryIndex, item]))
  const deleted = new Set<number>()
  const entries = source.lorebook.entries.map((entry, index) => {
    const override = overrides.get(index)
    if (override?.deleted === true) deleted.add(index)
    const configured = override?.entry === undefined ? entry : applyEditable(entry, override.entry)
    return override?.deleted === true ? { ...configured, enabled: false } : configured
  })
  return { lorebook: { ...source.lorebook, entries }, deleted }
}

function replaceOverride(
  state: WorldInfoConfigurationState,
  bookId: string,
  entryIndex: number,
  update: (current: WorldInfoEntryOverride) => WorldInfoEntryOverride | undefined,
): WorldInfoConfigurationState {
  const current = state.overrides.find(item => item.bookId === bookId && item.entryIndex === entryIndex)
    ?? { bookId, entryIndex, deleted: false }
  const updated = update(current)
  const next = updated?.deleted === false && updated.entry === undefined ? undefined : updated
  return {
    ...state,
    revision: state.revision + 1,
    overrides: [
      ...state.overrides.filter(item => item.bookId !== bookId || item.entryIndex !== entryIndex),
      ...(next === undefined ? [] : [next]),
    ],
  }
}

/** Apply one validated request against currently imported books. */
export function configureWorldInfo(
  state: WorldInfoConfigurationState,
  request: WorldInfoConfigurationRequest,
  sources: readonly SessionLorebookSource[],
): WorldInfoConfigurationState {
  if (request.revision !== state.revision) throw new Error('世界书已在别处改变，请刷新后重试')
  if (request.operation === 'reset-all') return { ...state, revision: state.revision + 1, overrides: [] }
  if (request.operation === 'set-budget') {
    if (request.tokenBudget === 0) {
      const { tokenBudget: _removed, ...withoutTokenBudget } = state
      return { ...withoutTokenBudget, revision: state.revision + 1 }
    }
    return { ...state, revision: state.revision + 1, tokenBudget: request.tokenBudget }
  }
  if (request.operation === 'reset-book') {
    if (!sources.some(source => source.id === request.bookId)) throw new Error('目标世界书不存在')
    return {
      ...state,
      revision: state.revision + 1,
      overrides: state.overrides.filter(item => item.bookId !== request.bookId),
    }
  }
  if (request.operation === 'set-book-enabled') {
    const source = sources.find(book => book.id === request.bookId)
    if (source === undefined) throw new Error('目标世界书不存在')
    const current = new Map(state.overrides.filter(item => item.bookId === request.bookId)
      .map(item => [item.entryIndex, item]))
    const overrides = source.lorebook.entries.flatMap((original, entryIndex) => {
      const prior = current.get(entryIndex) ?? { bookId: request.bookId, entryIndex, deleted: false }
      const entry = { ...(prior.entry ?? editableWorldInfoEntry(original)), enabled: request.enabled }
      const matchesOriginal = JSON.stringify(entry) === JSON.stringify(editableWorldInfoEntry(original))
      if (!prior.deleted && matchesOriginal) return []
      return [{
        bookId: request.bookId,
        entryIndex,
        deleted: prior.deleted,
        ...(matchesOriginal ? {} : { entry }),
      }]
    })
    return {
      ...state,
      revision: state.revision + 1,
      overrides: [
        ...state.overrides.filter(item => item.bookId !== request.bookId),
        ...overrides,
      ],
    }
  }
  const source = sources.find(book => book.id === request.bookId)
  const original = source?.lorebook.entries[request.entryIndex]
  if (source === undefined || original === undefined) throw new Error('目标世界书条目不存在')
  if (request.operation === 'reset-entry') {
    return replaceOverride(state, request.bookId, request.entryIndex, () => undefined)
  }
  if (request.operation === 'edit') {
    return replaceOverride(state, request.bookId, request.entryIndex, current => ({ ...current, entry: request.entry }))
  }
  if (request.operation === 'toggle') {
    return replaceOverride(state, request.bookId, request.entryIndex, current => ({
      ...current,
      entry: { ...(current.entry ?? editableWorldInfoEntry(original)), enabled: request.enabled },
    }))
  }
  return replaceOverride(state, request.bookId, request.entryIndex, current => ({ ...current, deleted: request.deleted }))
}
