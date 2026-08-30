/** Host-version-neutral codec for reply-version command results. */

import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'

export const GENERATION_STATE_RESULT_PREFIX = 'agent-rp-generation-v0:'

/** MVU checkpoint selected by one completed reply-version command. */
export interface GenerationMvuCheckpoint {
  readonly surfaceSeq: number
  readonly mvu: {
    readonly statData: JsonValue
    readonly updateCount: number
    readonly lastError?: string
  }
}

/** Serialize one complete reply-version payload into a private command result. */
export function encodeGenerationCommandResult(value: unknown): string {
  return `${GENERATION_STATE_RESULT_PREFIX}${JSON.stringify(value)}`
}

/** Decode one reply-version payload while declining unrelated command results. */
export function decodeGenerationCommandResult(text: string | undefined): Record<string, unknown> | undefined {
  if (text?.startsWith(GENERATION_STATE_RESULT_PREFIX) !== true) return undefined
  const value: unknown = JSON.parse(text.slice(GENERATION_STATE_RESULT_PREFIX.length))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('回复版本结果必须是对象')
  }
  return value as Record<string, unknown>
}

/** Decode the selected MVU checkpoint without importing the generation runtime. */
export function decodeGenerationMvuCheckpoint(text: string | undefined): GenerationMvuCheckpoint | undefined {
  const result = decodeGenerationCommandResult(text)
  if (result === undefined || result.mvu === undefined) return undefined
  if (!Number.isSafeInteger(result.surfaceSeq) || Number(result.surfaceSeq) < 0
    || typeof result.mvu !== 'object' || result.mvu === null || Array.isArray(result.mvu)) {
    throw new Error('回复版本 MVU 检查点无效')
  }
  const mvu = result.mvu as Record<string, unknown>
  const statData = snapshotJsonValue(mvu.statData) as JsonValue | undefined
  if (statData === undefined || !Number.isSafeInteger(mvu.updateCount) || Number(mvu.updateCount) < 0
    || (mvu.lastError !== undefined && typeof mvu.lastError !== 'string')) {
    throw new Error('回复版本 MVU 检查点无效')
  }
  return {
    surfaceSeq: Number(result.surfaceSeq),
    mvu: {
      statData,
      updateCount: Number(mvu.updateCount),
      ...(mvu.lastError === undefined ? {} : { lastError: mvu.lastError }),
    },
  }
}
