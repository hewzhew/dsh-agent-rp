/** SillyTavern Chat Completion preset parsing without executing extension code. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { parseRegexScript } from './regex-script.ts'
import { parseTavernHelperScripts, tavernHelperExtension, tavernHelperVariables } from './tavern-helper.ts'
import type { ImportedRegexScript, ImportedTavernHelperScript, TavernHelperImportSummary } from './types.ts'
import type { NormalizedTavernHelperExtension } from './tavern-helper.ts'

/** Role assigned to one Prompt Manager entry. */
export type SillyTavernPresetRole = 'system' | 'user' | 'assistant'

/** One losslessly ordered Prompt Manager module. */
export interface SillyTavernPresetPrompt {
  readonly identifier: string
  readonly name: string
  readonly role: SillyTavernPresetRole
  readonly content: string
  readonly marker: boolean
  readonly systemPrompt: boolean
  readonly forbidOverrides: boolean
  readonly injectionPosition?: number
  readonly injectionDepth?: number
  readonly injectionOrder?: number
}

/** One module reference in the selected global prompt order. */
export interface SillyTavernPresetOrderEntry {
  readonly identifier: string
  readonly enabled: boolean
}

/** Generation settings whose original values remain inspectable after import. */
export interface SillyTavernPresetGeneration {
  readonly temperature?: number
  readonly maxTokens?: number
  readonly reasoningEffort?: string
  readonly topP?: number
  readonly topK?: number
  readonly topA?: number
  readonly minP?: number
  readonly frequencyPenalty?: number
  readonly presencePenalty?: number
  readonly repetitionPenalty?: number
}

/** Preset-owned behavior for continuing the latest assistant reply. */
export interface SillyTavernPresetContinuation {
  readonly prefill: boolean
  readonly postfix: '' | ' ' | '\n' | '\n\n'
  readonly nudgePrompt: string
}

/** Non-executable extension settings used to explain native coverage accurately. */
export interface SillyTavernPresetExtensionCompatibility {
  readonly macroNestEnabled?: boolean
  readonly chatSquashEnabled?: boolean
  readonly regexBindingEnabled?: boolean
  readonly regexBindingMatchesPresetScripts?: boolean
  readonly tavernHelperScriptCount?: number
  readonly enabledTavernHelperScriptCount?: number
  readonly tavernHelperFormat?: TavernHelperImportSummary['format']
  readonly tavernHelperVariableCount?: number
  readonly tavernHelperIgnoredFieldCount?: number
}

/** Normalized executable portion of one Chat Completion preset. */
export interface ImportedSillyTavernPreset {
  readonly format: 0
  readonly name: string
  readonly prompts: readonly SillyTavernPresetPrompt[]
  readonly order: readonly SillyTavernPresetOrderEntry[]
  readonly generation: SillyTavernPresetGeneration
  /** Optional for replay compatibility with Agent RP snapshots created before rc.173. */
  readonly continuation?: SillyTavernPresetContinuation
  readonly formats: {
    readonly worldInfo: string
    readonly scenario: string
    readonly personality: string
  }
  /** Preset-scoped scripts executed before character-scoped scripts. */
  readonly regexScripts: readonly ImportedRegexScript[]
  /** Preset-scoped Tavern Helper scripts executed before character scripts. */
  readonly tavernHelperScripts?: readonly ImportedTavernHelperScript[]
  /** Initial values for the Tavern Helper preset variable namespace. */
  readonly tavernHelperVariables?: Readonly<Record<string, JsonValue>>
  readonly extensionSummary: {
    readonly regexScriptCount: number
    readonly hasSPreset: boolean
    readonly hasTavernHelper: boolean
  }
  readonly extensionCompatibility?: SillyTavernPresetExtensionCompatibility
}

/** Read preset scripts from the current normalized shape or a pre-regex session snapshot. */
export function presetRegexScripts(preset: ImportedSillyTavernPreset): readonly ImportedRegexScript[] {
  return preset.regexScripts ?? []
}

/** Read executable Tavern Helper scripts from current or older preset snapshots. */
export function presetTavernHelperScripts(preset: ImportedSillyTavernPreset): readonly ImportedTavernHelperScript[] {
  return preset.tavernHelperScripts ?? []
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function optionalFinite(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function continuationPostfix(value: unknown): SillyTavernPresetContinuation['postfix'] {
  return value === '' || value === ' ' || value === '\n' || value === '\n\n' ? value : ' '
}

function extensionCompatibility(
  extensions: Record<string, unknown>,
  rawRegex: unknown,
  helper: NormalizedTavernHelperExtension | undefined,
  helperScripts: readonly ImportedTavernHelperScript[],
  helperVariables: Readonly<Record<string, JsonValue>>,
): SillyTavernPresetExtensionCompatibility | undefined {
  const spreset = optionalObject(extensions.SPreset)
  const chatSquash = optionalObject(spreset?.ChatSquash)
  const regexBinding = optionalObject(spreset?.RegexBinding)
  const compatibility: SillyTavernPresetExtensionCompatibility = {
    ...(typeof spreset?.MacroNest === 'boolean' ? { macroNestEnabled: spreset.MacroNest } : {}),
    ...(typeof chatSquash?.enabled === 'boolean' ? { chatSquashEnabled: chatSquash.enabled } : {}),
    ...(typeof regexBinding?.enabled === 'boolean' ? { regexBindingEnabled: regexBinding.enabled } : {}),
    ...(Array.isArray(regexBinding?.regexes) && Array.isArray(rawRegex)
      ? { regexBindingMatchesPresetScripts: JSON.stringify(regexBinding.regexes) === JSON.stringify(rawRegex) }
      : {}),
    ...(helper === undefined ? {} : {
      tavernHelperScriptCount: helperScripts.length,
      enabledTavernHelperScriptCount: helperScripts.filter(script => script.enabled).length,
      tavernHelperFormat: helper.format,
      tavernHelperVariableCount: Object.keys(helperVariables).length,
      tavernHelperIgnoredFieldCount: helper.ignoredFieldCount,
    }),
  }
  return Object.keys(compatibility).length === 0 ? undefined : compatibility
}

function prompt(value: unknown, index: number): SillyTavernPresetPrompt {
  const record = object(value, `prompts[${index}]`)
  const identifier = text(record.identifier).trim()
  if (identifier === '') throw new Error(`prompts[${index}].identifier must be non-empty`)
  const importedName = text(record.name)
  const role = record.role === 'model' ? 'assistant' : record.role ?? 'system'
  if (role !== 'system' && role !== 'user' && role !== 'assistant') {
    throw new Error(`prompts[${index}].role is unsupported`)
  }
  return {
    identifier,
    name: importedName.trim() === '' ? identifier : importedName,
    role,
    content: text(record.content),
    marker: record.marker === true,
    systemPrompt: record.system_prompt === true,
    forbidOverrides: record.forbid_overrides === true,
    ...optionalFinite(record.injection_position, `prompts[${index}].injection_position`) === undefined
      ? {} : { injectionPosition: record.injection_position as number },
    ...optionalFinite(record.injection_depth, `prompts[${index}].injection_depth`) === undefined
      ? {} : { injectionDepth: record.injection_depth as number },
    ...optionalFinite(record.injection_order, `prompts[${index}].injection_order`) === undefined
      ? {} : { injectionOrder: record.injection_order as number },
  }
}

function selectedOrder(value: unknown): SillyTavernPresetOrderEntry[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('prompt_order must contain at least one order')
  const rows = value.map((entry, index) => object(entry, `prompt_order[${index}]`))
  const selected = rows.find(row => String(row.character_id) === '100001') ?? rows[0]!
  if (!Array.isArray(selected.order)) throw new Error('selected prompt_order row must contain an order array')
  return selected.order.map((entry, index) => {
    const record = object(entry, `prompt_order.order[${index}]`)
    const identifier = text(record.identifier).trim()
    if (identifier === '') throw new Error(`prompt_order.order[${index}].identifier must be non-empty`)
    return { identifier, enabled: record.enabled === true }
  })
}

/** Whether parsed JSON has the structural signature of a Chat Completion preset. */
export function isSillyTavernPresetJson(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.prompts) && Array.isArray(record.prompt_order)
}

/** Parse all Prompt Manager modules while retaining extension capability counts. */
export function parseSillyTavernPresetJson(source: string, fileName = 'SillyTavern preset'): ImportedSillyTavernPreset {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error: unknown) {
    throw new Error('SillyTavern preset is not valid JSON', { cause: error })
  }
  if (!isSillyTavernPresetJson(value)) throw new Error('JSON is not a SillyTavern Chat Completion preset')
  const record = object(value, 'preset')
  const prompts = (record.prompts as unknown[]).map(prompt)
  const seen = new Set<string>()
  for (const item of prompts) {
    if (seen.has(item.identifier)) throw new Error(`preset repeats prompt identifier ${JSON.stringify(item.identifier)}`)
    seen.add(item.identifier)
  }
  const order = selectedOrder(record.prompt_order)
  for (const item of order) {
    if (!seen.has(item.identifier)) throw new Error(`prompt_order references missing prompt ${JSON.stringify(item.identifier)}`)
  }
  const extensions = record.extensions === undefined ? {} : object(record.extensions, 'extensions')
  const rawRegex = extensions.regex_scripts
  const regexScripts = rawRegex === undefined
    ? []
    : (() => {
        if (!Array.isArray(rawRegex)) throw new Error('extensions.regex_scripts must be an array')
        return rawRegex.map((value, index) => parseRegexScript(value as JsonValue, `extensions.regex_scripts[${index}]`))
      })()
  const rawHelper = extensions.tavern_helper
  const helper = rawHelper === undefined || rawHelper === null
    ? undefined
    : tavernHelperExtension(rawHelper, 'extensions.tavern_helper')
  const helperScripts = helper?.value.scripts === undefined
    ? []
    : (() => {
        if (!Array.isArray(helper.value.scripts)) throw new Error('extensions.tavern_helper.scripts must be an array')
        return parseTavernHelperScripts(helper.value.scripts, 'extensions.tavern_helper.scripts')
      })()
  const helperVariables = tavernHelperVariables(helper?.value.variables)
  const compatibility = extensionCompatibility(extensions, rawRegex, helper, helperScripts, helperVariables)
  return {
    format: 0,
    name: fileName.replace(/\.json$/iu, '').trim() || 'SillyTavern preset',
    prompts,
    order,
    generation: {
      ...optionalFinite(record.temperature, 'temperature') === undefined ? {} : { temperature: record.temperature as number },
      ...optionalFinite(record.openai_max_tokens, 'openai_max_tokens') === undefined ? {} : { maxTokens: record.openai_max_tokens as number },
      ...typeof record.reasoning_effort === 'string' ? { reasoningEffort: record.reasoning_effort } : {},
      ...optionalFinite(record.top_p, 'top_p') === undefined ? {} : { topP: record.top_p as number },
      ...optionalFinite(record.top_k, 'top_k') === undefined ? {} : { topK: record.top_k as number },
      ...optionalFinite(record.top_a, 'top_a') === undefined ? {} : { topA: record.top_a as number },
      ...optionalFinite(record.min_p, 'min_p') === undefined ? {} : { minP: record.min_p as number },
      ...optionalFinite(record.frequency_penalty, 'frequency_penalty') === undefined ? {} : { frequencyPenalty: record.frequency_penalty as number },
      ...optionalFinite(record.presence_penalty, 'presence_penalty') === undefined ? {} : { presencePenalty: record.presence_penalty as number },
      ...optionalFinite(record.repetition_penalty, 'repetition_penalty') === undefined ? {} : { repetitionPenalty: record.repetition_penalty as number },
    },
    continuation: {
      prefill: record.continue_prefill === true,
      postfix: continuationPostfix(record.continue_postfix),
      nudgePrompt: text(record.continue_nudge_prompt, '[Continue your last message without repeating its original content.]'),
    },
    formats: {
      worldInfo: text(record.wi_format, '{0}'),
      scenario: text(record.scenario_format, '{{scenario}}'),
      personality: text(record.personality_format, '{{personality}}'),
    },
    regexScripts,
    tavernHelperScripts: helperScripts,
    tavernHelperVariables: helperVariables,
    extensionSummary: {
      regexScriptCount: regexScripts.length,
      hasSPreset: extensions.SPreset !== undefined && extensions.SPreset !== null,
      hasTavernHelper: extensions.tavern_helper !== undefined && extensions.tavern_helper !== null,
    },
    ...(compatibility === undefined ? {} : { extensionCompatibility: compatibility }),
  }
}

/** Parse UTF-8 preset bytes with strict decoding. */
export function parseSillyTavernPresetBytes(bytes: Uint8Array, fileName?: string): ImportedSillyTavernPreset {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    throw new Error('SillyTavern preset must be UTF-8 JSON', { cause: error })
  }
  return parseSillyTavernPresetJson(source, fileName)
}

/** Convert a normalized preset to durable JSON without retaining executable extension payloads. */
export function presetJson(preset: ImportedSillyTavernPreset): JsonValue {
  return structuredClone(preset) as unknown as JsonValue
}
