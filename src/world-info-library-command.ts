/** Model-free World Info import through a private Session command. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { prepareWorldInfoImportResult, type WorldInfoImportMeta } from './import/session-world-info.ts'
import { WorldInfoLibrary } from './world-info-library.ts'
import {
  encodeWorldInfoLibraryImport,
  type WorldInfoLibraryLaunchRequest,
} from './world-info-library-protocol.ts'

/** Validate a private browser-owned World Info import request. */
export function parseWorldInfoLibraryLaunchRequest(source: string): WorldInfoLibraryLaunchRequest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error: unknown) {
    throw new Error('世界书导入请求不是有效 JSON', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('世界书导入请求不是对象')
  const record = value as Record<string, unknown>
  if (record.format !== 0 || typeof record.importId !== 'string'
    || !/^world-info-[a-f0-9]{32}$/u.test(record.importId)
    || Object.keys(record).some(key => key !== 'format' && key !== 'importId')) {
    throw new Error('世界书导入请求字段无效')
  }
  return { format: 0, importId: record.importId }
}

/** Activate one Host-owned World Info source without invoking a model. */
export function executeWorldInfoLibraryCommand(
  library: WorldInfoLibrary,
  invocation: { readonly commandId: CommandId; readonly agent: Agent; readonly rawInput: string },
): { readonly kind: 'success'; readonly text: string } {
  const request = parseWorldInfoLibraryLaunchRequest(invocation.rawInput)
  const source = invocation.agent.session.events.at(-1)
  if (source?.type !== 'command/run' || source.data.name !== 'rp-world-info-import'
    || String(source.data.commandId) !== String(invocation.commandId)) {
    throw new Error('世界书导入命令不是当前 Session 事件')
  }
  const resolved = library.resolve(request.importId)
  const attachment = {
    kind: 'file' as const,
    attachmentId: AttachmentId(`library:${request.importId}`),
    bytes: 1,
    name: `${resolved.upload.name}.json`,
    mediaType: 'application/json',
  }
  const value = prepareWorldInfoImportResult(resolved.worldInfo, source.seq, attachment)
  const { raw, ...result } = value
  const meta: WorldInfoImportMeta = { format: 0, result, raw }
  return {
    kind: 'success',
    text: encodeWorldInfoLibraryImport({ format: 0, importId: request.importId, meta: meta as unknown as JsonValue }),
  }
}
