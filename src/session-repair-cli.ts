#!/usr/bin/env node

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { repairAgentRpSessionById, repairAgentRpSessionFile } from './session-repair.ts'

function usage(): never {
  console.error('用法：dsh-agent-rp-repair-session [--apply] <session.jsonl|session.jsonl.zstd>')
  console.error('      dsh-agent-rp-repair-session [--apply] --session <id> [--root <sessions目录>]')
  console.error('默认只读检查；关闭 DSH 后显式加 --apply 才会备份并修复。')
  process.exit(2)
}

const args = process.argv.slice(2)
let apply = false
let sessionId: string | undefined
let root: string | undefined
const positional: string[] = []
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]!
  if (argument === '--apply') {
    apply = true
  } else if (argument === '--session' || argument === '--root') {
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) usage()
    if (argument === '--session') sessionId = value
    else root = value
    index += 1
  } else if (argument.startsWith('--')) {
    usage()
  } else {
    positional.push(argument)
  }
}
if (sessionId === undefined ? positional.length !== 1 || root !== undefined : positional.length !== 0) usage()

const defaultRoot = resolve(process.env['DSH_HOME']?.trim() || resolve(homedir(), '.dsh'), 'sessions')

try {
  const result = sessionId === undefined
    ? await repairAgentRpSessionFile(positional[0]!, { apply })
    : await repairAgentRpSessionById(root ?? defaultRoot, sessionId, { apply })
  if (!apply) {
    console.log(`只读检查完成：${result.path}`)
    console.log(`会话 ID：${result.sessionId}`)
    console.log(`带旧 ignorable 字段的事件：${result.repairedEvents}`)
    console.log(`已经使用当前 envelope 的 Agent RP 事件：${result.alreadySafeEvents}`)
    if (result.repairedEvents > 0) console.log('请先完全关闭 DSH，再用同一条命令加 --apply 执行。')
  } else if (result.applied) {
    console.log(`已从 ${result.repairedEvents} 条旧事件移除 ignorable 字段。`)
    console.log(`原文件备份：${result.backupPath}`)
  } else {
    console.log('该会话不需要修复，未写入任何文件。')
  }
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
