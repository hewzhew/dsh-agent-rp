/** Durable source-neutral resource choices for one Roleplay experience. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  type RoleplayResourceKind,
  type RoleplayResourceSelection,
} from './roleplay-resource-catalog-protocol.ts'

/** Immutable resource references selected when a new experience is assembled. */
export interface RoleplayExperienceSelectionSnapshot {
  readonly format: 0
  readonly mode: 'character' | 'scene'
  readonly actor?: RoleplayResourceSelection
  readonly participant?: RoleplayResourceSelection
  readonly worlds: readonly RoleplayResourceSelection[]
  readonly promptPolicy?: RoleplayResourceSelection
  readonly regexPacks: readonly RoleplayResourceSelection[]
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable selection provenance; all model-visible payloads live in provider snapshot events. */
    'agent-rp/experience-selection': RoleplayExperienceSelectionSnapshot
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('角色体验选择快照不是对象')
  }
  return value as Record<string, unknown>
}

function parseSelection(value: unknown, expected: RoleplayResourceKind): RoleplayResourceSelection {
  const record = object(value)
  if (record.kind !== expected || typeof record.id !== 'string' || record.id === '' || record.id.length > 512
    || record.id.trim() !== record.id || /\s/u.test(record.id)
    || (record.variant !== undefined && (typeof record.variant !== 'string' || record.variant === ''
      || record.variant.length > 256
      || record.variant.trim() !== record.variant || /\s/u.test(record.variant)))
    || Object.keys(record).some(key => key !== 'kind' && key !== 'id' && key !== 'variant')) {
    throw new Error(`角色体验 ${expected} 资源选择无效`)
  }
  return Object.freeze({
    kind: expected,
    id: record.id,
    ...(typeof record.variant === 'string' ? { variant: record.variant } : {}),
  })
}

/** Validate a Session-owned experience selection without consulting mutable libraries. */
export function parseRoleplayExperienceSelection(value: unknown): RoleplayExperienceSelectionSnapshot {
  const record = object(value)
  if (record.format !== 0 || (record.mode !== 'character' && record.mode !== 'scene')
    || !Array.isArray(record.worlds) || record.worlds.length > 16
    || (record.regexPacks !== undefined && (!Array.isArray(record.regexPacks) || record.regexPacks.length > 16))
    || Object.keys(record).some(key => ![
      'format', 'mode', 'actor', 'participant', 'worlds', 'promptPolicy', 'regexPacks',
    ].includes(key))) {
    throw new Error('角色体验选择快照字段无效')
  }
  const actor = record.actor === undefined ? undefined : parseSelection(record.actor, 'actor')
  const participant = record.participant === undefined
    ? undefined
    : parseSelection(record.participant, 'persona')
  const worlds = record.worlds.map(value => parseSelection(value, 'world'))
  const promptPolicy = record.promptPolicy === undefined
    ? undefined
    : parseSelection(record.promptPolicy, 'prompt-policy')
  const regexPacks = (record.regexPacks ?? []).map(value => parseSelection(value, 'regex'))
  if (new Set(worlds.map(world => world.id)).size !== worlds.length
    || new Set(regexPacks.map(pack => pack.id)).size !== regexPacks.length
    || (record.mode === 'character' && actor === undefined)
    || (record.mode === 'scene' && (actor !== undefined || worlds.length === 0))) {
    throw new Error('角色体验选择组合无效')
  }
  return Object.freeze({
    format: 0,
    mode: record.mode,
    ...(actor === undefined ? {} : { actor }),
    ...(participant === undefined ? {} : { participant }),
    worlds: Object.freeze(worlds),
    ...(promptPolicy === undefined ? {} : { promptPolicy }),
    regexPacks: Object.freeze(regexPacks),
  })
}

/** Append the exact choices after every provider has frozen its content snapshots. */
export function appendRoleplayExperienceSelection(
  events: readonly SessionEvent[],
  value: Omit<RoleplayExperienceSelectionSnapshot, 'format'>,
): readonly SessionEvent[] {
  const data = parseRoleplayExperienceSelection({ format: 0, ...value })
  return Object.freeze([...structuredClone(events), {
    type: 'agent-rp/experience-selection' as const,
    seq: events.length,
    time: Date.now(),
    ignorable: true,
    data,
  }])
}

/** Return the latest explicit source-neutral selection recorded in the Session log. */
export function readRoleplayExperienceSelection(
  events: readonly SessionEvent[],
): RoleplayExperienceSelectionSnapshot | undefined {
  let active: RoleplayExperienceSelectionSnapshot | undefined
  for (const event of events) {
    if (event.type !== 'agent-rp/experience-selection') continue
    active = parseRoleplayExperienceSelection(event.data)
  }
  return active
}
