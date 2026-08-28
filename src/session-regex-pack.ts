/** Durable standalone regex-pack snapshots selected for one Roleplay Session. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ImportedRegexScript } from './import/types.ts'
import { parseRegexPackValue } from './regex-pack.ts'

/** Immutable pack content appended by its resource provider. */
export interface SessionRegexPackSnapshot {
  readonly format: 0
  readonly id: string
  readonly name: string
  readonly scripts: readonly ImportedRegexScript[]
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ordered global-scope regex rules selected explicitly for this Session. */
    'agent-rp/regex-pack-seed': SessionRegexPackSnapshot
  }
}

/** Validate one Session-owned pack without consulting the mutable library. */
export function parseSessionRegexPack(value: unknown): SessionRegexPackSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('会话正则包不是对象')
  const record = value as Record<string, unknown>
  if (record.format !== 0 || typeof record.id !== 'string' || !/^regex-[a-f0-9]{32}$/u.test(record.id)
    || typeof record.name !== 'string' || record.name.trim() === '' || record.name.length > 160
    || Object.keys(record).some(key => !['format', 'id', 'name', 'scripts'].includes(key))) {
    throw new Error('会话正则包字段无效')
  }
  return Object.freeze({
    format: 0,
    id: record.id,
    name: record.name,
    scripts: Object.freeze(parseRegexPackValue(record.scripts, `session regex pack ${record.id}`)),
  })
}

/** Append one immutable pack after rejecting duplicate resource ids. */
export function appendSessionRegexPack(
  events: readonly SessionEvent[],
  value: SessionRegexPackSnapshot,
): readonly SessionEvent[] {
  const snapshot = parseSessionRegexPack(value)
  if (readSessionRegexPacks(events).some(pack => pack.id === snapshot.id)) throw new Error('正则包资源不能重复')
  return Object.freeze([...structuredClone(events), {
    type: 'agent-rp/regex-pack-seed' as const,
    seq: events.length,
    time: Date.now(),
    data: snapshot,
  }])
}

/** Reconstruct selected packs in stable materialization order. */
export function readSessionRegexPacks(events: readonly SessionEvent[]): readonly SessionRegexPackSnapshot[] {
  const result: SessionRegexPackSnapshot[] = []
  const ids = new Set<string>()
  for (const event of events) {
    if (event.type !== 'agent-rp/regex-pack-seed') continue
    const pack = parseSessionRegexPack(event.data)
    if (ids.has(pack.id)) throw new Error('会话包含重复正则包资源')
    ids.add(pack.id)
    result.push(pack)
  }
  return Object.freeze(result)
}

/** Flatten every pack without losing pack or rule order. */
export function sessionRegexScripts(events: readonly SessionEvent[]): readonly ImportedRegexScript[] {
  return Object.freeze(readSessionRegexPacks(events).flatMap(pack => pack.scripts.map(script => ({ ...script }))))
}
