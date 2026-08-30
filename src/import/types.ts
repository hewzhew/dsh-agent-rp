/** Neutral, lossless Character Card import vocabulary. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Character Card generation selected at the import boundary. */
export type CharacterCardVersion = 1 | 2 | 3

/** One current or legacy feature preserved from a card but deliberately not executed. */
export const CHARACTER_IMPORT_DEGRADATIONS = [
  'character-assets',
  'future-card-version',
  'group-greetings',
  'lorebook-decorators',
  'lorebook-position',
  'lorebook-regex',
  'lorebook-recursion',
  'remote-assets',
] as const

/** One feature preserved from a card but deliberately not executed. */
export type CharacterImportDegradation = typeof CHARACTER_IMPORT_DEGRADATIONS[number]

/** One SillyTavern character-scoped regex retained for display and prompt views. */
export interface ImportedRegexScript {
  readonly id?: string
  readonly scriptName: string
  readonly findRegex: string
  readonly replaceString: string
  readonly trimStrings: readonly string[]
  readonly placement: readonly number[]
  readonly disabled: boolean
  readonly markdownOnly: boolean
  readonly promptOnly: boolean
  readonly runOnEdit: boolean
  readonly substituteRegex: number
  readonly minDepth: number | null
  readonly maxDepth: number | null
}

/** One Tavern Helper button retained with its owning script. */
export interface ImportedTavernHelperButton {
  readonly name: string
  readonly visible: boolean
}

/** One flattened Tavern Helper script retained from a card script tree. */
export interface ImportedTavernHelperScript {
  readonly id: string
  readonly name: string
  readonly content: string
  readonly info: string
  /** Effective enablement after applying all parent-folder switches. */
  readonly enabled: boolean
  readonly buttonEnabled: boolean
  readonly buttons: readonly ImportedTavernHelperButton[]
  readonly data: Readonly<Record<string, JsonValue>>
}

/** Non-sensitive Tavern Helper counts shown by reusable-library interfaces. */
export interface TavernHelperLibrarySummary {
  readonly format?: 'object' | 'entries'
  readonly scriptCount: number
  readonly enabledScriptCount: number
  readonly expectedScriptCount?: number
  readonly variableCount?: number
  readonly ignoredFieldCount?: number
}

/** Source encoding and non-sensitive counts retained from one Tavern Helper extension. */
export interface TavernHelperImportSummary extends TavernHelperLibrarySummary {
  readonly format: 'object' | 'entries'
  readonly variableCount: number
  readonly ignoredFieldCount: number
}

/** Character-owned lightweight frontend resources preserved at import. */
export interface ImportedCharacterFrontend {
  readonly regexScripts: readonly ImportedRegexScript[]
  readonly tavernHelperScriptNames: readonly string[]
  readonly tavernHelperScripts: readonly ImportedTavernHelperScript[]
  readonly tavernHelperVariables: Readonly<Record<string, JsonValue>>
  readonly tavernHelper?: TavernHelperImportSummary
}

/** One Character Card V3 asset declaration retained independently of its transport. */
export interface ImportedCharacterAsset {
  readonly type: string
  readonly uri: string
  readonly name: string
  readonly ext: string
}

/** Supported runtime behavior of one lorebook entry. */
export interface ImportedLorebookEntry {
  /** Stable source-local identifier retained for display and diagnostics. */
  readonly sourceId: string
  /** Optional author-facing entry title. */
  readonly name?: string
  /** Optional author note shown only in management UI. */
  readonly comment?: string
  readonly keys: readonly string[]
  readonly secondaryKeys: readonly string[]
  readonly content: string
  readonly enabled: boolean
  readonly insertionOrder: number
  readonly selective: boolean
  readonly constant: boolean
  readonly caseSensitive: boolean
  readonly matchWholeWords: boolean
  readonly secondaryLogic: 'and-any' | 'and-all' | 'not-any' | 'not-all'
  readonly scanDepth?: number
  readonly position: 'before_char' | 'after_char' | 'at_depth'
  /** Provider-message depth used only by `at_depth` entries. */
  readonly injectionDepth?: number
  /** Provider-message role used only by `at_depth` entries. */
  readonly injectionRole?: 'system' | 'user' | 'assistant'
  readonly priority?: number
  /** Card extension flag allowing this entry to bypass the ordinary lorebook token budget. */
  readonly ignoreBudget: boolean
  /** Imported key-matching mode used by the bounded matcher. */
  readonly useRegex: boolean
  /** Decorator syntax remains exportable but never activates. */
  readonly hasDecorators: boolean
  /** Source-authored behavior retained separately from the user's enable switch until the native engine supports it. */
  readonly compatibilityBlockers?: readonly LorebookEntryCompatibilityBlocker[]
}

/** Character-specific lorebook normalized for deterministic activation. */
export interface ImportedLorebook {
  readonly name?: string
  readonly scanDepth?: number
  readonly tokenBudget?: number
  readonly recursiveScanning: boolean
  readonly entries: readonly ImportedLorebookEntry[]
}

/** One current or legacy SillyTavern World Info feature retained in raw JSON but not executed. */
export const WORLD_INFO_IMPORT_DEGRADATIONS = [
  'entry-advanced-matching',
  'entry-decorators',
  'entry-probability',
  'entry-regex',
  'entry-unsupported-position',
  'lorebook-recursion',
  'timed-effects',
  'vector-matching',
] as const

/** One SillyTavern World Info feature retained in raw JSON but not executed. */
export type WorldInfoImportDegradation = typeof WORLD_INFO_IMPORT_DEGRADATIONS[number]

/** Entry-local World Info behavior that must not be approximated by the native engine. */
export type LorebookEntryCompatibilityBlocker = Extract<WorldInfoImportDegradation,
  | 'entry-advanced-matching'
  | 'entry-probability'
  | 'entry-unsupported-position'
  | 'lorebook-recursion'
  | 'timed-effects'
  | 'vector-matching'
>

/** Lossless standalone SillyTavern World Info import. */
export interface ImportedWorldInfo {
  readonly format: 0
  readonly name?: string
  readonly lorebook: ImportedLorebook
  readonly degradations: readonly WorldInfoImportDegradation[]
  /** Exact parsed JSON, including unsupported fields and extension namespaces. */
  readonly raw: JsonValue
}

/** Canonical imported card persisted with the native tool result. */
export interface ImportedCharacterCard {
  readonly format: 0
  readonly version: CharacterCardVersion
  readonly specVersion: string
  readonly name: string
  readonly nickname?: string
  readonly description: string
  readonly personality: string
  readonly scenario: string
  readonly firstMessage: string
  readonly messageExample: string
  readonly alternateGreetings: readonly string[]
  readonly systemPrompt: string
  readonly postHistoryInstructions: string
  readonly assets?: readonly ImportedCharacterAsset[]
  readonly lorebook?: ImportedLorebook
  readonly frontend: ImportedCharacterFrontend
  readonly degradations: readonly CharacterImportDegradation[]
  /** Exact parsed JSON, including unknown fields and extension namespaces. */
  readonly raw: JsonValue
}

/** SillyTavern chat header retained independently from model-visible history. */
export interface ImportedSillyTavernChatHeader {
  readonly userName?: string
  readonly characterName?: string
  readonly createDate?: JsonValue
  readonly chatMetadata: JsonValue
  /** Exact parsed header object, including unknown fields. */
  readonly raw: JsonValue
}

/** One parsed SillyTavern chat row before conversion to a DSH Session log. */
export interface ImportedSillyTavernChatMessage {
  readonly line: number
  readonly name?: string
  readonly text: string
  readonly kind: 'user' | 'assistant' | 'narrator' | 'system'
  readonly swipes: readonly string[]
  readonly swipeId?: number
  readonly extra?: JsonValue
  /** Exact parsed message object, including unknown fields. */
  readonly raw: JsonValue
}

/** Lossless SillyTavern JSONL import with an explicit model-history projection. */
export interface ImportedSillyTavernChat {
  readonly format: 0
  readonly header: ImportedSillyTavernChatHeader
  readonly messages: readonly ImportedSillyTavernChatMessage[]
}

/** Result of decoding one PNG transport before card validation. */
export interface CharacterCardPngPayload {
  readonly keyword: 'ccv3' | 'chara'
  readonly json: string
}
