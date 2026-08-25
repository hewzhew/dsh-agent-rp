/** Deterministic activation of the safe Character Card lorebook subset. */

import type { ImportedLorebook, ImportedLorebookEntry } from './types.ts'
import type { EjsTemplateResult, EjsTemplateTarget } from '../ejs-template.ts'

/** Runtime result of selecting lorebook entries for one prompt. */
export interface ActiveLorebook {
  readonly beforeCharacter: readonly string[]
  readonly afterCharacter: readonly string[]
}

/** One active world contribution placed relative to recent provider messages. */
export interface LorebookInChatContribution {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
  readonly depth: number
  readonly order: number
}

/** Why one normalized lorebook entry did or did not enter the current prompt. */
export type LorebookActivationReason =
  | 'active-constant'
  | 'active-keyword'
  | 'disabled'
  | 'deleted'
  | 'empty-content'
  | 'compatibility-unsupported'
  | 'decorator-unsupported'
  | 'template-unsupported'
  | 'template-error'
  | 'regex-runtime-unavailable'
  | 'regex-invalid'
  | 'regex-execution-limit'
  | 'regex-resource-limit'
  | 'primary-unmatched'
  | 'secondary-unmatched'
  | 'budget-excluded'
  | 'session-budget-excluded'

/** Explainable activation result for one entry in source order. */
export interface LorebookEntryActivation {
  readonly index: number
  readonly active: boolean
  readonly reason: LorebookActivationReason
  readonly matchedKeys: readonly string[]
  readonly matchedSecondaryKeys: readonly string[]
  readonly approximateTokens: number
  readonly template?: 'rendered' | Exclude<EjsTemplateResult, { readonly ok: true }>['kind']
  /** Resolved prompt text retained only for collection-level budgeting and assembly. */
  readonly resolvedContent: string
}

/** Prompt fragments and entry-level explanations produced by the same decision pass. */
export interface InspectedLorebook extends ActiveLorebook {
  readonly entries: readonly LorebookEntryActivation[]
  readonly inChat: readonly LorebookInChatContribution[]
}

/** Optional isolated renderer used to admit executable EJS content. */
export interface LorebookActivationOptions {
  readonly renderTemplate?: (template: string, target?: EjsTemplateTarget) => EjsTemplateResult
  /** Replay-safe substitution applied after EJS and before every token budget. */
  readonly renderMacro?: (content: string, target?: EjsTemplateTarget) => string
  readonly worldInfoBookId?: string
  /** Isolated regular-expression runtime created once for each inspection pass. */
  readonly regexEngine?: LorebookRegexEngine
}

/** Stable result from one bounded regular-expression batch. */
export type LorebookRegexMatchResult =
  | { readonly ok: true; readonly matchedKeys: readonly string[] }
  | { readonly ok: false; readonly kind: 'invalid' | 'execution-limit' | 'resource-limit' }

/** One disposable matcher scoped to a single World Info inspection pass. */
export interface LorebookRegexMatcher {
  match(keys: readonly string[], text: string, caseSensitive: boolean): LorebookRegexMatchResult
  dispose(): void
}

/** Factory backed by an isolated runtime rather than the Host JavaScript engine. */
export interface LorebookRegexEngine {
  createRegexMatcher(): LorebookRegexMatcher
}

function createRegexMatcher(options: LorebookActivationOptions): LorebookRegexMatcher | undefined {
  try {
    return options.regexEngine?.createRegexMatcher()
  } catch {
    // Runtime initialization failure degrades complex keys to the existing literal-only path.
    return undefined
  }
}

/** One book participating in a shared Session-level World Info budget. */
export interface LorebookCollectionItem {
  readonly id: string
  readonly lorebook: ImportedLorebook
}

/** Shared-budget inspection retaining entry explanations for every source book. */
export interface InspectedLorebookCollection extends ActiveLorebook {
  readonly books: readonly { readonly id: string; readonly inspected: InspectedLorebook }[]
  readonly inChat: readonly LorebookInChatContribution[]
  readonly approximateTokens: number
  readonly tokenBudget?: number
}

interface CandidateDecision {
  readonly candidate: boolean
  readonly reason: LorebookActivationReason
  readonly matchedKeys: readonly string[]
  readonly matchedSecondaryKeys: readonly string[]
  readonly content: string
  readonly template?: LorebookEntryActivation['template']
}

function includesKey(text: string, key: string, caseSensitive: boolean, matchWholeWords: boolean): boolean {
  if (key.length === 0) return false
  const haystack = caseSensitive ? text : text.toLocaleLowerCase()
  const needle = caseSensitive ? key : key.toLocaleLowerCase()
  if (!matchWholeWords) return haystack.includes(needle)
  if (/\s/u.test(needle)) return haystack.includes(needle)
  let offset = haystack.indexOf(needle)
  while (offset >= 0) {
    const before = offset === 0 ? '' : haystack[offset - 1]!
    const after = offset + needle.length >= haystack.length ? '' : haystack[offset + needle.length]!
    if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true
    offset = haystack.indexOf(needle, offset + 1)
  }
  return false
}

/**
 * Report whether a V3 regex key is equivalent to a bounded literal substring lookup.
 * @param value - raw Character Card V3 regex pattern.
 * @returns whether the pattern contains no regex operators or escapes.
 */
export function isLiteralRegexPattern(value: string): boolean {
  return value.length > 0 && !value.includes('/') && !/[\\^$.*+?()[\]{}|]/u.test(value)
}

function hasExecutableTemplate(content: string): boolean {
  return /<%[=_-]?[\s\S]*?%>/imu.test(content)
}

function keywordMatches(
  keys: readonly string[],
  text: string,
  entry: ImportedLorebookEntry,
): string[] {
  return keys.filter(key => includesKey(text, key, entry.caseSensitive, entry.matchWholeWords))
}

function literalRegexMatches(
  keys: readonly string[],
  text: string,
  entry: ImportedLorebookEntry,
): string[] | undefined {
  if (keys.some(key => !isLiteralRegexPattern(key))) return undefined
  return keys.filter(key => includesKey(text, key, entry.caseSensitive, false))
}

type RegexMatchDecision =
  | { readonly ok: true; readonly matchedKeys: readonly string[] }
  | { readonly ok: false; readonly reason: Extract<LorebookActivationReason,
    'regex-runtime-unavailable' | 'regex-invalid' | 'regex-execution-limit' | 'regex-resource-limit'> }

function regexMatches(
  keys: readonly string[],
  text: string,
  entry: ImportedLorebookEntry,
  matcher: LorebookRegexMatcher | undefined,
): RegexMatchDecision {
  if (matcher === undefined) {
    const matchedKeys = literalRegexMatches(keys, text, entry)
    return matchedKeys === undefined
      ? { ok: false, reason: 'regex-runtime-unavailable' }
      : { ok: true, matchedKeys }
  }
  const result = matcher.match(keys, text, entry.caseSensitive)
  if (result.ok) return { ok: true, matchedKeys: result.matchedKeys }
  return { ok: false, reason: result.kind === 'invalid' ? 'regex-invalid'
    : result.kind === 'execution-limit' ? 'regex-execution-limit' : 'regex-resource-limit' }
}

function candidate(
  entry: ImportedLorebookEntry,
  messages: readonly string[],
  bookDepth: number | undefined,
  options: LorebookActivationOptions,
  regexMatcher?: LorebookRegexMatcher,
): CandidateDecision {
  const decision = (
    candidate: boolean,
    reason: LorebookActivationReason,
    matchedKeys: readonly string[] = [],
    matchedSecondaryKeys: readonly string[] = [],
  ): CandidateDecision => ({
    candidate, reason, matchedKeys, matchedSecondaryKeys, content: entry.content,
  })
  if (!entry.enabled) return decision(false, 'disabled')
  if (entry.content.trim().length === 0) return decision(false, 'empty-content')
  if ((entry.compatibilityBlockers?.length ?? 0) > 0) return decision(false, 'compatibility-unsupported')
  if (entry.hasDecorators) return decision(false, 'decorator-unsupported')

  let activation: CandidateDecision
  if (entry.constant) {
    activation = decision(true, 'active-constant')
  } else {
    const depth = entry.scanDepth ?? bookDepth ?? messages.length
    const text = depth === 0 ? '' : messages.slice(-Math.max(0, Math.trunc(depth))).join('\n')
    if (entry.useRegex) {
      const primary = regexMatches(entry.keys, text, entry, regexMatcher)
      if (!primary.ok) {
        activation = decision(false, primary.reason)
      } else if (primary.matchedKeys.length === 0) {
        const matchedKeys = primary.matchedKeys
        activation = decision(false, 'primary-unmatched', matchedKeys)
      } else {
        const matchedKeys = primary.matchedKeys
        const secondary = regexMatches(entry.secondaryKeys, text, entry, regexMatcher)
        if (!secondary.ok) {
          activation = decision(false, secondary.reason, matchedKeys)
        } else if (!entry.selective || entry.secondaryKeys.length === 0) {
          const matchedSecondaryKeys = secondary.matchedKeys
          activation = decision(true, 'active-keyword', matchedKeys, matchedSecondaryKeys)
        } else {
          const matchedSecondaryKeys = secondary.matchedKeys
          const matches = entry.secondaryKeys.map(key => matchedSecondaryKeys.includes(key))
          const secondaryMatches = entry.secondaryLogic === 'and-any' ? matches.some(Boolean)
            : entry.secondaryLogic === 'and-all' ? matches.every(Boolean)
              : entry.secondaryLogic === 'not-any' ? matches.every(match => !match)
                : matches.some(match => !match)
          activation = decision(
            secondaryMatches,
            secondaryMatches ? 'active-keyword' : 'secondary-unmatched',
            matchedKeys,
            matchedSecondaryKeys,
          )
        }
      }
    } else {
      const matchedKeys = keywordMatches(entry.keys, text, entry)
      if (matchedKeys.length === 0) {
        activation = decision(false, 'primary-unmatched', matchedKeys)
      } else {
        const matchedSecondaryKeys = keywordMatches(entry.secondaryKeys, text, entry)
        if (!entry.selective || entry.secondaryKeys.length === 0) {
          activation = decision(true, 'active-keyword', matchedKeys, matchedSecondaryKeys)
        } else {
          const matches = entry.secondaryKeys.map(key => matchedSecondaryKeys.includes(key))
          const secondaryMatches = entry.secondaryLogic === 'and-any' ? matches.some(Boolean)
            : entry.secondaryLogic === 'and-all' ? matches.every(Boolean)
              : entry.secondaryLogic === 'not-any' ? matches.every(match => !match)
                : matches.some(match => !match)
          activation = decision(
            secondaryMatches,
            secondaryMatches ? 'active-keyword' : 'secondary-unmatched',
            matchedKeys,
            matchedSecondaryKeys,
          )
        }
      }
    }
  }
  if (!activation.candidate) return activation
  const target = {
    ...(options.worldInfoBookId === undefined ? {} : { worldInfoBookId: options.worldInfoBookId }),
  }
  let content = options.renderMacro?.(activation.content, target) ?? activation.content
  let template: LorebookEntryActivation['template']
  if (hasExecutableTemplate(content)) {
    if (options.renderTemplate === undefined) return { ...activation, candidate: false, reason: 'template-unsupported' }
    const rendered = options.renderTemplate(content, target)
    if (!rendered.ok) return {
      ...activation,
      candidate: false,
      reason: 'template-error',
      template: rendered.kind,
    }
    content = rendered.text
    template = 'rendered'
  }
  if (content.trim().length === 0) return {
    ...activation,
    candidate: false,
    reason: 'empty-content',
    content,
    ...(template === undefined ? {} : { template }),
  }
  return { ...activation, content, ...(template === undefined ? {} : { template }) }
}

function approximateTokens(text: string): number {
  let ascii = 0
  let nonAscii = 0
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) ascii += 1
    else nonAscii += 1
  }
  return Math.max(1, Math.ceil(ascii / 4) + nonAscii)
}

function budgeted(book: ImportedLorebook, entries: readonly {
  readonly index: number
  readonly entry: ImportedLorebookEntry
  readonly content: string
}[]): number[] {
  const budget = book.tokenBudget
  if (budget === undefined) return entries.map(value => value.index)
  const preferred = [...entries].sort((left, right) =>
    (right.entry.priority ?? right.entry.insertionOrder) - (left.entry.priority ?? left.entry.insertionOrder)
      || left.entry.insertionOrder - right.entry.insertionOrder)
  const kept: number[] = []
  let used = 0
  for (const { index, entry, content } of preferred) {
    const cost = approximateTokens(content)
    if (entry.ignoreBudget) {
      kept.push(index)
      continue
    }
    if (used + cost > budget) continue
    used += cost
    kept.push(index)
  }
  return kept.sort((left, right) => left - right)
}

function activeContent(
  book: ImportedLorebook,
  entries: readonly LorebookEntryActivation[],
): ActiveLorebook & { readonly inChat: readonly LorebookInChatContribution[] } {
  const active = entries.filter(value => value.active)
    .map(value => ({ index: value.index, entry: book.entries[value.index]!, content: value.resolvedContent }))
    .sort((left, right) => left.entry.insertionOrder - right.entry.insertionOrder || left.index - right.index)
  return {
    beforeCharacter: active.filter(value => value.entry.position === 'before_char').map(value => value.content),
    afterCharacter: active.filter(value => value.entry.position === 'after_char').map(value => value.content),
    inChat: active.filter(value => value.entry.position === 'at_depth').map(value => ({
      role: value.entry.injectionRole ?? 'system',
      content: value.content,
      depth: value.entry.injectionDepth ?? 4,
      order: value.entry.insertionOrder,
    })),
  }
}

/**
 * Inspect prompt activation with entry-level reasons and matching evidence.
 * @param book - imported character lorebook.
 * @param messages - model-visible conversation text in chronological order.
 * @returns prompt fragments and explanations produced by one shared decision pass.
 */
export function inspectLorebook(
  book: ImportedLorebook,
  messages: readonly string[],
  options: LorebookActivationOptions = {},
): InspectedLorebook {
  const matcher = createRegexMatcher(options)
  try {
    return inspectLorebookWithMatcher(book, messages, options, matcher)
  } finally {
    matcher?.dispose()
  }
}

function inspectLorebookWithMatcher(
  book: ImportedLorebook,
  messages: readonly string[],
  options: LorebookActivationOptions,
  matcher: LorebookRegexMatcher | undefined,
): InspectedLorebook {
  const decisions = book.entries.map((entry, index) => ({
    index,
    entry,
    decision: candidate(entry, messages, book.scanDepth, options, matcher),
  }))
  const candidates = decisions.filter(value => value.decision.candidate)
  const included = new Set(budgeted(book, candidates.map(({ index, entry, decision }) => ({
    index, entry, content: decision.content,
  }))))
  const entries = decisions.map(({ index, decision }): LorebookEntryActivation => ({
    index,
    active: decision.candidate && included.has(index),
    reason: decision.candidate && !included.has(index) ? 'budget-excluded' : decision.reason,
    matchedKeys: decision.matchedKeys,
    matchedSecondaryKeys: decision.matchedSecondaryKeys,
    approximateTokens: approximateTokens(decision.content),
    ...(decision.template === undefined ? {} : { template: decision.template }),
    resolvedContent: decision.content,
  }))
  const active = activeContent(book, entries)
  return {
    ...active,
    entries,
  }
}

/**
 * Inspect multiple books under their source budgets and one final Session budget.
 * @param books - active books in prompt order.
 * @param messages - model-visible conversation text in chronological order.
 * @param options - isolated template renderer and optional aggregate token cap.
 * @returns per-book decisions plus combined prompt fragments.
 */
export function inspectLorebooks(
  books: readonly LorebookCollectionItem[],
  messages: readonly string[],
  options: LorebookActivationOptions & { readonly tokenBudget?: number } = {},
): InspectedLorebookCollection {
  const matcher = createRegexMatcher(options)
  let inspected: { readonly id: string; readonly inspected: InspectedLorebook }[]
  try {
    inspected = books.map(book => ({
      id: book.id,
      inspected: inspectLorebookWithMatcher(
        book.lorebook,
        messages,
        { ...options, worldInfoBookId: book.id },
        matcher,
      ),
    }))
  } finally {
    matcher?.dispose()
  }
  const candidates = inspected.flatMap((book, bookIndex) => book.inspected.entries.flatMap(decision => {
    if (!decision.active) return []
    const entry = books[bookIndex]!.lorebook.entries[decision.index]!
    return [{ bookIndex, decision, entry }]
  }))
  const selected = new Set(candidates.map(value => `${value.bookIndex}\u0000${value.decision.index}`))
  if (options.tokenBudget !== undefined) {
    selected.clear()
    let used = 0
    const preferred = [...candidates].sort((left, right) =>
      (right.entry.priority ?? right.entry.insertionOrder) - (left.entry.priority ?? left.entry.insertionOrder)
        || left.bookIndex - right.bookIndex
        || left.entry.insertionOrder - right.entry.insertionOrder
        || left.decision.index - right.decision.index)
    for (const value of preferred) {
      if (used + value.decision.approximateTokens > Math.max(0, options.tokenBudget)) continue
      used += value.decision.approximateTokens
      selected.add(`${value.bookIndex}\u0000${value.decision.index}`)
    }
  }
  const resolved = inspected.map((book, bookIndex) => {
    const entries = book.inspected.entries.map(decision => decision.active
      && !selected.has(`${bookIndex}\u0000${decision.index}`)
      ? { ...decision, active: false, reason: 'session-budget-excluded' as const }
      : decision)
    return {
      id: book.id,
      inspected: { ...activeContent(books[bookIndex]!.lorebook, entries), entries },
    }
  })
  return {
    beforeCharacter: resolved.flatMap(book => book.inspected.beforeCharacter),
    afterCharacter: resolved.flatMap(book => book.inspected.afterCharacter),
    inChat: resolved.flatMap(book => book.inspected.inChat),
    books: resolved,
    approximateTokens: resolved.flatMap(book => book.inspected.entries)
      .filter(entry => entry.active).reduce((sum, entry) => sum + entry.approximateTokens, 0),
    ...(options.tokenBudget === undefined ? {} : { tokenBudget: options.tokenBudget }),
  }
}

/**
 * Activate compatible lorebook entries against recent dialogue.
 * @param book - imported character lorebook.
 * @param messages - model-visible conversation text in chronological order.
 * @returns position-separated content in insertion order and within budget.
 */
export function activateLorebook(
  book: ImportedLorebook,
  messages: readonly string[],
  options: LorebookActivationOptions = {},
): ActiveLorebook {
  const { beforeCharacter, afterCharacter } = inspectLorebook(book, messages, options)
  return { beforeCharacter, afterCharacter }
}
