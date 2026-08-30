/** Standalone SillyTavern regex-pack parsing shared by browser hints and Host storage. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { parseRegexScript } from './import/regex-script.ts'
import type { ImportedRegexScript } from './import/types.ts'

/** Maximum number of ordered rules accepted from one standalone export. */
export const MAX_REGEX_PACK_SCRIPTS = 256

/** Phase and activation totals shown without exposing rule expressions. */
export interface RegexPackScriptSummary {
  readonly scriptCount: number
  readonly enabledCount: number
  readonly displayCount: number
  readonly promptCount: number
}

/** Count SillyTavern scopes, including rules active in both display and prompt views. */
export function summarizeRegexPackScripts(scripts: readonly ImportedRegexScript[]): RegexPackScriptSummary {
  return {
    scriptCount: scripts.length,
    enabledCount: scripts.filter(script => !script.disabled).length,
    displayCount: scripts.filter(script => script.markdownOnly || (!script.markdownOnly && !script.promptOnly)).length,
    promptCount: scripts.filter(script => script.promptOnly || (!script.markdownOnly && !script.promptOnly)).length,
  }
}

function regexRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.scriptName === 'string'
    && typeof record.findRegex === 'string'
    && typeof record.replaceString === 'string'
    && Array.isArray(record.placement)
}

/** Recognize inert top-level fields without executing expressions or replacement HTML. */
export function isSillyTavernRegexPackValue(value: unknown): boolean {
  if (regexRecord(value)) return true
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_REGEX_PACK_SCRIPTS
    && value.every(regexRecord)
}

/** Parse one single-rule or array-form export into its exact ordered rules. */
export function parseRegexPackValue(value: unknown, label = 'regex pack'): readonly ImportedRegexScript[] {
  const values = Array.isArray(value) ? value : [value]
  if (values.length === 0) throw new Error('正则包没有规则')
  if (values.length > MAX_REGEX_PACK_SCRIPTS) throw new Error(`正则包不能超过 ${MAX_REGEX_PACK_SCRIPTS} 条规则`)
  return values.map((entry, index) => parseRegexScript(entry as JsonValue, `${label}[${index}]`))
}

/** Decode one UTF-8 JSON export and retain rule order. */
export function parseRegexPackJson(source: string, label = 'regex pack'): readonly ImportedRegexScript[] {
  let value: unknown
  try {
    value = JSON.parse(source.replace(/^\uFEFF/u, ''))
  } catch (error) {
    throw new Error('正则包不是有效 JSON', { cause: error })
  }
  return parseRegexPackValue(value, label)
}

/** Decode one standalone UTF-8 file without replacement characters. */
export function parseRegexPackBytes(data: Uint8Array, label = 'regex pack'): readonly ImportedRegexScript[] {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch (error) {
    throw new Error('正则包必须是 UTF-8 JSON', { cause: error })
  }
  return parseRegexPackJson(source, label)
}
