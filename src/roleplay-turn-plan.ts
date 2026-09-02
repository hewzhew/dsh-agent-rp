/** Pure, provider-neutral plan compiled for one Roleplay turn. */

import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ResolvedConfig } from './config.ts'
import {
  createEjsWorldInfoBooks,
  EjsTemplateEngine,
  type EjsTemplateContext,
} from './ejs-template.ts'
import type { LorebookActivationReason } from './import/lorebook.ts'
import { presetRegexScripts } from './import/sillytavern-preset.ts'
import type { ImportedRegexScript } from './import/types.ts'
import { readAgentRpMemoryHistory } from './memory.ts'
import {
  MVU_ROLEPLAY_MODULE_ID,
  MVU_ROLEPLAY_STATE_ID,
  renderChoiceInstructions,
  renderMvuUpdateInstructions,
} from './mvu.ts'
import {
  importedCharacterPromptIsTurnVariant,
  renderActiveMemoryContext,
  renderCharacterPrompt,
  renderImportedChatPrompt,
  renderImportedCharacterPrompt,
  renderImportedCharacterIdentityPrompt,
  renderWorldInfoScenarioPrompt,
  roleplayVisibleDialogue,
  roleplayVisibleTranscript,
  renderSessionLorebooks,
} from './prompt.ts'
import {
  assembleSillyTavernPreset,
  splitRoleplaySystemPrompt,
  type RoleplayInChatPrompt,
  type RoleplayProviderPromptPlan,
} from './preset-prompt.ts'
import {
  ROLEPLAY_EJS_ADAPTER_MODULE_ID,
  ROLEPLAY_MEMORY_MODULE_ID,
  ROLEPLAY_PROMPT_ADAPTER_MODULE_ID,
  ROLEPLAY_PROMPT_MODULE_ID,
  ROLEPLAY_WORLD_MODULE_ID,
  type RoleplayRuntimeSnapshot,
  type RoleplayStateBinding,
  type RoleplayWorldBinding,
} from './roleplay-runtime.ts'
import type { ResolvedSessionRoleplayRuntime } from './session-roleplay-runtime.ts'
import { ROLEPLAY_STATE_MODULE_ID } from './roleplay-state.ts'
import { renderRoleplayStateContext } from './roleplay-runtime-context.ts'
import {
  tavernInjectedInChatPrompts,
  tavernInjectedOrderedPrompts,
  tavernInjectedScanText,
  TAVERN_HELPER_ROLEPLAY_MODULE_ID,
  type TavernHelperState,
} from './tavern-helper.ts'
import {
  ReplayableRoleplayMacros,
  type RoleplayMacroContext,
} from './roleplay-macro.ts'
import {
  ROLEPLAY_STATE_ACTION_TOOL,
  renderRoleplayStateActionGuidance,
  type RoleplayStateActionPlan,
} from './roleplay-state-action.ts'
import type { RoleplayTurnMode } from './roleplay-turn-mode.ts'
import { renderNativePromptPolicy } from './native-prompt-policy.ts'
import { characterWorldInfoBookName } from './world-info-configuration-core.ts'
import {
  DEFAULT_TOOL_GUIDANCE,
  prepareRoleplayToolPolicy,
  type ResolvedToolGuidanceConfig,
  type RoleplayToolPolicyPlan,
} from './roleplay-tool-guidance.ts'
import { sessionEvents } from './session-events.ts'

/** Exact replay key for the Session surface and newly claimed messages used by preparation. */
export interface RoleplayTurnInputKey {
  readonly sessionId: string
  readonly sessionSeq: number
  readonly pendingMessageIds: readonly string[]
}

/** Provider-neutral generation preferences selected for this turn. */
export interface RoleplayGenerationPolicy {
  readonly temperature?: number
  readonly maxTokens?: number
  readonly reasoningEffort?: string
  readonly topP?: number
  readonly topK?: number
  readonly topA?: number
  readonly minP?: number
  readonly frequencyPenalty?: number
  readonly presencePenalty?: number
  readonly repetitionPenalty?: number
}

/** Explainable decision for one entry without retaining its private source text twice. */
export interface RoleplayWorldEntryDecision {
  readonly entryId: string
  readonly index: number
  readonly active: boolean
  readonly reason: LorebookActivationReason
  readonly matchedKeys: readonly string[]
  readonly matchedSecondaryKeys: readonly string[]
  readonly approximateTokens: number
  readonly template?: 'rendered' | 'source-limit' | 'syntax-error' | 'runtime-error'
    | 'execution-limit' | 'memory-limit' | 'output-limit' | 'resource-unsupported' | 'resource-limit'
}

/** Activated prompt contributions and diagnostics for one bound world resource. */
export interface RoleplayWorldResourcePlan {
  readonly resource: RoleplayWorldBinding
  readonly beforeActor: readonly string[]
  readonly afterActor: readonly string[]
  readonly entries: readonly RoleplayWorldEntryDecision[]
}

/** World preparation result in semantic experience/actor order. */
export interface RoleplayWorldPlan {
  readonly engine: 'native-v0'
  readonly resources: readonly RoleplayWorldResourcePlan[]
  readonly inChat: readonly RoleplayInChatPrompt[]
  readonly experienceBeforeActor: readonly string[]
  readonly actorBefore: readonly string[]
  readonly actorAfter: readonly string[]
  readonly experienceAfterActor: readonly string[]
  readonly approximateTokens: number
  readonly tokenBudget?: number
}

/** Content-free phase outcome useful for diagnostics and later orchestration. */
export interface RoleplayPhaseModuleOutcome {
  readonly moduleId: string
  readonly outcome: 'applied' | 'idle' | 'degraded'
  readonly contributions: number
}

export type RoleplayPrepareModuleOutcome = RoleplayPhaseModuleOutcome
export type RoleplayRecallModuleOutcome = RoleplayPhaseModuleOutcome

/** Logged plugin context that entered one concrete model step without duplicating its content. */
export interface RoleplayExternalContextRead {
  readonly eventSeq: number
  readonly messageId: string
}

/** Source-neutral ownership of one ordered model-facing text transformation. */
export type RoleplayPromptTransformOwner = 'regex' | 'prompt-policy' | 'actor'

/** Normalized regex operation prepared by an input adapter for the native prompt boundary. */
export interface RoleplayPromptRegexTransform {
  readonly engine: 'regex-v0'
  readonly owner: RoleplayPromptTransformOwner
  readonly ownerIndex: number
  readonly name: string
  readonly pattern: string
  readonly replacement: string
  readonly trim: readonly string[]
  readonly placements: readonly ('user-input' | 'assistant-output')[]
  readonly enabled: boolean
  readonly phase: 'shared' | 'prompt-only'
  readonly identitySubstitution: 'none' | 'raw' | 'escaped'
  readonly minDepth?: number
  readonly maxDepth?: number
}

/** Exact ordered transformation program frozen before one provider request. */
export interface RoleplayPromptTransformPlan {
  readonly actorName: string
  readonly participantName?: string
  readonly operations: readonly RoleplayPromptRegexTransform[]
}

/** Final prompt plus adapter expansion diagnostics. */
export interface RoleplayTurnPromptPlan extends RoleplayProviderPromptPlan {
  readonly systemPromptText: string
  readonly transforms: RoleplayPromptTransformPlan
  readonly diagnostics: {
    readonly enabledModules: number
    readonly unsupportedMacros: number
    readonly templateFailures: number
  }
}

/** Adapter-owned response repair prepared before the actor request begins. */
export interface RoleplayMvuResponseRepairPlan {
  readonly engine: 'mvu-v0'
  readonly moduleId: string
  readonly stateId: string
  readonly updateInstructions?: string
  readonly choiceInstructions?: string
}

export type RoleplayResponseRepairPlan = RoleplayMvuResponseRepairPlan

/** Source-neutral act-phase programs frozen for one concrete model step. */
export interface RoleplayTurnActPlan {
  readonly strategy: RoleplayTurnMode
  readonly responseRepairs: readonly RoleplayResponseRepairPlan[]
  readonly stateActions: readonly RoleplayStateActionPlan[]
}

/** Exact state value and log boundary consumed while preparing this turn. */
export interface RoleplayStateRead extends RoleplayStateBinding {
  readonly eventSeq?: number
  readonly writerModuleId?: string
  readonly value?: JsonValue
}

/** One durable memory record consulted while preparing this turn. */
export interface RoleplayMemoryRead {
  readonly id: string
  readonly sourceEventSeq: number
}

/** Exact memory policy, references, and model-visible context compiled for this turn. */
export type RoleplayMemoryPlan = RoleplayRuntimeSnapshot['memory'] & {
  readonly reads: readonly RoleplayMemoryRead[]
  readonly contextText: string
}

/** Immutable result of the prepare phase, with no renderer or source-format object in its public contract. */
export interface RoleplayTurnPlan {
  readonly format: 0
  readonly input: RoleplayTurnInputKey
  readonly runtime: RoleplayRuntimeSnapshot
  readonly world: RoleplayWorldPlan
  readonly prompt: RoleplayTurnPromptPlan
  readonly act: RoleplayTurnActPlan
  readonly tools: RoleplayToolPolicyPlan
  readonly stateReads: readonly RoleplayStateRead[]
  readonly memory: RoleplayMemoryPlan
  readonly generation: RoleplayGenerationPolicy
  readonly prepare: {
    readonly modules: readonly RoleplayPrepareModuleOutcome[]
  }
  readonly recall: {
    readonly modules: readonly RoleplayRecallModuleOutcome[]
    readonly contextReads?: readonly RoleplayExternalContextRead[]
  }
}

export interface PrepareRoleplayTurnInput {
  readonly session: Session
  /** Exact logical next seq when replay construction appended a non-semantic lifecycle marker. */
  readonly sessionBoundarySeq?: number
  readonly pendingMessages?: readonly UserMessage[]
  readonly deployment: ResolvedConfig
  readonly resolved: ResolvedSessionRoleplayRuntime
  /** Workspace tool settings captured at the same boundary as every other turn input. */
  readonly toolGuidance?: ResolvedToolGuidanceConfig
  readonly templateEngine?: EjsTemplateEngine
}

const nativeProviderPrompt = (): RoleplayProviderPromptPlan => ({
  beforeHistory: [],
  afterHistory: [],
  inChat: [],
  includeHistory: true,
})

function promptTransform(
  script: ImportedRegexScript,
  owner: RoleplayPromptTransformOwner,
  ownerIndex: number,
): RoleplayPromptRegexTransform | undefined {
  if (script.markdownOnly && !script.promptOnly) return undefined
  const placements = script.placement.flatMap(value => value === 1
    ? ['user-input' as const]
    : value === 2 ? ['assistant-output' as const] : [])
  const minDepth = script.minDepth === null || script.minDepth < 0 ? undefined : script.minDepth
  const maxDepth = script.maxDepth === null || script.maxDepth < 0 ? undefined : script.maxDepth
  return {
    engine: 'regex-v0',
    owner,
    ownerIndex,
    name: script.scriptName,
    pattern: script.findRegex,
    replacement: script.replaceString,
    trim: [...script.trimStrings],
    placements: [...new Set(placements)],
    enabled: !script.disabled,
    phase: script.promptOnly ? 'prompt-only' : 'shared',
    identitySubstitution: Number(script.substituteRegex) === 1 ? 'raw'
      : Number(script.substituteRegex) === 2 ? 'escaped' : 'none',
    ...(minDepth === undefined ? {} : { minDepth }),
    ...(maxDepth === undefined ? {} : { maxDepth }),
  }
}

function promptTransforms(
  resolved: ResolvedSessionRoleplayRuntime,
  actorName: string,
  participantName: string | undefined,
): RoleplayPromptTransformPlan {
  const regex = resolved.regexPacks.flatMap(pack => pack.scripts)
  const promptPolicy = resolved.preset === undefined ? [] : presetRegexScripts(resolved.preset.preset)
  const actor = resolved.card?.frontend.regexScripts ?? []
  const operations = [
    ...regex.map((script, index) => promptTransform(script, 'regex', index)),
    ...promptPolicy.map((script, index) => promptTransform(script, 'prompt-policy', index)),
    ...actor.map((script, index) => promptTransform(script, 'actor', index)),
  ].filter((operation): operation is RoleplayPromptRegexTransform => operation !== undefined)
  return {
    actorName,
    ...(participantName === undefined ? {} : { participantName }),
    operations,
  }
}

function variableScopes(state: TavernHelperState | undefined): NonNullable<EjsTemplateContext['variableScopes']> {
  return state?.scopes ?? {}
}

function templateOptions(engine: EjsTemplateEngine | undefined, context: EjsTemplateContext) {
  return engine === undefined ? {} : {
    regexEngine: engine,
    renderTemplate: engine.createRenderer(context),
  }
}

function worldPlan(
  resolved: ResolvedSessionRoleplayRuntime,
  rendered: ReturnType<typeof renderSessionLorebooks>,
): RoleplayWorldPlan {
  const resources = rendered.books.map((book, index): RoleplayWorldResourcePlan => {
    const resource = resolved.snapshot.world.bindings.find(binding => binding.id === book.id)
    const configured = resolved.lorebooks[index]?.configured
    if (resource === undefined || configured === undefined || resource.id !== book.id) {
      throw new Error('Roleplay world bindings do not match the evaluated resources')
    }
    return {
      resource,
      beforeActor: book.inspected.beforeCharacter,
      afterActor: book.inspected.afterCharacter,
      entries: book.inspected.entries.map((decision) => {
        const source = configured.entries[decision.index]
        if (source === undefined) throw new Error('Roleplay world decision references a missing entry')
        return {
          entryId: source.sourceId,
          index: decision.index,
          active: decision.active,
          reason: decision.reason,
          matchedKeys: decision.matchedKeys,
          matchedSecondaryKeys: decision.matchedSecondaryKeys,
          approximateTokens: decision.approximateTokens,
          ...(decision.template === undefined ? {} : { template: decision.template }),
        }
      }),
    }
  })
  const renderedIds = new Set(resources.map(resource => resource.resource.id))
  const externalResources = resolved.snapshot.world.bindings
    .filter(resource => !renderedIds.has(resource.id))
    .map(resource => ({ resource, beforeActor: [], afterActor: [], entries: [] }))
  const allResources = [...resources, ...externalResources]
  const contributions = (placement: RoleplayWorldBinding['placement'], side: 'beforeActor' | 'afterActor') =>
    allResources.filter(item => item.resource.placement === placement).flatMap(item => item[side])
  return {
    engine: rendered.engine,
    resources: allResources,
    inChat: rendered.inChat,
    experienceBeforeActor: contributions('experience', 'beforeActor'),
    actorBefore: contributions('actor', 'beforeActor'),
    actorAfter: contributions('actor', 'afterActor'),
    experienceAfterActor: contributions('experience', 'afterActor'),
    approximateTokens: rendered.approximateTokens,
    ...(rendered.tokenBudget === undefined ? {} : { tokenBudget: rendered.tokenBudget }),
  }
}

/** Validate one explicit outcome from every module participating in one declarative phase. */
export function resolveRoleplayPhaseModuleOutcomes(
  runtime: RoleplayRuntimeSnapshot,
  phase: 'prepare' | 'recall',
  declarations: readonly RoleplayPhaseModuleOutcome[],
): readonly RoleplayPhaseModuleOutcome[] {
  const active = runtime.modules.filter(module => module.phases.includes(phase))
  const activeIds = new Set(active.map(module => module.id))
  const declared = new Map<string, RoleplayPhaseModuleOutcome>()
  for (const declaration of declarations) {
    if (!activeIds.has(declaration.moduleId)) {
      throw new Error(`Roleplay ${phase} declaration references inactive module ${declaration.moduleId}`)
    }
    if (declared.has(declaration.moduleId)) {
      throw new Error(`Roleplay ${phase} module ${declaration.moduleId} declared more than once`)
    }
    if (!Number.isSafeInteger(declaration.contributions) || declaration.contributions < 0) {
      throw new Error(`Roleplay ${phase} module ${declaration.moduleId} has an invalid contribution count`)
    }
    declared.set(declaration.moduleId, declaration)
  }
  return active.map(module => {
    const declaration = declared.get(module.id)
    if (declaration === undefined) {
      throw new Error(`Roleplay ${phase} module ${module.id} did not declare an outcome`)
    }
    return declaration
  })
}

/** Validate every module that declared prepare participation. */
export function resolveRoleplayPrepareModuleOutcomes(
  runtime: RoleplayRuntimeSnapshot,
  declarations: readonly RoleplayPrepareModuleOutcome[],
): readonly RoleplayPrepareModuleOutcome[] {
  return resolveRoleplayPhaseModuleOutcomes(runtime, 'prepare', declarations)
}

/** Validate every module that declared world or memory recall participation. */
export function resolveRoleplayRecallModuleOutcomes(
  runtime: RoleplayRuntimeSnapshot,
  declarations: readonly RoleplayRecallModuleOutcome[],
): readonly RoleplayRecallModuleOutcome[] {
  return resolveRoleplayPhaseModuleOutcomes(runtime, 'recall', declarations)
}

/** Compile all Session resources into the exact immutable inputs consumed by the next generation. */
export function prepareRoleplayTurn(input: PrepareRoleplayTurnInput): RoleplayTurnPlan {
  const pendingMessages = input.pendingMessages ?? []
  const sessionBoundarySeq = input.sessionBoundarySeq ?? input.session.seq
  if (!Number.isSafeInteger(sessionBoundarySeq) || sessionBoundarySeq < 0
    || sessionBoundarySeq > input.session.seq) {
    throw new Error('Roleplay preparation Session boundary is invalid')
  }
  const { resolved } = input
  const { snapshot, tavern } = resolved
  const injectedScanText = tavernInjectedScanText(tavern)
  const books = resolved.lorebooks.map(({ source, configured }) => ({
    id: source.id,
    name: source.name,
    lorebook: configured,
  }))
  const characterName = resolved.card?.nickname?.trim() || resolved.card?.name
    || snapshot.actor?.name || snapshot.experience.name
  const userName = snapshot.participant?.name
  const transcript = roleplayVisibleTranscript(input.session, pendingMessages)
  const characterWorldbook = characterWorldInfoBookName(
    resolved.lorebooks.map(({ source }) => source),
    tavern,
  )
  const macroContext: RoleplayMacroContext = {
    ...(resolved.card === undefined ? {} : { card: resolved.card }),
    characterName,
    ...(userName === undefined ? {} : { userName }),
    ...(snapshot.participant?.description === undefined
      ? {} : { userPersona: snapshot.participant.description }),
    messages: transcript.flatMap(message => message.role === 'system'
      ? [] : [{ role: message.role, content: message.content }]),
    pendingInput: pendingMessages.flatMap(message => message.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n'),
    entropy: JSON.stringify([
      String(input.session.id),
      sessionBoundarySeq,
      ...pendingMessages.map(message => String(message.id)),
    ]),
    stableEntropy: String(input.session.id),
  }
  const options = templateOptions(input.templateEngine, {
    characterName,
    userName: userName ?? '用户',
    ...(characterWorldbook === undefined ? {} : { characterWorldInfoBookName: characterWorldbook }),
    replayTime: sessionBoundarySeq === 0 ? 0 : sessionEvents(input.session)[sessionBoundarySeq - 1]?.time ?? 0,
    entropy: macroContext.entropy,
    messages: [...roleplayVisibleDialogue(input.session, pendingMessages), ...injectedScanText],
    transcript,
    variableScopes: variableScopes(tavern),
    ...(resolved.mvu === undefined ? {} : { statData: resolved.mvu.statData }),
    worldInfoBooks: createEjsWorldInfoBooks(books),
  })
  const worldMacros = new ReplayableRoleplayMacros(macroContext)
  const world = worldPlan(resolved, renderSessionLorebooks({
    books,
    session: input.session,
    pendingMessages,
    scanText: injectedScanText,
    ...(resolved.mvu === undefined ? {} : { statData: resolved.mvu.statData }),
    templateOptions: { ...options, renderMacro: value => worldMacros.expand(value) },
    ...(snapshot.world.tokenBudget === undefined ? {} : { tokenBudget: snapshot.world.tokenBudget }),
  }))
  const experienceBefore = world.experienceBeforeActor
  const experienceAfter = world.experienceAfterActor
  const loreBefore = [...experienceBefore, ...world.actorBefore]
  const loreAfter = [...world.actorAfter, ...experienceAfter]
  const injectedPrompts = {
    beforeHistory: tavernInjectedOrderedPrompts(tavern, 'before'),
    afterHistory: tavernInjectedOrderedPrompts(tavern, 'after'),
    inChat: tavernInjectedInChatPrompts(tavern),
  }
  let providerPrompt = nativeProviderPrompt()
  let systemPromptText = ''
  let nativeActorTail: RoleplayProviderPromptPlan['afterHistory'] = []
  let enabledModules = 0
  let unsupportedMacros = worldMacros.unsupportedCount
  let templateRenders = 0
  let templateFailures = 0
  const effectiveLorebooks = resolved.lorebooks.map(value => value.configured)
  const mvuUpdateInstructions = resolved.mvu === undefined
    ? undefined : renderMvuUpdateInstructions(effectiveLorebooks, resolved.mvu.statData, {
        characterName,
        ...(userName === undefined ? {} : { userName }),
      })
  const choiceInstructions = resolved.mvu === undefined
    ? undefined : renderChoiceInstructions(effectiveLorebooks)
  const stateActionTarget: RoleplayStateActionPlan | undefined = resolved.turnMode !== 'agent'
    || resolved.mvu === undefined || mvuUpdateInstructions === undefined
    ? undefined
    : {
        engine: 'mvu-v0',
        tool: ROLEPLAY_STATE_ACTION_TOOL,
        moduleId: MVU_ROLEPLAY_MODULE_ID,
        stateId: MVU_ROLEPLAY_STATE_ID,
        expectedRevision: resolved.mvu.updateCount,
        operations: ['replace', 'delta', 'insert', 'remove', 'move'],
        instructions: mvuUpdateInstructions,
      }

  if (snapshot.prompt.strategy === 'modules' && resolved.preset !== undefined) {
    const assembled = assembleSillyTavernPreset(resolved.preset.preset, {
      ...(resolved.card === undefined ? { characterName } : { card: resolved.card }),
      ...(userName === undefined ? {} : { userName }),
      ...(snapshot.participant?.description === undefined
        ? {} : { userPersona: snapshot.participant.description }),
      worldInfoBefore: loreBefore,
      worldInfoAfter: loreAfter,
      session: input.session,
      pendingMessages,
      macroContext,
      worldInfoMacrosResolved: true,
      mvuEnabled: resolved.mvu !== undefined && resolved.turnMode === 'conversation',
      ...(options.renderTemplate === undefined ? {} : { renderTemplate: options.renderTemplate }),
    })
    const systemPrompt = splitRoleplaySystemPrompt(assembled)
    providerPrompt = { ...assembled, beforeHistory: systemPrompt.beforeHistory }
    systemPromptText = systemPrompt.systemPromptText
    enabledModules = assembled.enabledPromptCount
    unsupportedMacros += assembled.unsupportedMacroCount
    templateRenders = assembled.templateRenderCount
    templateFailures = assembled.templateFailureCount
  } else if (resolved.card !== undefined) {
    const cardMacros = new ReplayableRoleplayMacros(macroContext)
    const mvuOutputEnabled = resolved.mvu !== undefined && resolved.turnMode === 'conversation'
    const renderedCardPrompt = renderImportedCharacterPrompt(
      resolved.card,
      [],
      [],
      userName,
      resolved.mvu?.statData,
      snapshot.participant?.description,
      options,
      cardMacros,
      true,
      mvuOutputEnabled,
    )
    if (importedCharacterPromptIsTurnVariant(resolved.card)) {
      systemPromptText = renderImportedCharacterIdentityPrompt(
        resolved.card,
        snapshot.participant?.description,
        mvuOutputEnabled,
      )
      nativeActorTail = [{ role: 'system', content: renderedCardPrompt }]
    } else {
      systemPromptText = renderedCardPrompt
    }
    unsupportedMacros += cardMacros.unsupportedCount
  } else if (resolved.importedChat !== undefined) {
    systemPromptText = renderImportedChatPrompt(
      resolved.importedChat.characterName,
      userName,
      snapshot.participant?.description,
    )
  } else if (resolved.worldScenario !== undefined) {
    systemPromptText = renderWorldInfoScenarioPrompt(
      [],
      [],
      snapshot.participant?.description,
    )
  } else {
    systemPromptText = renderCharacterPrompt(input.deployment)
  }

  if (resolved.nativePromptPolicy !== undefined) {
    systemPromptText = [systemPromptText, renderNativePromptPolicy(resolved.nativePromptPolicy)]
      .filter(Boolean).join('\n\n')
    enabledModules = resolved.nativePromptPolicy.modules.filter(module => module.enabled).length
  }

  if (stateActionTarget !== undefined) {
    const guidance = renderRoleplayStateActionGuidance(stateActionTarget, mvuUpdateInstructions!)
    providerPrompt = {
      ...providerPrompt,
      afterHistory: [...providerPrompt.afterHistory, { role: 'system', content: guidance }],
    }
  }

  const transforms = promptTransforms(resolved, characterName, userName)
  const nativeWorldBefore = snapshot.prompt.strategy === 'modules'
    ? [] : loreBefore.map(content => ({ role: 'system' as const, content }))
  const nativeWorldAfter = snapshot.prompt.strategy === 'modules'
    ? [] : loreAfter.map(content => ({ role: 'system' as const, content }))
  const deferredInjectedBefore = providerPrompt.includeHistory ? injectedPrompts.beforeHistory : []
  let prompt: RoleplayTurnPromptPlan = {
    ...providerPrompt,
    beforeHistory: [
      ...(providerPrompt.includeHistory ? [] : injectedPrompts.beforeHistory),
      ...providerPrompt.beforeHistory,
    ],
    afterHistory: [
      ...deferredInjectedBefore,
      ...nativeWorldBefore,
      ...nativeActorTail,
      ...nativeWorldAfter,
      ...providerPrompt.afterHistory,
      ...injectedPrompts.afterHistory,
    ],
    inChat: [...providerPrompt.inChat, ...world.inChat, ...injectedPrompts.inChat],
    systemPromptText,
    transforms,
    diagnostics: { enabledModules, unsupportedMacros, templateFailures },
  }
  const act: RoleplayTurnActPlan = {
    strategy: resolved.turnMode,
    responseRepairs: resolved.mvu === undefined
      || ((resolved.turnMode === 'agent' || mvuUpdateInstructions === undefined) && choiceInstructions === undefined)
      ? []
      : [{
          engine: 'mvu-v0',
          moduleId: MVU_ROLEPLAY_MODULE_ID,
          stateId: MVU_ROLEPLAY_STATE_ID,
          ...(resolved.turnMode === 'agent' || mvuUpdateInstructions === undefined
            ? {} : { updateInstructions: mvuUpdateInstructions }),
          ...(choiceInstructions === undefined ? {} : { choiceInstructions }),
        }],
    stateActions: stateActionTarget === undefined ? [] : [stateActionTarget],
  }
  const nativeStatesById = new Map(resolved.nativeStates.map(state => [state.id, state]))
  const stateReads: RoleplayStateRead[] = snapshot.state.map((binding) => {
    const nativeState = nativeStatesById.get(binding.id)
    if (nativeState !== undefined) return {
      ...binding,
      eventSeq: nativeState.eventSeq,
      writerModuleId: nativeState.writerModuleId,
      value: nativeState.value,
    }
    if (binding.id === MVU_ROLEPLAY_STATE_ID && resolved.mvu !== undefined) return {
      ...binding,
      writerModuleId: MVU_ROLEPLAY_MODULE_ID,
      value: snapshotJsonValue(resolved.mvu.statData) as JsonValue,
    }
    return binding
  })
  const stateContext = renderRoleplayStateContext(stateReads, transforms)
  if (stateContext !== '') {
    prompt = {
      ...prompt,
      afterHistory: [...prompt.afterHistory, { role: 'system', content: stateContext }],
    }
  }
  const memoryHistory = readAgentRpMemoryHistory(sessionEvents(input.session))
  const memory: RoleplayMemoryPlan = {
    ...snapshot.memory,
    reads: memoryHistory.active.map(record => ({
      id: String(record.id),
      sourceEventSeq: record.sourceEventSeq,
    })),
    contextText: renderActiveMemoryContext(memoryHistory.active, snapshot.memory.write),
  }
  const tools = prepareRoleplayToolPolicy(input.toolGuidance ?? DEFAULT_TOOL_GUIDANCE)
  const worldContributions = world.resources.reduce(
    (count, resource) => count + resource.beforeActor.length + resource.afterActor.length,
    world.inChat.length,
  )
  const regexTransformCount = transforms.operations.filter(operation => operation.owner === 'regex').length
  const promptPolicyTransformCount = transforms.operations
    .filter(operation => operation.owner === 'prompt-policy').length
  const actorTransformCount = transforms.operations.filter(operation => operation.owner === 'actor').length
  const promptContributions = providerPrompt.beforeHistory.length + providerPrompt.afterHistory.length
    + providerPrompt.inChat.length + (systemPromptText === '' ? 0 : 1) + actorTransformCount
  const promptAdapterContributions = enabledModules + regexTransformCount + promptPolicyTransformCount
  const worldEntries = world.resources.flatMap(resource => resource.entries)
  const worldTemplateAttempts = worldEntries.filter(entry => entry.template !== undefined).length
  const worldTemplateFailures = worldEntries.filter(entry =>
    entry.reason === 'template-error' || entry.reason === 'template-unsupported').length
  const prepareDeclarations: RoleplayPrepareModuleOutcome[] = [
    {
      moduleId: ROLEPLAY_PROMPT_MODULE_ID,
      outcome: promptContributions === 0 ? 'idle' : 'applied',
      contributions: promptContributions,
    },
    ...(resolved.preset === undefined && resolved.regexPacks.length === 0 ? [] : [{
      moduleId: ROLEPLAY_PROMPT_ADAPTER_MODULE_ID,
      outcome: promptAdapterContributions === 0 ? 'idle' as const : 'applied' as const,
      contributions: promptAdapterContributions,
    }]),
    ...(resolved.nativeStates.length === 0 ? [] : [{
      moduleId: ROLEPLAY_STATE_MODULE_ID,
      outcome: 'applied' as const,
      contributions: resolved.nativeStates.length,
    }]),
    ...(resolved.mvu === undefined ? [] : [{
      moduleId: MVU_ROLEPLAY_MODULE_ID,
      outcome: 'applied' as const,
      contributions: 1,
    }]),
    ...(tavern === undefined ? [] : [{
      moduleId: TAVERN_HELPER_ROLEPLAY_MODULE_ID,
      outcome: injectedPrompts.beforeHistory.length + injectedPrompts.afterHistory.length
        + injectedPrompts.inChat.length === 0 ? 'idle' as const : 'applied' as const,
      contributions: injectedPrompts.beforeHistory.length + injectedPrompts.afterHistory.length
        + injectedPrompts.inChat.length,
    }]),
    ...(snapshot.modules.some(module => module.id === ROLEPLAY_EJS_ADAPTER_MODULE_ID) ? [{
      moduleId: ROLEPLAY_EJS_ADAPTER_MODULE_ID,
      outcome: input.templateEngine === undefined || templateFailures > 0 ? 'degraded' as const
        : templateRenders === 0 ? 'idle' as const : 'applied' as const,
      contributions: templateRenders + templateFailures,
    }] : []),
    ...resolved.extensionOutcomes.prepare,
  ]
  const recallDeclarations: RoleplayRecallModuleOutcome[] = [
    {
      moduleId: ROLEPLAY_MEMORY_MODULE_ID,
      outcome: memory.reads.length === 0 ? 'idle' : 'applied',
      contributions: memory.reads.length,
    },
    ...(!snapshot.modules.some(module => module.id === ROLEPLAY_WORLD_MODULE_ID) ? [] : [{
      moduleId: ROLEPLAY_WORLD_MODULE_ID,
      outcome: worldContributions === 0 ? 'idle' as const : 'applied' as const,
      contributions: worldContributions,
    }]),
    ...(tavern === undefined ? [] : [{
      moduleId: TAVERN_HELPER_ROLEPLAY_MODULE_ID,
      outcome: injectedScanText.length === 0 ? 'idle' as const : 'applied' as const,
      contributions: injectedScanText.length,
    }]),
    ...(snapshot.modules.some(module => module.id === ROLEPLAY_EJS_ADAPTER_MODULE_ID) ? [{
      moduleId: ROLEPLAY_EJS_ADAPTER_MODULE_ID,
      outcome: input.templateEngine === undefined || worldTemplateFailures > 0 ? 'degraded' as const
        : worldTemplateAttempts === 0 ? 'idle' as const : 'applied' as const,
      contributions: worldTemplateAttempts,
    }] : []),
    ...resolved.extensionOutcomes.recall,
  ]
  return {
    format: 0,
    input: {
      sessionId: String(input.session.id),
      sessionSeq: sessionBoundarySeq,
      pendingMessageIds: pendingMessages.map(message => String(message.id)),
    },
    runtime: snapshot,
    world,
    prompt,
    act,
    tools,
    stateReads,
    memory,
    generation: { ...(resolved.preset?.preset.generation ?? {}) },
    prepare: { modules: resolveRoleplayPrepareModuleOutcomes(snapshot, prepareDeclarations) },
    recall: { modules: resolveRoleplayRecallModuleOutcomes(snapshot, recallDeclarations) },
  }
}
