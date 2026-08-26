import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  tavernScriptFailureReport,
  TavernScriptStatusList,
  type TavernScriptStatusEntry,
} from '../src/client/tavern-script-status.tsx'

test('shows one failed background script beside every ready Tavern script', () => {
  const entries: TavernScriptStatusEntry[] = [
    ...Array.from({ length: 6 }, (_, index) => ({
      key: `ready-${index}`,
      name: `正常脚本 ${index + 1}`,
      scope: index < 4 ? 'preset' as const : 'character' as const,
      phase: 'ready' as const,
    })),
    {
      key: 'failed-background',
      name: '后台变量脚本',
      scope: 'character',
      phase: 'load-error',
      error: '缺少已声明的模块入口',
    },
  ]

  const markup = renderToStaticMarkup(createElement(TavernScriptStatusList, { entries }))

  assert.match(markup, /<details open="" data-agent-rp-tavern-local-status/u)
  assert.match(markup, /运行状态 6\/7 · 1 个失败/u)
  assert.equal((markup.match(/data-agent-rp-tavern-local-phase="ready"/gu) ?? []).length, 6)
  assert.match(markup, /后台变量脚本/u)
  assert.match(markup, /角色 · 加载失败/u)
  assert.match(markup, /缺少已声明的模块入口/u)
  assert.match(markup, /data-agent-rp-tavern-copy-failures/u)
  assert.match(markup, /内容包含脚本名和本地错误，不会自动上传/u)
})

test('bounds local errors without adding them to compatibility diagnostics', () => {
  const markup = renderToStaticMarkup(createElement(TavernScriptStatusList, { entries: [{
    key: 'failed', name: '脚本', scope: 'preset', phase: 'runtime-error', error: 'x'.repeat(2_100),
  }] }))

  assert.match(markup, /预设 · 运行失败/u)
  assert.match(markup, /x{2000}…/u)
  assert.doesNotMatch(markup, /x{2001}/u)
  assert.doesNotMatch(markup, /data-agent-rp-tavern-phase=/u)
})

test('copies only failed script details through an explicitly local report', () => {
  const report = tavernScriptFailureReport([
    { key: 'ready', name: '正常脚本', scope: 'preset', phase: 'ready' },
    { key: 'load', name: '模块加载器', scope: 'character', phase: 'load-error', error: '缺少入口' },
    { key: 'runtime', name: '', scope: 'global', phase: 'runtime-error' },
  ])

  assert.equal(report, [
    'Agent RP 酒馆脚本失败详情',
    '格式: agent-rp-tavern-failures-v0',
    '失败数: 2',
    '',
    '[1] 模块加载器',
    '范围: 角色',
    '阶段: 加载失败',
    '错误:',
    '缺少入口',
    '',
    '[2] 未命名脚本',
    '范围: 全局',
    '阶段: 运行失败',
    '错误:',
    '未提供本地错误',
  ].join('\n'))
  assert.doesNotMatch(report ?? '', /正常脚本/u)
  assert.equal(tavernScriptFailureReport([{ key: 'ready', name: '正常', scope: 'preset', phase: 'ready' }]), undefined)
})

test('bounds individual errors and the complete local failure report', () => {
  const report = tavernScriptFailureReport(Array.from({ length: 40 }, (_, index) => ({
    key: `failed-${index}`,
    name: `失败脚本 ${index}`,
    scope: 'preset' as const,
    phase: 'runtime-error' as const,
    error: 'x'.repeat(2_100),
  })))

  assert.ok(report !== undefined)
  assert.ok(report.length <= 64 * 1024)
  assert.match(report, /x{2000}…/u)
  assert.match(report, /错误已截断: 是（原始长度 2100 字符）/u)
  assert.match(report, /…内容已截断$/u)
})
