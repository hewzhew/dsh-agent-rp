/** Model-free SillyTavern history migration through a private Session command. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId, CommandResult } from '@deepseek-ai/dsh-commands'
import { CharacterLibrary } from './character-library.ts'
import { SillyTavernChatLibrary } from './sillytavern-chat-library.ts'
import type { SillyTavernChatLaunchRequest } from './sillytavern-chat-protocol.ts'

/** Validate a private browser-owned migration request. */
export function parseSillyTavernChatLaunchRequest(source: string): SillyTavernChatLaunchRequest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error: unknown) {
    throw new Error('聊天迁移请求不是有效 JSON', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('聊天迁移请求不是对象')
  const record = value as Record<string, unknown>
  if (record.format !== 0 || typeof record.importId !== 'string' || !/^chat-[a-f0-9]{32}$/u.test(record.importId)
    || (record.characterId !== undefined
      && (typeof record.characterId !== 'string' || !/^card-[a-f0-9]{32}$/u.test(record.characterId)))
    || Object.keys(record).some(key => key !== 'format' && key !== 'importId' && key !== 'characterId')) {
    throw new Error('聊天迁移请求字段无效')
  }
  return {
    format: 0,
    importId: record.importId,
    ...(typeof record.characterId === 'string' ? { characterId: record.characterId } : {}),
  }
}

/** Append imported history and optionally activate a Character Card without invoking a model. */
export function executeSillyTavernChatCommand(
  _chats: SillyTavernChatLibrary,
  _characters: CharacterLibrary,
  invocation: { readonly commandId: CommandId; readonly agent: Agent; readonly rawInput: string },
): CommandResult {
  void invocation
  throw new Error('这个版本的旧聊天迁移入口已停用，请刷新页面后重新选择 JSONL 文件')
}
