/** Session-log adapter from current SillyTavern assets into the native Roleplay runtime. */

import type { Session } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'
import { cardFromImportMeta, readActiveSessionCharacter } from './import/session-character.ts'
import { readSillyTavernChatIdentity, type SillyTavernChatIdentity } from './import/sillytavern-chat-seed.ts'
import {
  readWorldInfoLibrarySessionSeed,
  type WorldInfoLibrarySeedRecord,
} from './import/session-world-info.ts'
import { readActiveSessionPreset, type ActiveSessionPreset } from './import/session-preset.ts'
import type { ImportedCharacterCard } from './import/types.ts'
import {
  MVU_ROLEPLAY_MODULE_ID,
  MVU_ROLEPLAY_STATE_ID,
  readCurrentSessionMvuStateFromLorebooks,
  type MvuStateSnapshot,
} from './mvu.ts'
import { resolveSessionPersonaIdentity } from './session-persona.ts'
import { readRoleplayExperienceSelection } from './roleplay-experience-selection.ts'
import {
  readTavernHelperState,
  TAVERN_HELPER_ROLEPLAY_MODULE_ID,
  TAVERN_HELPER_ROLEPLAY_STATE_ID,
  type TavernHelperState,
} from './tavern-helper.ts'
import {
  configuredLorebook,
  readWorldInfoConfiguration,
  worldInfoTokenBudget,
  type SessionLorebookSource,
} from './world-info-configuration-core.ts'
import { readActiveSessionLorebookSourcesFromEvents } from './world-info-configuration.ts'
import {
  ROLEPLAY_AGENT_MODULE_ID,
  ROLEPLAY_EJS_ADAPTER_MODULE_ID,
  ROLEPLAY_MEMORY_MODULE_ID,
  ROLEPLAY_PROMPT_ADAPTER_MODULE_ID,
  ROLEPLAY_PROMPT_MODULE_ID,
  ROLEPLAY_TURN_PHASES,
  ROLEPLAY_WORLD_MODULE_ID,
  type RoleplayModuleBinding,
  type RoleplayResourceRef,
  type RoleplayRuntimeSnapshot,
} from './roleplay-runtime.ts'
import type { RoleplayRuntimeExtensionRegistry } from './roleplay-runtime-extension.ts'
import type { RoleplayPhaseModuleOutcome } from './roleplay-turn-plan.ts'
import {
  readRoleplayStates,
  ROLEPLAY_STATE_MODULE_ID,
  type RoleplayStateSnapshot,
} from './roleplay-state.ts'
import { readRoleplayTurnMode, type RoleplayTurnMode } from './roleplay-turn-mode.ts'
import { readNativePromptPolicy, type NativePromptPolicySnapshot } from './native-prompt-policy.ts'
import { readSessionRegexPacks, type SessionRegexPackSnapshot } from './session-regex-pack.ts'

/** One source plus the Session overlay that will be evaluated for this turn. */
export interface ConfiguredRoleplayLorebook {
  readonly source: SessionLorebookSource
  readonly configured: SessionLorebookSource['lorebook']
}

/** Adapter-private values retained while existing renderers migrate onto the runtime contract. */
export interface ResolvedSessionRoleplayRuntime {
  readonly snapshot: RoleplayRuntimeSnapshot
  readonly turnMode: RoleplayTurnMode
  readonly nativeStates: readonly RoleplayStateSnapshot[]
  readonly card?: ImportedCharacterCard
  readonly importedChat?: SillyTavernChatIdentity
  readonly worldScenario?: WorldInfoLibrarySeedRecord
  readonly preset?: ActiveSessionPreset
  readonly nativePromptPolicy?: NativePromptPolicySnapshot
  readonly regexPacks: readonly SessionRegexPackSnapshot[]
  readonly tavern?: TavernHelperState
  readonly mvu?: MvuStateSnapshot
  readonly lorebooks: readonly ConfiguredRoleplayLorebook[]
  readonly extensionOutcomes: {
    readonly prepare: readonly RoleplayPhaseModuleOutcome[]
    readonly recall: readonly RoleplayPhaseModuleOutcome[]
  }
}

function sessionResource(id: string, name: string, adapter: string): RoleplayResourceRef {
  return { id, name, owner: 'session', adapter }
}

function runtimeModule(
  id: string,
  source: RoleplayModuleBinding['source'],
  phases: RoleplayModuleBinding['phases'],
  stateIds: readonly string[] = [],
) {
  return {
    id,
    source,
    phases,
    ...(stateIds.length === 0 ? {} : { stateIds }),
  } satisfies RoleplayModuleBinding
}

/**
 * Resolve the immutable resources participating in the next Roleplay turn.
 * Every Session-owned value is reconstructed from the event log; compatibility
 * formats stay behind this adapter instead of becoming the runtime contract.
 */
export function resolveSessionRoleplayRuntime(input: {
  readonly session: Session
  readonly deployment: ResolvedConfig
  readonly memoryWriteAvailable?: boolean
  readonly templateEngineAvailable?: boolean
  readonly extensions?: RoleplayRuntimeExtensionRegistry
}): ResolvedSessionRoleplayRuntime {
  const events = input.session.events
  const activeCharacter = readActiveSessionCharacter(events)
  const importedCard = activeCharacter === undefined ? undefined : cardFromImportMeta(activeCharacter.meta)
  const importedChat = readSillyTavernChatIdentity(events)
  const worldScenario = readWorldInfoLibrarySessionSeed(events)
  const preset = readActiveSessionPreset(events)
  const nativePromptPolicy = readNativePromptPolicy(events)
  const regexPacks = readSessionRegexPacks(events)
  if (preset !== undefined && nativePromptPolicy !== undefined) {
    throw new Error('Roleplay Session cannot activate imported and native prompt policies together')
  }
  const tavern = readTavernHelperState(events)
  const turnMode = readRoleplayTurnMode(events)
  const nativeStates = readRoleplayStates(events)
  const worldConfiguration = readWorldInfoConfiguration(events)
  const lorebooks = readActiveSessionLorebookSourcesFromEvents(events).map(source => ({
    source,
    configured: configuredLorebook(source, worldConfiguration).lorebook,
  }))
  const card = importedCard === undefined
    ? undefined
    : (() => {
        const { lorebook: _importedLorebook, ...withoutLorebook } = importedCard
        return withoutLorebook
      })()
  const identity = resolveSessionPersonaIdentity(
    events,
    activeCharacter?.result.userName,
    importedChat?.userName,
  )
  const mvu = readCurrentSessionMvuStateFromLorebooks(
    lorebooks.map(value => value.configured),
    input.session,
  )
  const extensions = input.extensions?.resolve(events)
    ?? { modules: [], world: [], state: [], prepare: [], recall: [] }
  const selectedExperience = readRoleplayExperienceSelection(events)
  if (nativePromptPolicy !== undefined && selectedExperience?.promptPolicy !== undefined
    && selectedExperience.promptPolicy.id !== nativePromptPolicy.id) {
    throw new Error('Roleplay native prompt policy snapshot does not match the selected resource')
  }

  const deploymentActor: RoleplayResourceRef = {
    id: 'deployment:default-actor',
    name: input.deployment.characterName,
    owner: 'deployment',
  }
  let actor: RoleplayResourceRef | undefined
  if (activeCharacter !== undefined && card !== undefined) {
    actor = sessionResource(
      selectedExperience?.actor?.id ?? `character:${activeCharacter.result.sourceAttachmentId}`,
      card.nickname?.trim() || card.name,
      'sillytavern:character-card',
    )
  } else if (importedChat !== undefined) {
    actor = sessionResource('session:imported-chat-actor', importedChat.characterName, 'sillytavern:chat')
  } else if (worldScenario === undefined) {
    actor = deploymentActor
  }
  const experience = worldScenario !== undefined && actor === undefined
    ? {
        ...sessionResource(
          selectedExperience?.mode === 'scene'
            ? selectedExperience.worlds[0]!.id
            : `world:${worldScenario.meta.result.sourceAttachmentId}`,
          worldScenario.meta.result.name,
          'sillytavern:world-info',
        ),
        mode: 'scene' as const,
      }
    : { ...(actor ?? deploymentActor), mode: 'character' as const }
  const participant = identity.persona !== undefined
    ? {
        id: selectedExperience?.participant?.id ?? identity.persona.id,
        name: identity.persona.name,
        owner: 'session' as const,
        description: identity.persona.description,
      }
    : identity.userName === undefined
      ? undefined
      : sessionResource('session:participant-identity', identity.userName, 'sillytavern:identity')
  const promptResource = preset !== undefined
    ? sessionResource(
        selectedExperience?.promptPolicy?.id ?? `preset:${preset.result.sourceAttachmentId}`,
        preset.result.name,
        'sillytavern:chat-completion-preset',
      )
    : nativePromptPolicy === undefined
      ? undefined
      : sessionResource(
          selectedExperience?.promptPolicy?.id ?? nativePromptPolicy.id,
          nativePromptPolicy.name,
          'agent-rp:native-prompt-policy',
        )
  const state = [
    ...nativeStates.map(nativeState => ({
      id: nativeState.id,
      owner: 'session' as const,
      revision: nativeState.revision,
    })),
    ...(mvu === undefined ? [] : [{
      id: MVU_ROLEPLAY_STATE_ID,
      owner: 'session' as const,
      adapter: 'sillytavern:mvu',
      revision: mvu.updateCount,
    }]),
    ...(tavern === undefined ? [] : [{
      id: TAVERN_HELPER_ROLEPLAY_STATE_ID,
      owner: 'session' as const,
      adapter: 'sillytavern:tavern-helper',
      revision: tavern.revision,
    }]),
    ...extensions.state,
  ]
  if (new Set(state.map(binding => binding.id)).size !== state.length) {
    throw new Error('Roleplay state namespaces must be unique across native runtime, adapters, and extensions')
  }
  const modules: RoleplayModuleBinding[] = [
    runtimeModule(ROLEPLAY_PROMPT_MODULE_ID, 'native', ['prepare']),
    runtimeModule(ROLEPLAY_MEMORY_MODULE_ID, 'native', ['recall', 'act', 'settle']),
    runtimeModule(ROLEPLAY_AGENT_MODULE_ID, 'native', ['act']),
    runtimeModule('roleplay:reply-versions', 'native', ['present']),
    ...(nativeStates.length === 0 ? [] : [runtimeModule(
      ROLEPLAY_STATE_MODULE_ID,
      'native',
      ['prepare', 'settle', 'present'],
      nativeStates.map(nativeState => nativeState.id),
    )]),
    ...(lorebooks.length === 0 ? [] : [runtimeModule(ROLEPLAY_WORLD_MODULE_ID, 'native', ['recall'])]),
    ...(preset === undefined && regexPacks.length === 0
      ? [] : [runtimeModule(ROLEPLAY_PROMPT_ADAPTER_MODULE_ID, 'adapter', ['prepare'])]),
    ...(mvu === undefined ? [] : [runtimeModule(
      MVU_ROLEPLAY_MODULE_ID, 'adapter', ['prepare', 'act', 'settle'], [MVU_ROLEPLAY_STATE_ID],
    )]),
    ...(tavern === undefined ? [] : [runtimeModule(
      TAVERN_HELPER_ROLEPLAY_MODULE_ID,
      'adapter',
      ROLEPLAY_TURN_PHASES,
      [TAVERN_HELPER_ROLEPLAY_STATE_ID],
    )]),
    ...(input.templateEngineAvailable === true
      ? [runtimeModule(ROLEPLAY_EJS_ADAPTER_MODULE_ID, 'adapter', ['prepare', 'recall'])]
      : []),
    ...extensions.modules,
  ]
  if (new Set(modules.map(module => module.id)).size !== modules.length) {
    throw new Error('Roleplay runtime module ids must be unique across native runtime, adapters, and extensions')
  }
  const knownStateIds = new Set(state.map(binding => binding.id))
  for (const module of modules) {
    for (const stateId of module.stateIds ?? []) {
      if (!knownStateIds.has(stateId)) {
        throw new Error(`Roleplay runtime module ${JSON.stringify(module.id)} references unknown state ${JSON.stringify(stateId)}`)
      }
    }
  }
  const worldBindings = [
    ...lorebooks.map(({ source }) => ({
      ...sessionResource(
        source.id,
        source.name,
        source.source === 'character' ? 'sillytavern:character-book' : 'sillytavern:world-info',
      ),
      placement: source.source === 'character' ? 'actor' as const : 'experience' as const,
    })),
    ...extensions.world,
  ]
  if (new Set(worldBindings.map(binding => binding.id)).size !== worldBindings.length) {
    throw new Error('Roleplay world binding ids must be unique across native runtime, adapters, and extensions')
  }
  const tokenBudget = worldInfoTokenBudget(worldConfiguration)
  const snapshot: RoleplayRuntimeSnapshot = {
    format: 0,
    lifecycle: ROLEPLAY_TURN_PHASES,
    experience,
    ...(actor === undefined ? {} : { actor }),
    ...(participant === undefined ? {} : { participant }),
    world: {
      bindings: worldBindings,
      ...(tokenBudget === undefined ? {} : { tokenBudget }),
    },
    prompt: preset === undefined
      ? { strategy: 'native', ...(promptResource === undefined ? {} : { resource: promptResource }) }
      : { strategy: 'modules', resource: promptResource! },
    state,
    memory: { read: true, write: input.memoryWriteAvailable === true },
    modules,
  }
  return {
    snapshot,
    regexPacks,
    turnMode,
    nativeStates,
    ...(card === undefined ? {} : { card }),
    ...(importedChat === undefined ? {} : { importedChat }),
    ...(worldScenario === undefined ? {} : { worldScenario }),
    ...(preset === undefined ? {} : { preset }),
    ...(nativePromptPolicy === undefined ? {} : { nativePromptPolicy }),
    ...(tavern === undefined ? {} : { tavern }),
    ...(mvu === undefined ? {} : { mvu }),
    lorebooks,
    extensionOutcomes: { prepare: extensions.prepare, recall: extensions.recall },
  }
}
