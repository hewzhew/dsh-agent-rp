/** @jsxRuntime classic */
/** @jsx React.createElement */
/** Local status list for every Tavern Helper script in the active Session. */

import React, { type ReactElement, useState } from 'react'
import type { TavernScriptTreeScope } from '../tavern-helper.ts'
import type { TavernScriptRuntimePhase } from './tavern-runtime.ts'

const MAX_LOCAL_ERROR_LENGTH = 2_000
const MAX_FAILURE_LABEL_LENGTH = 240
const MAX_FAILURE_REPORT_LENGTH = 64 * 1024

/** One script's local, player-visible lifecycle status. */
export interface TavernScriptStatusEntry {
  readonly key: string
  readonly name: string
  readonly scope: TavernScriptTreeScope
  readonly phase: TavernScriptRuntimePhase
  readonly error?: string
}

function scopeLabel(scope: TavernScriptTreeScope): string {
  switch (scope) {
    case 'global': return '全局'
    case 'preset': return '预设'
    case 'character': return '角色'
  }
}

function phaseLabel(phase: TavernScriptRuntimePhase): string {
  switch (phase) {
    case 'preparing': return '准备中'
    case 'permission-required': return '等待权限'
    case 'load-error': return '加载失败'
    case 'booting': return '启动中'
    case 'ready': return '运行中'
    case 'runtime-error': return '运行失败'
  }
}

function failed(
  phase: TavernScriptRuntimePhase,
): phase is Extract<TavernScriptRuntimePhase, 'load-error' | 'runtime-error'> {
  return phase === 'load-error' || phase === 'runtime-error'
}

function boundedError(error: string): string {
  return error.length <= MAX_LOCAL_ERROR_LENGTH
    ? error
    : `${error.slice(0, MAX_LOCAL_ERROR_LENGTH)}…`
}

function boundedLabel(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim() || fallback
  return normalized.length <= MAX_FAILURE_LABEL_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_FAILURE_LABEL_LENGTH)}…`
}

/** Structured local details for one failed Tavern Helper script. */
export interface TavernScriptFailureDetail {
  readonly key: string
  readonly name: string
  readonly scope: TavernScriptTreeScope
  readonly phase: Extract<TavernScriptRuntimePhase, 'load-error' | 'runtime-error'>
  readonly error: string
  readonly errorLength: number
  readonly errorTruncated: boolean
}

/** Collect every currently available failed-script detail with bounded string values. */
export function tavernScriptFailureDetails(
  entries: readonly TavernScriptStatusEntry[],
): readonly TavernScriptFailureDetail[] {
  return entries.flatMap(entry => {
    if (!failed(entry.phase)) return []
    const error = entry.error ?? '未提供本地错误'
    return [{
      key: boundedLabel(entry.key, 'unknown'),
      name: boundedLabel(entry.name, '未命名脚本'),
      scope: entry.scope,
      phase: entry.phase,
      error: boundedError(error),
      errorLength: error.length,
      errorTruncated: error.length > MAX_LOCAL_ERROR_LENGTH,
    }]
  })
}

/** Build an explicitly requested local report that includes failed script names and errors. */
export function tavernScriptFailureReport(entries: readonly TavernScriptStatusEntry[]): string | undefined {
  const failures = tavernScriptFailureDetails(entries)
  if (failures.length === 0) return undefined
  const report = [
    'Agent RP 酒馆脚本失败详情',
    '格式: agent-rp-tavern-failures-v0',
    `失败数: ${failures.length}`,
    '',
    ...failures.flatMap((entry, index) => [
      `[${index + 1}] ${entry.name}`,
      `范围: ${scopeLabel(entry.scope)}`,
      `阶段: ${phaseLabel(entry.phase)}`,
      '错误:',
      boundedError(entry.error ?? '未提供本地错误'),
      ...(entry.errorTruncated ? [`错误已截断: 是（原始长度 ${entry.errorLength} 字符）`] : []),
      '',
    ]),
  ].join('\n').trimEnd()
  return report.length <= MAX_FAILURE_REPORT_LENGTH
    ? report
    : `${report.slice(0, MAX_FAILURE_REPORT_LENGTH - 10).trimEnd()}\n…内容已截断`
}

/** Show all local script phases while keeping names and errors out of anonymous diagnostics. */
export function TavernScriptStatusList(props: {
  readonly entries: readonly TavernScriptStatusEntry[]
}): ReactElement {
  const ready = props.entries.filter(entry => entry.phase === 'ready').length
  const failures = props.entries.filter(entry => failed(entry.phase)).length
  const [copyNotice, setCopyNotice] = useState<string>()
  return <details open={failures > 0} data-agent-rp-tavern-local-status style={{
    borderBottom: '1px solid var(--dsw-alias-border-l2, #35373d)', flex: '0 0 auto', maxHeight: '42%',
    overflow: 'auto', padding: '0 12px',
  }}>
    <summary style={{ cursor: 'pointer', fontSize: '11px', opacity: .76, padding: '8px 0' }}>
      运行状态 {ready}/{props.entries.length}{failures === 0 ? '' : ` · ${failures} 个失败`}
    </summary>
    <div style={{ display: 'grid', gap: '6px', padding: '0 0 10px' }}>
      {failures > 0 && <div style={{ alignItems: 'center', display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '10px', opacity: .56 }}>只在点击后复制；内容包含脚本名和本地错误，不会自动上传。</span>
        <button type="button" data-agent-rp-tavern-copy-failures title="复制包含脚本名和本地错误的失败详情；发送前请检查内容"
          onClick={() => {
            const report = tavernScriptFailureReport(props.entries)
            if (report === undefined) return
            if (navigator.clipboard === undefined) {
              setCopyNotice('无法复制')
              return
            }
            setCopyNotice('正在复制…')
            void navigator.clipboard.writeText(report).then(() => {
              setCopyNotice('失败详情已复制')
            }, () => {
              setCopyNotice('复制失败')
            })
          }} style={{
            background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #41434a)', borderRadius: '7px',
            color: 'inherit', cursor: 'pointer', flex: '0 0 auto', font: 'inherit', fontSize: '10px', padding: '4px 7px',
          }}>{copyNotice ?? '复制失败详情'}</button>
      </div>}
      {props.entries.map(entry => <div key={entry.key}
        data-agent-rp-tavern-local-phase={entry.phase}
        data-agent-rp-tavern-local-scope={entry.scope}
        style={{
          background: 'var(--dsw-alias-bg-elevated, #202228)', borderRadius: '8px', padding: '7px 9px',
        }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
          <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.name.trim() || '未命名脚本'}
          </span>
          <span style={{
            color: failed(entry.phase) ? 'var(--dsw-alias-state-warning, #d5a64c)' : 'inherit',
            flex: '0 0 auto', fontSize: '11px', opacity: .7,
          }}>{scopeLabel(entry.scope)} · {phaseLabel(entry.phase)}</span>
        </div>
        {failed(entry.phase) && entry.error !== undefined && <p role="alert" style={{
          color: 'var(--dsw-alias-state-warning, #d5a64c)', fontSize: '11px', lineHeight: 1.5,
          margin: '6px 0 0', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
        }}>{boundedError(entry.error)}</p>}
      </div>)}
    </div>
  </details>
}
