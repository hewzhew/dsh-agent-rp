/** Model-free character-library launch through a private Session command. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId, CommandResult } from '@deepseek-ai/dsh-commands'
import { CharacterLibrary } from './character-library.ts'
import type { CharacterLibraryLaunchRequest } from './character-library-protocol.ts'
import { parseSessionPersona } from './session-persona.ts'

/** Validate the browser-owned request without accepting filesystem paths or extra fields. */
export function parseCharacterLibraryLaunchRequest(source: string): CharacterLibraryLaunchRequest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error: unknown) {
    throw new Error('角色库启动请求不是有效 JSON', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('角色库启动请求不是对象')
  const record = value as Record<string, unknown>
  if (record.format !== 0 || typeof record.characterId !== 'string'
    || !/^card-[a-f0-9]{32}$/u.test(record.characterId)
    || typeof record.greetingIndex !== 'number' || !Number.isSafeInteger(record.greetingIndex) || record.greetingIndex < 0
    || Object.keys(record).some(key => key !== 'format' && key !== 'characterId' && key !== 'greetingIndex' && key !== 'persona')) {
    throw new Error('角色库启动请求字段无效')
  }
  const persona = record.persona === undefined ? undefined : parseSessionPersona(record.persona)
  return {
    format: 0,
    characterId: record.characterId,
    greetingIndex: record.greetingIndex,
    ...(persona === undefined ? {} : { persona }),
  }
}

/** Activate one local card and append its selected opening without invoking a model. */
export function executeCharacterLibraryCommand(
  _library: CharacterLibrary,
  invocation: {
    readonly commandId: CommandId
    readonly agent: Agent
    readonly rawInput: string
  },
): CommandResult {
  void invocation
  throw new Error('这个版本的旧角色启动入口已停用，请刷新页面后从角色库重新开始')
}
