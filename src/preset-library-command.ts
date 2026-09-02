/** Human-command adapter for reusable preset library actions. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { readActiveSessionPreset } from './import/session-preset.ts'
import { PresetLibrary } from './preset-library.ts'
import { encodePresetLibraryResult, type PresetLibraryCommandResult } from './preset-library-protocol.ts'
import { sessionEvents } from './session-events.ts'

type LibraryRequest =
  | { readonly operation: 'list' }
  | { readonly operation: 'select'; readonly id: string }
  | { readonly operation: 'save'; readonly name: string }
  | { readonly operation: 'rename'; readonly id: string; readonly name: string }
  | { readonly operation: 'delete'; readonly id: string }

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('预设库请求必须是对象')
  return value as Record<string, unknown>
}

/** Parse one private preset-library request from the browser UI. */
export function parsePresetLibraryRequest(source: string): LibraryRequest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error: unknown) {
    throw new Error('预设库请求不是有效 JSON', { cause: error })
  }
  const request = object(value)
  if (request.operation === 'list') return { operation: 'list' }
  if ((request.operation === 'select' || request.operation === 'delete') && typeof request.id === 'string') {
    return { operation: request.operation, id: request.id }
  }
  if (request.operation === 'save' && typeof request.name === 'string') {
    return { operation: 'save', name: request.name }
  }
  if (request.operation === 'rename' && typeof request.id === 'string' && typeof request.name === 'string') {
    return { operation: 'rename', id: request.id, name: request.name }
  }
  throw new Error('预设库请求包含未知操作或无效字段')
}

function publish(agent: Agent, library: PresetLibrary, operation: PresetLibraryCommandResult['operation']): PresetLibraryCommandResult {
  const active = readActiveSessionPreset(sessionEvents(agent.session))
  let linkedLibraryId: string | undefined
  if (active !== undefined && active.libraryId === undefined) {
    const imported = library.import(active.importedPreset, active.result.name)
    linkedLibraryId = imported.id
  }
  return {
    format: 0,
    operation,
    entries: library.list(),
    ...(linkedLibraryId === undefined ? {} : { linkedLibraryId }),
  }
}

/** Execute one library action and project its updated roster into the current Session. */
export function executePresetLibraryCommand(
  library: PresetLibrary,
  invocation: { readonly agent: Agent; readonly rawInput: string },
): { readonly kind: 'success'; readonly text: string } {
  const request = parsePresetLibraryRequest(invocation.rawInput)
  let selected: PresetLibraryCommandResult['selected']
  if (request.operation === 'select') {
    const entry = library.get(request.id)
    selected = { libraryId: entry.id, name: entry.name, preset: entry.preset }
  } else if (request.operation === 'save') {
    const active = readActiveSessionPreset(sessionEvents(invocation.agent.session))
    if (active === undefined) throw new Error('当前会话还没有可保存的预设')
    library.save(request.name, active.preset)
  } else if (request.operation === 'delete') {
    library.delete(request.id)
  } else if (request.operation === 'rename') {
    library.rename(request.id, request.name)
  }
  return {
    kind: 'success',
    text: encodePresetLibraryResult({
      ...publish(invocation.agent, library, request.operation),
      ...(selected === undefined ? {} : { selected }),
    }),
  }
}
