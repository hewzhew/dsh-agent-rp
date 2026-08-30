/** Pure validation and state transitions for session Prompt Manager changes. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ActiveSessionPreset } from './import/session-preset.ts'
import type { ImportedSillyTavernPreset, SillyTavernPresetGeneration } from './import/sillytavern-preset.ts'
import { presetRegexScripts } from './import/sillytavern-preset.ts'
import { parseRegexScript } from './import/regex-script.ts'
import type { PresetConfigurationRequest } from './preset-configuration-types.ts'

const FORCE_TOGGLE_MARKERS = new Set([
  'charDescription',
  'charPersonality',
  'scenario',
  'personaDescription',
  'worldInfoBefore',
  'worldInfoAfter',
  'main',
  'chatHistory',
  'dialogueExamples',
])

/** Whether SillyTavern exposes the module's enable switch. */
export function canTogglePresetPrompt(preset: ImportedSillyTavernPreset, identifier: string): boolean {
  const prompt = preset.prompts.find(item => item.identifier === identifier)
  return prompt !== undefined && (!prompt.marker || FORCE_TOGGLE_MARKERS.has(identifier))
}

/** Whether one module owns literal text that can be edited by the Prompt Manager. */
export function canEditPresetPrompt(preset: ImportedSillyTavernPreset, identifier: string): boolean {
  const prompt = preset.prompts.find(item => item.identifier === identifier)
  return prompt !== undefined && !prompt.marker
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('revision must be a non-negative safe integer')
  return value as number
}

function index(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('index must be a non-negative safe integer')
  return value as number
}

function identifier(value: unknown, label = 'identifier'): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value
}

function order(value: unknown): readonly { readonly identifier: string; readonly enabled: boolean }[] {
  if (!Array.isArray(value)) throw new Error('order must be an array')
  const seen = new Set<string>()
  return value.map((item, index) => {
    const record = object(item, `order[${index}]`)
    const id = identifier(record.identifier, `order[${index}].identifier`)
    if (seen.has(id)) throw new Error(`order repeats module ${JSON.stringify(id)}`)
    seen.add(id)
    if (typeof record.enabled !== 'boolean') throw new Error(`order[${index}].enabled must be a boolean`)
    return { identifier: id, enabled: record.enabled }
  })
}

function nullableFiniteDepth(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number or null`)
  return value
}

function regex(value: unknown): Extract<PresetConfigurationRequest, { operation: 'replace' }>['regex'] {
  if (!Array.isArray(value)) throw new Error('regex must be an array')
  const seen = new Set<number>()
  return value.map((item, itemIndex) => {
    const record = object(item, `regex[${itemIndex}]`)
    const scriptIndex = index(record.index)
    if (seen.has(scriptIndex)) throw new Error(`regex repeats script index ${scriptIndex}`)
    seen.add(scriptIndex)
    if (typeof record.disabled !== 'boolean') throw new Error(`regex[${itemIndex}].disabled must be a boolean`)
    return {
      index: scriptIndex,
      disabled: record.disabled,
      ...(record.minDepth === undefined
        ? {} : { minDepth: nullableFiniteDepth(record.minDepth, `regex[${itemIndex}].minDepth`) }),
      ...(record.maxDepth === undefined
        ? {} : { maxDepth: nullableFiniteDepth(record.maxDepth, `regex[${itemIndex}].maxDepth`) }),
    }
  })
}

function regexScripts(value: unknown): Extract<PresetConfigurationRequest, { operation: 'replace' }>['regexScripts'] {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('regexScripts must be an array')
  return value.map((item, itemIndex) => parseRegexScript(item as JsonValue, `regexScripts[${itemIndex}]`))
}

function content(value: unknown): readonly { readonly identifier: string; readonly content: string }[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('content must be an array')
  const seen = new Set<string>()
  return value.map((item, itemIndex) => {
    const record = object(item, `content[${itemIndex}]`)
    const id = identifier(record.identifier, `content[${itemIndex}].identifier`)
    if (seen.has(id)) throw new Error(`content repeats module ${JSON.stringify(id)}`)
    seen.add(id)
    if (typeof record.content !== 'string') throw new Error(`content[${itemIndex}].content must be a string`)
    return { identifier: id, content: record.content }
  })
}

type PromptDefinition = NonNullable<Extract<PresetConfigurationRequest, { operation: 'replace' }>['prompts']>[number]

function optionalPromptNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value as number
}

function promptDefinitions(value: unknown): readonly PromptDefinition[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('prompts must be an array')
  const seen = new Set<string>()
  return value.map((item, itemIndex) => {
    const record = object(item, `prompts[${itemIndex}]`)
    const id = identifier(record.identifier, `prompts[${itemIndex}].identifier`)
    if (seen.has(id)) throw new Error(`prompts repeats module ${JSON.stringify(id)}`)
    seen.add(id)
    const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name.trim() : id
    if (record.role !== 'system' && record.role !== 'user' && record.role !== 'assistant') {
      throw new Error(`prompts[${itemIndex}].role is unsupported`)
    }
    if (typeof record.content !== 'string') throw new Error(`prompts[${itemIndex}].content must be a string`)
    // SillyTavern's editor suggests these ranges for newly entered values, but
    // imported presets in the wild can carry older values outside them. Decode
    // the transport losslessly here; configurePreset validates only values the
    // user actually changes, so an unrelated edit can round-trip the original.
    const injectionPosition = optionalPromptNumber(record.injectionPosition, `prompts[${itemIndex}].injectionPosition`)
    const injectionDepth = optionalPromptNumber(record.injectionDepth, `prompts[${itemIndex}].injectionDepth`)
    const injectionOrder = optionalPromptNumber(record.injectionOrder, `prompts[${itemIndex}].injectionOrder`)
    return {
      identifier: id,
      name,
      role: record.role,
      content: record.content,
      ...(injectionPosition === undefined ? {} : { injectionPosition }),
      ...(injectionDepth === undefined ? {} : { injectionDepth }),
      ...(injectionOrder === undefined ? {} : { injectionOrder }),
    }
  })
}

function assertEditedPromptInteger(
  value: number | undefined,
  current: number | undefined,
  label: string,
  maximum: number,
): void {
  if (value === undefined || Object.is(value, current)) return
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be an integer from 0 to ${maximum}`)
  }
}

function assertEditedPromptInjection(
  definition: PromptDefinition,
  current: ImportedSillyTavernPreset['prompts'][number] | undefined,
): void {
  const label = `preset module ${JSON.stringify(definition.identifier)}`
  assertEditedPromptInteger(definition.injectionPosition, current?.injectionPosition, `${label} injectionPosition`, 1)
  assertEditedPromptInteger(definition.injectionDepth, current?.injectionDepth, `${label} injectionDepth`, 9999)
  assertEditedPromptInteger(definition.injectionOrder, current?.injectionOrder, `${label} injectionOrder`, 9999)
}

function finiteOrNull(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number or null`)
  if (label === 'temperature' && (value < 0 || value > 2)) throw new Error('temperature must be between 0 and 2')
  return value
}

function integerOrNull(value: unknown, label: string): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive safe integer or null`)
  return value as number
}

function effortOrNull(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.trim() === '') throw new Error('reasoningEffort must be a non-empty string or null')
  return value.trim()
}

function generation(value: unknown): Extract<PresetConfigurationRequest, { operation: 'replace' }>['generation'] {
  const record = object(value, 'generation')
  return {
    ...record.temperature === undefined ? {} : { temperature: finiteOrNull(record.temperature, 'temperature') },
    ...record.maxTokens === undefined ? {} : { maxTokens: integerOrNull(record.maxTokens, 'maxTokens') },
    ...record.reasoningEffort === undefined ? {} : { reasoningEffort: effortOrNull(record.reasoningEffort) },
  }
}

/** Decode the private command payload at the Host boundary. */
export function parsePresetConfigurationRequest(source: string): PresetConfigurationRequest {
  let parsed: unknown
  try {
    parsed = JSON.parse(source.trim())
  } catch (error: unknown) {
    throw new Error('preset configuration must be valid JSON', { cause: error })
  }
  const value = object(parsed, 'preset configuration')
  const common = { revision: revision(value.revision) }
  switch (value.operation) {
    case 'replace':
      return {
        operation: 'replace',
        ...common,
        order: order(value.order),
        ...value.prompts === undefined ? {} : { prompts: promptDefinitions(value.prompts)! },
        content: content(value.content),
        generation: generation(value.generation),
        regex: regex(value.regex),
        ...value.regexScripts === undefined ? {} : { regexScripts: regexScripts(value.regexScripts)! },
      }
    case 'toggle': {
      if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean')
      return { operation: 'toggle', ...common, identifier: identifier(value.identifier), enabled: value.enabled }
    }
    case 'move':
      return {
        operation: 'move',
        ...common,
        identifier: identifier(value.identifier),
        ...value.before === undefined ? {} : { before: identifier(value.before, 'before') },
      }
    case 'generation': {
      const result: Extract<PresetConfigurationRequest, { operation: 'generation' }> = {
        operation: 'generation',
        ...common,
        ...value.temperature === undefined ? {} : { temperature: finiteOrNull(value.temperature, 'temperature') },
        ...value.maxTokens === undefined ? {} : { maxTokens: integerOrNull(value.maxTokens, 'maxTokens') },
        ...value.reasoningEffort === undefined ? {} : { reasoningEffort: effortOrNull(value.reasoningEffort) },
      }
      if (result.temperature === undefined && result.maxTokens === undefined && result.reasoningEffort === undefined) {
        throw new Error('generation requires at least one setting')
      }
      return result
    }
    case 'reset':
      return { operation: 'reset', ...common }
    default:
      throw new Error(`unknown preset configuration operation ${JSON.stringify(value.operation)}`)
  }
}

function withGeneration(
  current: SillyTavernPresetGeneration,
  request: Extract<PresetConfigurationRequest, { operation: 'generation' }>,
): SillyTavernPresetGeneration {
  const next = { ...current } as Record<string, unknown>
  for (const [key, value] of [
    ['temperature', request.temperature],
    ['maxTokens', request.maxTokens],
    ['reasoningEffort', request.reasoningEffort],
  ] as const) {
    if (value === undefined) continue
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next as SillyTavernPresetGeneration
}

/** Apply one validated manager mutation to an imported preset snapshot. */
export function configurePreset(
  active: ActiveSessionPreset,
  request: PresetConfigurationRequest,
): ImportedSillyTavernPreset {
  if (request.revision !== active.revision) {
    throw new Error(`preset configuration changed; expected revision ${active.revision}, received ${request.revision}`)
  }
  if (request.operation === 'reset') return structuredClone(active.importedPreset)
  if (request.operation === 'replace') {
    const currentById = new Map(active.preset.prompts.map(item => [item.identifier, item]))
    const nextPrompts = request.prompts === undefined
      ? active.preset.prompts.map(prompt => ({ ...prompt }))
      : request.prompts.map((definition) => {
          const current = currentById.get(definition.identifier)
          assertEditedPromptInjection(definition, current)
          if (current === undefined) {
            return {
              ...definition,
              marker: false,
              systemPrompt: false,
              forbidOverrides: false,
              injectionPosition: definition.injectionPosition ?? 0,
              injectionDepth: definition.injectionDepth ?? 4,
              injectionOrder: definition.injectionOrder ?? 100,
            }
          }
          if (current.marker && definition.content !== current.content) {
            throw new Error(`preset module ${JSON.stringify(definition.identifier)} has no editable content`)
          }
          return {
            ...current,
            name: definition.name,
            role: definition.role,
            content: definition.content,
            ...(definition.injectionPosition === undefined ? {} : { injectionPosition: definition.injectionPosition }),
            ...(definition.injectionDepth === undefined ? {} : { injectionDepth: definition.injectionDepth }),
            ...(definition.injectionOrder === undefined ? {} : { injectionOrder: definition.injectionOrder }),
          }
        })
    if (request.prompts !== undefined) {
      const nextIds = new Set(request.prompts.map(prompt => prompt.identifier))
      for (const prompt of active.importedPreset.prompts) {
        if ((prompt.systemPrompt || prompt.marker) && !nextIds.has(prompt.identifier)) {
          throw new Error(`preset built-in module ${JSON.stringify(prompt.identifier)} cannot be deleted`)
        }
      }
    }
    const prompts = new Set(nextPrompts.map(item => item.identifier))
    const nextPreset = { ...active.preset, prompts: nextPrompts }
    for (const entry of request.order) {
      if (!prompts.has(entry.identifier)) throw new Error(`preset has no module ${JSON.stringify(entry.identifier)}`)
      if (entry.enabled && !canTogglePresetPrompt(nextPreset, entry.identifier)) {
        const current = active.preset.order.find(item => item.identifier === entry.identifier)?.enabled ?? false
        if (!current) throw new Error(`preset module ${JSON.stringify(entry.identifier)} cannot be enabled`)
      }
    }
    const contentById = new Map(request.content.map(entry => [entry.identifier, entry.content]))
    for (const identifier of contentById.keys()) {
      if (!prompts.has(identifier)) throw new Error(`preset has no module ${JSON.stringify(identifier)}`)
      if (!canEditPresetPrompt(active.preset, identifier)) {
        throw new Error(`preset module ${JSON.stringify(identifier)} has no editable content`)
      }
    }
    const scripts = request.regexScripts === undefined
      ? presetRegexScripts(active.preset)
      : request.regexScripts.map(script => ({ ...script }))
    if (request.regex.length !== scripts.length
      || request.regex.some(entry => entry.index >= scripts.length)) {
      throw new Error('preset regex configuration does not match the active script set')
    }
    const regexByIndex = new Map(request.regex.map(entry => [entry.index, entry]))
    return {
      ...structuredClone(active.preset),
      prompts: nextPrompts.map(prompt => contentById.has(prompt.identifier)
        ? { ...prompt, content: contentById.get(prompt.identifier)! }
        : { ...prompt }),
      order: request.order.map(item => ({ ...item })),
      generation: withGeneration(active.preset.generation, {
        operation: 'generation',
        revision: request.revision,
        ...request.generation,
      }),
      extensionSummary: {
        ...active.preset.extensionSummary,
        regexScriptCount: scripts.length,
      },
      regexScripts: scripts.map((script, index) => {
        const configured = regexByIndex.get(index)
        if (configured === undefined) return { ...script }
        return {
          ...script,
          disabled: configured.disabled,
          ...(configured.minDepth === undefined ? {} : { minDepth: configured.minDepth }),
          ...(configured.maxDepth === undefined ? {} : { maxDepth: configured.maxDepth }),
        }
      }),
    }
  }
  if (request.operation === 'generation') {
    return { ...structuredClone(active.preset), generation: withGeneration(active.preset.generation, request) }
  }
  const prompt = active.preset.prompts.find(item => item.identifier === request.identifier)
  if (prompt === undefined) throw new Error(`preset has no module ${JSON.stringify(request.identifier)}`)
  const nextOrder = active.preset.order.map(item => ({ ...item }))
  const index = nextOrder.findIndex(item => item.identifier === request.identifier)
  if (request.operation === 'toggle') {
    if (!canTogglePresetPrompt(active.preset, request.identifier)) {
      throw new Error(`preset module ${JSON.stringify(request.identifier)} has no configurable switch`)
    }
    if (index === -1) nextOrder.push({ identifier: request.identifier, enabled: request.enabled })
    else nextOrder[index] = { ...nextOrder[index]!, enabled: request.enabled }
    return { ...structuredClone(active.preset), order: nextOrder }
  }
  if (request.before === request.identifier) return structuredClone(active.preset)
  if (request.before !== undefined && !nextOrder.some(item => item.identifier === request.before)) {
    throw new Error(`preset order has no destination ${JSON.stringify(request.before)}`)
  }
  const entry = index === -1 ? { identifier: request.identifier, enabled: false } : nextOrder.splice(index, 1)[0]!
  const destination = request.before === undefined
    ? nextOrder.length
    : nextOrder.findIndex(item => item.identifier === request.before)
  nextOrder.splice(destination, 0, entry)
  return { ...structuredClone(active.preset), order: nextOrder }
}
