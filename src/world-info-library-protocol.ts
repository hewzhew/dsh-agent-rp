/** Browser-safe values for direct World Info imports. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Same-origin upload endpoint served by the Agent RP Host plugin. */
export const WORLD_INFO_LIBRARY_PATH = '/api/agent-rp/world-info'

/** Compact description of one retained World Info source. */
export interface WorldInfoLibraryUpload {
  readonly id: string
  readonly name: string
  readonly entryCount: number
  readonly degradations: readonly string[]
  readonly defaultForNewSessions: boolean
}

/** Host-owned preference for attaching one retained World Info source to future RP Sessions. */
export interface WorldInfoLibraryPreferenceRequest {
  readonly format: 0
  readonly id: string
  readonly defaultForNewSessions: boolean
}

/** Explicit removal of one reusable source; existing Session snapshots remain valid. */
export interface WorldInfoLibraryDeleteRequest {
  readonly format: 0
  readonly id: string
}

/** Successful browser upload response. */
export interface WorldInfoLibraryUploadResponse {
  readonly format: 0
  readonly upload: WorldInfoLibraryUpload
}

/** Retained World Info sources available for reuse or local RP interoperability. */
export interface WorldInfoLibraryListResponse {
  readonly format: 0
  readonly entries: readonly WorldInfoLibraryUpload[]
}

/** Private command input selecting one Host-owned World Info source. */
export interface WorldInfoLibraryLaunchRequest {
  readonly format: 0
  readonly importId: string
}

/** Durable World Info import stored in a native command result. */
export interface WorldInfoLibraryCommandRecord {
  readonly format: 0
  readonly importId: string
  readonly meta: JsonValue
}

const RESULT_PREFIX = 'agent-rp-world-info-library-v0:'

/** Serialize one direct World Info import into the Session command log. */
export function encodeWorldInfoLibraryImport(record: WorldInfoLibraryCommandRecord): string {
  return `${RESULT_PREFIX}${JSON.stringify(record)}`
}

/** Decode a direct World Info import while declining unrelated command output. */
export function decodeWorldInfoLibraryImport(source: string | undefined): WorldInfoLibraryCommandRecord | undefined {
  if (source?.startsWith(RESULT_PREFIX) !== true) return undefined
  let value: unknown
  try {
    value = JSON.parse(source.slice(RESULT_PREFIX.length))
  } catch (error: unknown) {
    throw new Error('世界书导入结果不是有效 JSON', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('世界书导入结果不是对象')
  const record = value as Record<string, unknown>
  if (record.format !== 0 || typeof record.importId !== 'string'
    || !/^world-info-[a-f0-9]{32}$/u.test(record.importId)
    || typeof record.meta !== 'object' || record.meta === null || Array.isArray(record.meta)
    || Object.keys(record).some(key => key !== 'format' && key !== 'importId' && key !== 'meta')) {
    throw new Error('世界书导入结果字段无效')
  }
  return record as unknown as WorldInfoLibraryCommandRecord
}
