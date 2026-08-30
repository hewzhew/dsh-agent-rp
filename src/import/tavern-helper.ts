/** Shared Tavern Helper script-tree parser for cards and presets. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ImportedTavernHelperScript } from './types.ts'

/** Normalized Tavern Helper extension plus facts about its source encoding. */
export interface NormalizedTavernHelperExtension {
  readonly value: Record<string, unknown>
  readonly format: 'object' | 'entries'
  readonly ignoredFieldCount: number
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Normalize Tavern Helper's object and JSON-serialized entry-list formats. */
export function tavernHelperExtension(value: unknown, path: string): NormalizedTavernHelperExtension {
  if (!Array.isArray(value)) {
    const normalized = object(value, path)
    return {
      value: normalized,
      format: 'object',
      ignoredFieldCount: Object.keys(normalized).filter(key => key !== 'scripts' && key !== 'variables').length,
    }
  }
  const result: Record<string, unknown> = {}
  let ignoredFieldCount = 0
  for (const [index, entry] of value.entries()) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
      throw new Error(`${path}[${index}] must be a [key, value] entry`)
    }
    if (entry[0] === 'scripts' || entry[0] === 'variables') result[entry[0]] = entry[1]
    else ignoredFieldCount += 1
  }
  return { value: result, format: 'entries', ignoredFieldCount }
}

/** Preserve one JSON object used as a Tavern Helper variable namespace. */
export function tavernHelperVariables(value: unknown): Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, JsonValue>>
    : {}
}

/** Flatten one Tavern Helper script tree while applying folder enablement. */
export function parseTavernHelperScripts(
  values: readonly unknown[],
  path: string,
  parentEnabled = true,
): ImportedTavernHelperScript[] {
  return values.flatMap((value, index) => {
    const itemPath = `${path}[${index}]`
    const item = object(value, itemPath)
    const enabled = parentEnabled && item.enabled !== false
    if (item.type === 'folder' || Array.isArray(item.scripts)) {
      if (!Array.isArray(item.scripts)) return []
      return parseTavernHelperScripts(item.scripts, `${itemPath}.scripts`, enabled)
    }
    const content = typeof item.content === 'string' ? item.content : ''
    const name = typeof item.name === 'string' ? item.name : ''
    const id = typeof item.id === 'string' && item.id !== '' ? item.id : `${itemPath}:${name}`
    const button = tavernHelperVariables(item.button)
    const buttons = Array.isArray(button.buttons) ? button.buttons.flatMap(entry => {
      const parsed = tavernHelperVariables(entry)
      return typeof parsed.name === 'string' ? [{
        name: parsed.name,
        visible: parsed.visible !== false,
      }] : []
    }) : []
    return [{
      id,
      name,
      content,
      info: typeof item.info === 'string' ? item.info : '',
      enabled,
      buttonEnabled: button.enabled !== false,
      buttons,
      data: tavernHelperVariables(item.data),
    }]
  })
}
