import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentRpBrowserCompatibilitySnapshot } from '../src/client/compatibility-diagnostic.ts'
import {
  collectAgentRpCopiedDiagnostic,
  MAX_AGENT_RP_COPIED_DIAGNOSTIC_BYTES,
  serializeAgentRpCopiedDiagnostic,
} from '../src/client/debug-diagnostic-report.ts'
import type { TavernScriptStatusEntry } from '../src/client/tavern-script-status.tsx'
import type { WorldInfoFailureReportBook } from '../src/client/world-info-failure-report.ts'

const snapshot = {
  audit: 'agent-rp-browser-compat-v0',
  interactions: {
    characterLibrary: { launchers: 0, state: 'closed' },
    presetManager: { launchers: 0, state: 'closed' },
    sessionSettings: { launchers: 0, state: 'closed' },
    tavernPanel: { launchers: 1, mobileLaunchers: 0, state: 'closed' },
    tavernPermissions: { launchers: 0, state: 'closed' },
    worldInfoManager: { launchers: 0, state: 'closed' },
  },
  checks: {
    capabilitiesResolved: true,
    externalWindowsHealthy: true,
    iframeSandboxRestricted: true,
    inlineFrontendHealthy: true,
    interactiveEntriesPresent: true,
    preflightConsistent: true,
    preflightHealthy: true,
    tavernPermissionsConsistent: true,
    tavernRuntimeHealthy: false,
    turnRecordHealthy: true,
    worldEngineHealthy: false,
  },
  issues: ['tavern-runtime-failed', 'world-engine-degraded'],
} as const satisfies AgentRpBrowserCompatibilitySnapshot

const tavernFailure: TavernScriptStatusEntry = {
  key: 'preset:broken-script',
  name: '失败脚本',
  scope: 'preset',
  phase: 'load-error',
  error: 'ReferenceError: missingValue is not defined',
}

const worldInfoFailure: WorldInfoFailureReportBook = {
  name: '测试世界书',
  source: 'character',
  entries: [{
    sourceId: 'entry-17',
    name: '天气模板',
    reason: 'template-error',
    template: 'runtime-error',
    templateError: {
      name: 'ReferenceError',
      message: 'worldState is not defined',
      stack: 'at controller (agent-rp:ejs:259:12)',
    },
  }],
}

test('keeps the aggregate clipboard diagnostic unchanged while Debug is disabled', () => {
  const result = collectAgentRpCopiedDiagnostic(snapshot, {
    debugEnabled: false,
    tavernScripts: [tavernFailure],
    worldInfoBooks: [worldInfoFailure],
  })
  assert.equal(result, snapshot)
  assert.equal('debugErrors' in result, false)
  assert.doesNotMatch(JSON.stringify(result), /失败脚本|missingValue|测试世界书|entry-17/u)
})

test('does not add an empty error section while Debug is enabled without failures', () => {
  const result = collectAgentRpCopiedDiagnostic(snapshot, {
    debugEnabled: true,
    tavernScripts: [{
      key: tavernFailure.key,
      name: tavernFailure.name,
      scope: tavernFailure.scope,
      phase: 'ready',
    }],
    worldInfoBooks: [{
      ...worldInfoFailure,
      entries: [{ sourceId: 'entry-18', reason: 'primary-unmatched' }],
    }],
  })
  assert.equal(result, snapshot)
  assert.equal('debugErrors' in result, false)
})

test('includes every available Tavern failure field and an explicit missing-error value', () => {
  const result = collectAgentRpCopiedDiagnostic(snapshot, {
    debugEnabled: true,
    tavernScripts: [tavernFailure, {
      key: 'character:unnamed', name: '  ', scope: 'character', phase: 'runtime-error',
    }],
    worldInfoBooks: [],
  })
  assert.deepEqual(result.debugErrors, {
    audit: 'agent-rp-debug-errors-v0',
    tavernScripts: {
      total: 2,
      included: 2,
      truncated: false,
      failures: [{
        ...tavernFailure,
        errorLength: (tavernFailure.error ?? '').length,
        errorTruncated: false,
      }, {
        key: 'character:unnamed',
        name: '未命名脚本',
        scope: 'character',
        phase: 'runtime-error',
        error: '未提供本地错误',
        errorLength: '未提供本地错误'.length,
        errorTruncated: false,
      }],
    },
  })
})

test('includes every available World Info failure field without normal evaluation entries', () => {
  const result = collectAgentRpCopiedDiagnostic(snapshot, {
    debugEnabled: true,
    tavernScripts: [],
    worldInfoBooks: [{
      ...worldInfoFailure,
      entries: [
        ...worldInfoFailure.entries,
        { sourceId: 'entry-18', name: '正常条目', reason: 'active-keyword' },
      ],
    }],
  })
  assert.deepEqual(result.debugErrors, {
    audit: 'agent-rp-debug-errors-v0',
    worldInfo: {
      total: 1,
      included: 1,
      truncated: false,
      failures: [{
        bookName: '测试世界书',
        bookSource: 'character',
        entryName: '天气模板',
        sourceId: 'entry-17',
        reason: 'template-error',
        template: 'runtime-error',
        error: {
          name: 'ReferenceError',
          message: 'worldState is not defined',
          stack: 'at controller (agent-rp:ejs:259:12)',
        },
      }],
    },
  })
  assert.doesNotMatch(JSON.stringify(result.debugErrors), /正常条目|active-keyword/u)
})

test('includes Tavern and World Info sections together', () => {
  const result = collectAgentRpCopiedDiagnostic(snapshot, {
    debugEnabled: true,
    tavernScripts: [tavernFailure],
    worldInfoBooks: [worldInfoFailure],
  })
  assert.equal(result.debugErrors?.tavernScripts?.total, 1)
  assert.equal(result.debugErrors?.worldInfo?.total, 1)
  assert.equal(result.audit, snapshot.audit)
  assert.deepEqual(result.issues, snapshot.issues)
})

test('bounds the complete indented UTF-8 clipboard report and marks both oversized categories as truncated', () => {
  const tavernScripts = Array.from({ length: 100 }, (_, index): TavernScriptStatusEntry => ({
    key: `preset:${index}`,
    name: `脚本 ${index}`,
    scope: 'preset',
    phase: 'runtime-error',
    error: `错误 🚨 ${index} ${'x'.repeat(3_000)}`,
  }))
  const worldInfoBooks: readonly WorldInfoFailureReportBook[] = [{
    name: '超长世界书',
    source: 'standalone',
    entries: Array.from({ length: 100 }, (_, index) => ({
      sourceId: `entry-${index}`,
      name: `条目 ${index} ${'y'.repeat(300)}`,
      reason: 'regex-execution-limit' as const,
    })),
  }]
  const result = collectAgentRpCopiedDiagnostic(snapshot, {
    debugEnabled: true,
    tavernScripts,
    worldInfoBooks,
  })
  assert.ok(result.debugErrors !== undefined)
  const reportBytes = new TextEncoder().encode(serializeAgentRpCopiedDiagnostic(result)).byteLength
  assert.ok(reportBytes <= MAX_AGENT_RP_COPIED_DIAGNOSTIC_BYTES)
  assert.ok(reportBytes > MAX_AGENT_RP_COPIED_DIAGNOSTIC_BYTES - 4_096)
  assert.equal(result.debugErrors.tavernScripts?.total, 100)
  assert.equal(result.debugErrors.worldInfo?.total, 100)
  assert.equal(result.debugErrors.tavernScripts?.truncated, true)
  assert.equal(result.debugErrors.worldInfo?.truncated, true)
  assert.ok((result.debugErrors.tavernScripts?.included ?? 0) > 0)
  assert.ok((result.debugErrors.worldInfo?.included ?? 0) > 0)
  assert.equal(result.debugErrors.tavernScripts?.failures[0]?.errorLength, tavernScripts[0]?.error?.length)
  assert.equal(result.debugErrors.tavernScripts?.failures[0]?.errorTruncated, true)
})

test('skips an oversized World Info error and still includes later failures that fit', () => {
  const result = collectAgentRpCopiedDiagnostic(snapshot, {
    debugEnabled: true,
    tavernScripts: [],
    worldInfoBooks: [{
      name: '控制器世界书',
      source: 'character',
      entries: [{
        sourceId: 'oversized',
        reason: 'template-error',
        template: 'runtime-error',
        templateError: { message: 'x'.repeat(MAX_AGENT_RP_COPIED_DIAGNOSTIC_BYTES) },
      }, {
        sourceId: 'small',
        reason: 'regex-invalid',
      }],
    }],
  })

  assert.equal(result.debugErrors?.worldInfo?.total, 2)
  assert.equal(result.debugErrors?.worldInfo?.included, 1)
  assert.equal(result.debugErrors?.worldInfo?.truncated, true)
  assert.deepEqual(result.debugErrors?.worldInfo?.failures.map(entry => entry.sourceId), ['small'])
  assert.ok(new TextEncoder().encode(serializeAgentRpCopiedDiagnostic(result)).byteLength
    <= MAX_AGENT_RP_COPIED_DIAGNOSTIC_BYTES)
})

test('measures the final escaped UTF-8 JSON instead of estimating entry growth', () => {
  const result = collectAgentRpCopiedDiagnostic(snapshot, {
    debugEnabled: true,
    tavernScripts: Array.from({ length: 80 }, (_, index) => ({
      key: `preset:${index}`,
      name: `换行\\引号\"${index}`,
      scope: 'preset' as const,
      phase: 'runtime-error' as const,
      error: `${'\\\"\n'.repeat(900)}🚨`,
    })),
    worldInfoBooks: [],
  })

  const bytes = new TextEncoder().encode(serializeAgentRpCopiedDiagnostic(result)).byteLength
  assert.ok(bytes <= MAX_AGENT_RP_COPIED_DIAGNOSTIC_BYTES)
  assert.equal(result.debugErrors?.tavernScripts?.truncated, true)
})
