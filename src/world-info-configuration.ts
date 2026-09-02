/** Host adapter for session-owned World Info management. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { cardFromImportMeta, readActiveSessionCharacter } from './import/session-character.ts'
import { readActiveSessionWorldInfos, type ActiveSessionWorldInfo } from './import/session-world-info.ts'
import {
  activeTavernWorldbooks,
  configureWorldInfo,
  encodeWorldInfoConfiguration,
  parseWorldInfoConfigurationRequest,
  readWorldInfoConfiguration,
  withTavernWorldbooks,
  type SessionLorebookSource,
} from './world-info-configuration-core.ts'
import { readTavernHelperState } from './tavern-helper.ts'
import { sessionEvents } from './session-events.ts'

function sessionWorldSource(value: ActiveSessionWorldInfo): SessionLorebookSource {
  const source = value.placement === 'actor' ? 'character' : 'standalone'
  return {
    id: `${source}:${value.result.sourceAttachmentId}`,
    name: value.result.name,
    source,
    lorebook: value.worldInfo.lorebook,
    degradations: value.result.degradations,
  }
}

/** Resolve all imported books in their prompt order from the durable Session log. */
export function readSessionLorebookSourcesFromEvents(events: readonly SessionEvent[]): readonly SessionLorebookSource[] {
  const active = readActiveSessionCharacter(events)
  const card = active === undefined ? undefined : cardFromImportMeta(active.meta)
  const worlds = readActiveSessionWorldInfos(events)
  const hasActorWorldSnapshot = worlds.some(world => world.placement === 'actor')
  return withTavernWorldbooks([
    // Direct imports and sessions created before character bindings used the
    // Character Card as their only durable world snapshot.
    ...(hasActorWorldSnapshot || card?.lorebook === undefined || active === undefined ? [] : [{
      id: `character:${active.result.sourceAttachmentId}`,
      name: card.lorebook.name?.trim() || `${card.nickname?.trim() || card.name}的世界书`,
      source: 'character' as const,
      lorebook: card.lorebook,
      degradations: card.degradations.filter(value => value.startsWith('lorebook-')),
    }]),
    ...worlds.map(sessionWorldSource),
  ], readTavernHelperState(events))
}

/** Host convenience wrapper for callers that already own an Agent. */
export function readSessionLorebookSources(agent: Agent): readonly SessionLorebookSource[] {
  return readSessionLorebookSourcesFromEvents(sessionEvents(agent.session))
}

/** Resolve only the books that should participate in the next model request from the Session log. */
export function readActiveSessionLorebookSourcesFromEvents(
  events: readonly SessionEvent[],
): readonly SessionLorebookSource[] {
  return activeTavernWorldbooks(readSessionLorebookSourcesFromEvents(events), readTavernHelperState(events))
}

/** Host convenience wrapper for callers that already own an Agent. */
export function readActiveSessionLorebookSources(agent: Agent): readonly SessionLorebookSource[] {
  return readActiveSessionLorebookSourcesFromEvents(sessionEvents(agent.session))
}

/** Execute one World Info manager mutation and persist its complete overlay snapshot. */
export function executeWorldInfoConfiguration(invocation: {
  readonly agent: Agent
  readonly rawInput: string
}): { readonly kind: 'success'; readonly text: string } {
  const current = readWorldInfoConfiguration(sessionEvents(invocation.agent.session))
  const next = configureWorldInfo(
    current,
    parseWorldInfoConfigurationRequest(invocation.rawInput),
    readSessionLorebookSources(invocation.agent),
  )
  return { kind: 'success', text: encodeWorldInfoConfiguration(next) }
}
