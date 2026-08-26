/** Debug-only error attachment for a user-requested compatibility diagnostic copy. */

import type { AgentRpBrowserCompatibilitySnapshot } from './compatibility-diagnostic.ts'
import {
  tavernScriptFailureDetails,
  type TavernScriptFailureDetail,
  type TavernScriptStatusEntry,
} from './tavern-script-status.tsx'
import {
  worldInfoFailureDetails,
  type WorldInfoFailureDetail,
  type WorldInfoFailureReportBook,
} from './world-info-failure-report.ts'

/** Maximum UTF-8 byte count for the complete JSON text copied to the clipboard. */
export const MAX_AGENT_RP_COPIED_DIAGNOSTIC_BYTES = 64 * 1024

const UTF8_ENCODER = new TextEncoder()

interface AgentRpDebugFailureSection<T> {
  readonly total: number
  readonly included: number
  readonly truncated: boolean
  readonly failures: readonly T[]
}

/** Structured error details appended only when the global Debug switch is enabled. */
export interface AgentRpDebugErrors {
  readonly audit: 'agent-rp-debug-errors-v0'
  readonly tavernScripts?: AgentRpDebugFailureSection<TavernScriptFailureDetail>
  readonly worldInfo?: AgentRpDebugFailureSection<WorldInfoFailureDetail>
}

/** Clipboard report shape; the base compatibility snapshot remains unchanged. */
export type AgentRpCopiedDiagnostic = AgentRpBrowserCompatibilitySnapshot & {
  readonly debugErrors?: AgentRpDebugErrors
}

/** Serialize the exact indented JSON text written to the clipboard. */
export function serializeAgentRpCopiedDiagnostic(report: AgentRpCopiedDiagnostic): string {
  return JSON.stringify(report, null, 2)
}

function utf8Length(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength
}

function embeddedEntryLength(entry: unknown): number {
  const serialized = JSON.stringify(entry, null, 2)
  const continuationLines = serialized.match(/\n/gu)?.length ?? 0
  return utf8Length(serialized) + continuationLines * 8
}

function section<T>(all: readonly T[], included: readonly T[]): AgentRpDebugFailureSection<T> {
  return {
    total: all.length,
    included: included.length,
    truncated: included.length !== all.length,
    failures: included,
  }
}

function debugErrorsWithinLimit(
  snapshot: AgentRpBrowserCompatibilitySnapshot,
  tavernFailures: readonly TavernScriptFailureDetail[],
  worldInfoFailures: readonly WorldInfoFailureDetail[],
): AgentRpDebugErrors {
  const tavernIncluded: TavernScriptFailureDetail[] = []
  const worldInfoIncluded: WorldInfoFailureDetail[] = []
  let tavernIndex = 0
  let worldInfoIndex = 0
  const current = (): AgentRpDebugErrors => ({
    audit: 'agent-rp-debug-errors-v0',
    ...(tavernFailures.length === 0 ? {} : {
      tavernScripts: section(tavernFailures, tavernIncluded),
    }),
    ...(worldInfoFailures.length === 0 ? {} : {
      worldInfo: section(worldInfoFailures, worldInfoIncluded),
    }),
  })
  const currentReport = (): AgentRpCopiedDiagnostic => ({
    ...snapshot,
    debugErrors: current(),
  })
  let currentLength = utf8Length(serializeAgentRpCopiedDiagnostic(currentReport()))
  const tryInclude = <T,>(
    failures: readonly T[],
    included: T[],
    index: number,
  ): boolean => {
    const entry = failures[index]
    if (entry === undefined) return false
    const nextIncluded = included.length + 1
    const lengthIncrease = embeddedEntryLength(entry)
      + (included.length === 0 ? 16 : 10)
      + String(nextIncluded).length - String(included.length).length
      + (nextIncluded === failures.length ? 1 : 0)
    if (currentLength + lengthIncrease > MAX_AGENT_RP_COPIED_DIAGNOSTIC_BYTES) return false
    included.push(entry)
    currentLength += lengthIncrease
    return true
  }

  while (tavernIndex < tavernFailures.length || worldInfoIndex < worldInfoFailures.length) {
    if (tavernIndex < tavernFailures.length) {
      tryInclude(tavernFailures, tavernIncluded, tavernIndex)
      tavernIndex += 1
    }
    if (worldInfoIndex < worldInfoFailures.length) {
      tryInclude(worldInfoFailures, worldInfoIncluded, worldInfoIndex)
      worldInfoIndex += 1
    }
  }
  return current()
}

/** Build the local clipboard report while preserving the aggregate snapshot's public contract. */
export function collectAgentRpCopiedDiagnostic(
  snapshot: AgentRpBrowserCompatibilitySnapshot,
  options: {
    readonly debugEnabled: boolean
    readonly tavernScripts: readonly TavernScriptStatusEntry[]
    readonly worldInfoBooks: readonly WorldInfoFailureReportBook[]
  },
): AgentRpCopiedDiagnostic {
  if (!options.debugEnabled) return snapshot
  const tavernFailures = tavernScriptFailureDetails(options.tavernScripts)
  const worldInfoFailures = worldInfoFailureDetails(options.worldInfoBooks)
  if (tavernFailures.length === 0 && worldInfoFailures.length === 0) return snapshot
  return {
    ...snapshot,
    debugErrors: debugErrorsWithinLimit(snapshot, tavernFailures, worldInfoFailures),
  }
}
