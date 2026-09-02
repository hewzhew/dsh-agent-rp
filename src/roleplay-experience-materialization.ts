/** Source-neutral assembly of reusable resources into one replayable Roleplay Session seed. */

import { Session, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  RoleplayExperienceSessionLaunchRequest,
} from './session-launch-protocol.ts'
import type { PreparedAgentRpSession } from './session-launch.ts'
import type { RoleplayResourceSelection } from './roleplay-resource-catalog-protocol.ts'
import { RoleplayResourceCatalog } from './roleplay-resource-catalog.ts'
import { appendRoleplayExperienceSelection } from './roleplay-experience-selection.ts'
import { sessionEvents } from './session-events.ts'

type ExperienceSelection = Omit<RoleplayExperienceSessionLaunchRequest, 'format' | 'sourceSessionId' | 'kind'>

function requireKind(
  selection: RoleplayResourceSelection,
  kind: RoleplayResourceSelection['kind'],
  label: string,
): void {
  if (selection.kind !== kind) throw new Error(`${label}必须引用 ${kind} 资源`)
}

function descriptorName(catalog: RoleplayResourceCatalog, selection: RoleplayResourceSelection): string {
  const located = catalog.locate(selection.kind, selection.id)
  if (located === undefined) throw new Error(`找不到所选 ${selection.kind} 资源`)
  if (located.descriptor.availability !== 'available') throw new Error(`所选 ${selection.kind} 资源已收纳`)
  return located.descriptor.name
}

function navigableSeed(events: readonly SessionEvent[]): readonly SessionEvent[] {
  if (events.some(event => event.type === 'turn/start')) return events
  const next: SessionEvent[] = [...structuredClone(events)]
  const time = Date.now()
  next.push({ type: 'turn/start', seq: SessionSeq(next.length), time, data: { turn: 1 } })
  next.push({
    type: 'turn/end',
    seq: SessionSeq(next.length),
    time,
    data: { turn: 1, reason: { kind: 'completed' } },
  })
  const validated = Session.create(SessionId('agent-rp-experience-navigation-validation'), next)
  return Object.freeze(sessionEvents(validated).slice(0, next.length))
}

/**
 * Materialize independently selected resources in semantic experience order.
 * Providers preserve the current Session prefix and append immutable events when
 * the selected resource is not already active; source formats stay provider-owned.
 */
export function prepareRoleplayExperienceSession(
  catalog: RoleplayResourceCatalog,
  selection: ExperienceSelection,
): PreparedAgentRpSession {
  const worlds = selection.worlds ?? []
  const regexPacks = selection.regexPacks ?? []
  if (worlds.length > 16) throw new Error('一次体验最多选择 16 个世界资源')
  if (new Set(worlds.map(world => `${world.kind}\u0000${world.id}`)).size !== worlds.length) {
    throw new Error('世界资源不能重复')
  }
  for (const world of worlds) requireKind(world, 'world', '世界选择')
  if (regexPacks.length > 16) throw new Error('一次体验最多选择 16 个正则包资源')
  if (new Set(regexPacks.map(pack => `${pack.kind}\u0000${pack.id}`)).size !== regexPacks.length) {
    throw new Error('正则包资源不能重复')
  }
  for (const pack of regexPacks) requireKind(pack, 'regex', '正则包选择')
  if (selection.participant !== undefined) requireKind(selection.participant, 'persona', '玩家身份')
  if (selection.promptPolicy !== undefined) requireKind(selection.promptPolicy, 'prompt-policy', '提示策略')
  if (selection.mode === 'character') {
    if (selection.actor === undefined) throw new Error('角色体验必须选择角色资源')
    requireKind(selection.actor, 'actor', '角色选择')
  } else if (selection.mode === 'scene') {
    if (selection.actor !== undefined) throw new Error('场景体验不能同时选择顶层角色')
    if (worlds.length === 0) throw new Error('场景体验必须选择至少一个世界资源')
  } else {
    throw new Error('角色体验模式无效')
  }

  const participantName = selection.participant === undefined
    ? undefined
    : descriptorName(catalog, selection.participant)
  const context = {
    mode: selection.mode,
    ...(participantName === undefined ? {} : { participantName }),
  } as const
  const primary = selection.mode === 'character' ? selection.actor! : worlds[0]!
  let title = descriptorName(catalog, primary)
  let events: readonly SessionEvent[] = []
  const ordered: readonly RoleplayResourceSelection[] = [
    primary,
    ...(selection.participant === undefined ? [] : [selection.participant]),
    ...(selection.mode === 'character' ? worlds : worlds.slice(1)),
    ...regexPacks,
    ...(selection.promptPolicy === undefined ? [] : [selection.promptPolicy]),
  ]
  for (const resource of ordered) {
    const materialized = catalog.materialize(resource, events, context)
    events = materialized.events
    if (resource === primary && materialized.title !== undefined) title = materialized.title
  }
  events = appendRoleplayExperienceSelection(events, {
    mode: selection.mode,
    ...(selection.actor === undefined ? {} : { actor: selection.actor }),
    ...(selection.participant === undefined ? {} : { participant: selection.participant }),
    worlds,
    ...(selection.promptPolicy === undefined ? {} : { promptPolicy: selection.promptPolicy }),
    regexPacks,
  })
  return Object.freeze({ seed: navigableSeed(events), title })
}
