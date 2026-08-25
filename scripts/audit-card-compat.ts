/** Content-free local compatibility audit for one private Character Card. */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  cardRemoteResourceApprovalKey, cardRemoteResourceRequirements,
} from '../src/card-remote-resource.ts'
import { EjsTemplateEngine, type EjsTemplateFailureKind } from '../src/ejs-template.ts'
import { AI_OUTPUT_PLACEMENT, renderCharacterDisplay } from '../src/frontend-regex.ts'
import { parseCharx } from '../src/import/charx.ts'
import {
  MAX_CHARACTER_CARD_FILE_BYTES, parseCharacterCardJson, parseCharacterCardJsonBytes,
} from '../src/import/character-card.ts'
import type { LorebookActivationReason } from '../src/import/lorebook.ts'
import { readCharacterCardPng } from '../src/import/png.ts'
import type { ImportedCharacterCard } from '../src/import/types.ts'
import { substituteMvuMacros } from '../src/mvu.ts'
import { substituteSillyTavernIdentityMacros } from '../src/sillytavern-identity-macro.ts'
import {
  resolveTavernScriptExecution, TavernScriptOriginApprovalError,
} from '../src/tavern-script-resolver.ts'
import { createNativeWorldEngine, summarizeWorldEngineResult } from '../src/world-engine.ts'
import {
  CARD_GREETING_CAPABILITY_MANIFEST,
  CARD_FRONTEND_CAPABILITY_MANIFEST,
  NATIVE_WORLD_ENGINE_MANIFEST,
  TAVERN_LEGACY_ADAPTER_MANIFEST,
  AGENT_RP_CAPABILITIES,
  mergeAgentRpCapabilityPlanSummaries,
  resolveAgentRpCapabilityPlan,
  summarizeAgentRpCapabilityPlan,
  type AgentRpCapabilityPlanSummary,
} from '../src/extension-capability.ts'

type Counter = Record<string, number>

/** Content-free result printed by the local card audit command. */
export interface CharacterCardCompatibilityAudit {
  readonly audit: 'private-character-card-compat-v1'
  readonly transport: 'png' | 'json' | 'charx'
  readonly fileBytes: number
  readonly capabilities: AgentRpCapabilityPlanSummary & { readonly extensions: number }
  readonly variables: {
    readonly surfaces: number
    readonly sharedScopes: number
    readonly scriptScopes: number
    readonly minimumRequestBytes: number
    readonly maximumRequestBytes: number
  }
  readonly card: {
    readonly version: number
    readonly greetings: number
    readonly assets: number
    readonly worldInfoEntries: number
    readonly worldInfoRegexEntries: number
    readonly worldInfoDecoratorEntries: number
    readonly displayRegexScripts: number
    readonly enabledDisplayRegexScripts: number
    readonly tavernScripts: number
    readonly enabledTavernScripts: number
    readonly remoteResources: number
    readonly remoteResourceOrigins: number
    readonly remoteResourceClasses: Counter
    readonly degradationCounts: Counter
  }
  readonly ejs: {
    readonly templates: number
    readonly outcomes: Counter
    readonly durationMs: number
  }
  readonly worldInfo?: {
    readonly engine: 'native-v0'
    readonly books: number
    readonly entries: number
    readonly activeEntries: number
    readonly promptContributions: number
    readonly approximateTokens: number
    readonly reasons: Partial<Record<LorebookActivationReason, number>>
    readonly templateOutcomes: Counter
    readonly durationMs: number
  }
  readonly tavern: {
    readonly outcomes: Counter
    readonly modes: Counter
    readonly preloads: Counter
    readonly dependencyCount: number
    readonly dependencyBytes: number
    readonly networkRequests: number
    readonly uniqueNetworkRequests: number
    readonly compatibilityMarkers: number
    readonly remoteImageOrigins: number
    readonly remoteFrameOrigins: number
    readonly durationMs: number
  }
}

function increment(counter: Counter, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1
}

function roundedDuration(started: number): number {
  return Number((performance.now() - started).toFixed(2))
}

function cardTransport(path: string, bytes: Uint8Array): {
  readonly card: ImportedCharacterCard
  readonly transport: CharacterCardCompatibilityAudit['transport']
} {
  if (bytes.byteLength > MAX_CHARACTER_CARD_FILE_BYTES) {
    throw new Error(`Character Card exceeds ${MAX_CHARACTER_CARD_FILE_BYTES} bytes`)
  }
  const extension = extname(path).toLocaleLowerCase()
  if (extension === '.png') {
    return { card: parseCharacterCardJson(readCharacterCardPng(bytes).json), transport: 'png' }
  }
  if (extension === '.charx') return { card: parseCharx(bytes).card, transport: 'charx' }
  if (extension === '.json') return { card: parseCharacterCardJsonBytes(bytes), transport: 'json' }
  throw new Error('audit input must use a .png, .json, or .charx filename')
}

function templateSources(card: ImportedCharacterCard): readonly {
  readonly source: string
  readonly worldInfoBookId?: string
}[] {
  return [
    card.description,
    card.personality,
    card.scenario,
    card.firstMessage,
    card.messageExample,
    card.systemPrompt,
    card.postHistoryInstructions,
    ...card.alternateGreetings,
  ].map(source => ({ source })).concat(card.lorebook?.entries.map(entry => ({
    source: entry.content,
    worldInfoBookId: 'character-card',
  })) ?? [])
}

/** Audit one parsed private card without returning its names, prose, expressions, URLs, or script source. */
export async function auditCharacterCardCompatibility(
  path: string,
  bytes: Uint8Array,
): Promise<CharacterCardCompatibilityAudit> {
  const parsed = cardTransport(path, bytes)
  const card = parsed.card
  const engine = await EjsTemplateEngine.create()
  const worldInfoBooks = card.lorebook === undefined ? [] : [{
    id: 'character-card',
    entries: card.lorebook.entries.map(entry => ({
      sourceId: entry.sourceId,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      ...(entry.comment === undefined ? {} : { comment: entry.comment }),
      content: entry.content,
    })),
  }]
  const variables = card.frontend.tavernHelperVariables
  const context = {
    characterName: 'Character',
    userName: 'User',
    entropy: 'agent-rp-private-card-compat-v1',
    messages: ['Synthetic user message', 'Synthetic assistant message'],
    transcript: [
      { role: 'user' as const, content: 'Synthetic user message' },
      { role: 'assistant' as const, content: 'Synthetic assistant message' },
    ],
    variableScopes: { character: variables },
    statData: variables.stat_data ?? {},
    worldInfoBooks,
  }
  const renderMacros = (value: string): string => substituteSillyTavernIdentityMacros(
    substituteMvuMacros(value, context.statData),
    { characterName: context.characterName, userName: context.userName },
  )

  const ejsStarted = performance.now()
  const ejsOutcomes: Counter = {}
  const templates = templateSources(card).filter(entry => entry.source.includes('<%'))
  for (const entry of templates) {
    const result = engine.render(renderMacros(entry.source), context, entry.worldInfoBookId === undefined
      ? {} : { worldInfoBookId: entry.worldInfoBookId })
    increment(ejsOutcomes, result.ok ? 'ok' : result.kind satisfies EjsTemplateFailureKind)
  }
  const ejsDurationMs = roundedDuration(ejsStarted)

  let worldInfo: CharacterCardCompatibilityAudit['worldInfo']
  if (card.lorebook !== undefined) {
    const worldInfoStarted = performance.now()
    const inspected = createNativeWorldEngine({
      regexEngine: engine,
      renderTemplate: (template, target) => engine.render(template, context, target),
      renderMacro: renderMacros,
    }).evaluate({
      format: 0,
      books: [{ id: 'character-card', lorebook: card.lorebook }],
      messages: ['Synthetic compatibility input'],
    })
    const diagnostics = summarizeWorldEngineResult(inspected)
    worldInfo = {
      engine: diagnostics.engine,
      books: diagnostics.books,
      entries: diagnostics.entries,
      activeEntries: diagnostics.activeEntries,
      promptContributions: diagnostics.promptContributions,
      approximateTokens: diagnostics.approximateTokens,
      reasons: diagnostics.reasons,
      templateOutcomes: diagnostics.templateOutcomes,
      durationMs: roundedDuration(worldInfoStarted),
    }
  }

  const tavernStarted = performance.now()
  const tavernOutcomes: Counter = {}
  const modes: Counter = {}
  const preloads: Counter = {}
  let dependencyCount = 0
  let dependencyBytes = 0
  let networkRequests = 0
  const networkRequestUrls = new Set<string>()
  let compatibilityMarkers = 0
  let remoteImageOrigins = 0
  let remoteFrameOrigins = 0
  const enabledTavernScripts = card.frontend.tavernHelperScripts.filter(
    value => value.enabled && value.content.trim() !== '',
  )
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    networkRequests += 1
    networkRequestUrls.add(input instanceof Request ? input.url : String(input))
    return originalFetch(input, init)
  }
  let tavernPlans: readonly ({ readonly kind: 'resolved'; readonly execution: Awaited<ReturnType<typeof resolveTavernScriptExecution>> }
    | { readonly kind: 'failed'; readonly error: unknown })[]
  try {
    tavernPlans = await Promise.all(enabledTavernScripts.map(async script => {
      try {
        return {
          kind: 'resolved' as const,
          execution: await resolveTavernScriptExecution(script.content, AbortSignal.timeout(30_000)),
        }
      } catch (error: unknown) {
        return { kind: 'failed' as const, error }
      }
    }))
  } finally {
    globalThis.fetch = originalFetch
  }
  for (const plan of tavernPlans) {
    if (plan.kind === 'resolved') {
      const { execution } = plan
      increment(tavernOutcomes, 'resolved')
      increment(modes, execution.mode)
      for (const preload of execution.preloads) increment(preloads, preload)
      dependencyCount += execution.inlineDependencies?.length ?? 0
      dependencyBytes += (execution.inlineDependencies ?? [])
        .reduce((total, source) => total + Buffer.byteLength(source), 0)
      compatibilityMarkers += execution.compatibilityMarkers.length
      remoteImageOrigins += execution.remoteImageOrigins?.length ?? 0
      remoteFrameOrigins += execution.remoteFrameOrigins?.length ?? 0
    } else {
      increment(tavernOutcomes, plan.error instanceof TavernScriptOriginApprovalError
        ? 'permission-required' : 'resolution-error')
    }
  }

  const degradationCounts: Counter = {}
  for (const degradation of card.degradations) increment(degradationCounts, degradation)
  const remoteResourceSources = [card.firstMessage, ...card.alternateGreetings]
    .map(greeting => renderCharacterDisplay(greeting, card, AI_OUTPUT_PLACEMENT, 0))
    .concat(card.frontend.regexScripts.map(script => script.replaceString))
  const remoteResources = new Map(
    remoteResourceSources.flatMap(cardRemoteResourceRequirements)
      .map(resource => [cardRemoteResourceApprovalKey(resource), resource] as const),
  )
  const remoteResourceOrigins = new Set([...remoteResources.values()].map(resource => resource.origin))
  const remoteResourceClasses: Counter = {}
  for (const resource of remoteResources.values()) increment(remoteResourceClasses, resource.type)
  const hasTavernVariableSurface = card.frontend.tavernHelperScripts
    .some(script => script.enabled && script.content.trim() !== '')
  const capabilityPlans = [
    resolveAgentRpCapabilityPlan(CARD_FRONTEND_CAPABILITY_MANIFEST),
    ...(card.lorebook === undefined ? [] : [resolveAgentRpCapabilityPlan(NATIVE_WORLD_ENGINE_MANIFEST)]),
    ...(card.alternateGreetings.length === 0
      ? [] : [resolveAgentRpCapabilityPlan(CARD_GREETING_CAPABILITY_MANIFEST)]),
    ...(hasTavernVariableSurface
      ? [resolveAgentRpCapabilityPlan(TAVERN_LEGACY_ADAPTER_MANIFEST)] : []),
  ]
  const capabilitySummary = mergeAgentRpCapabilityPlanSummaries(
    capabilityPlans.map(summarizeAgentRpCapabilityPlan),
  )
  return {
    audit: 'private-character-card-compat-v1',
    transport: parsed.transport,
    fileBytes: bytes.byteLength,
    capabilities: { extensions: capabilityPlans.length, ...capabilitySummary },
    variables: {
      surfaces: hasTavernVariableSurface ? 2 : 1,
      sharedScopes: 5,
      scriptScopes: hasTavernVariableSurface ? 1 : 0,
      minimumRequestBytes: AGENT_RP_CAPABILITIES['session.variables.replace']
        .runtimePolicies['card-frame-v0'].requestBytes,
      maximumRequestBytes: hasTavernVariableSurface
        ? AGENT_RP_CAPABILITIES['session.variables.replace']
          .runtimePolicies['tavern-script-frame-v0'].requestBytes
        : AGENT_RP_CAPABILITIES['session.variables.replace']
          .runtimePolicies['card-frame-v0'].requestBytes,
    },
    card: {
      version: card.version,
      greetings: 1 + card.alternateGreetings.length,
      assets: card.assets?.length ?? 0,
      worldInfoEntries: card.lorebook?.entries.length ?? 0,
      worldInfoRegexEntries: card.lorebook?.entries.filter(entry => entry.useRegex).length ?? 0,
      worldInfoDecoratorEntries: card.lorebook?.entries.filter(entry => entry.hasDecorators).length ?? 0,
      displayRegexScripts: card.frontend.regexScripts.length,
      enabledDisplayRegexScripts: card.frontend.regexScripts.filter(script => !script.disabled).length,
      tavernScripts: card.frontend.tavernHelperScripts.length,
      enabledTavernScripts: card.frontend.tavernHelperScripts.filter(script => script.enabled).length,
      remoteResources: remoteResources.size,
      remoteResourceOrigins: remoteResourceOrigins.size,
      remoteResourceClasses,
      degradationCounts,
    },
    ejs: { templates: templates.length, outcomes: ejsOutcomes, durationMs: ejsDurationMs },
    ...(worldInfo === undefined ? {} : { worldInfo }),
    tavern: {
      outcomes: tavernOutcomes,
      modes,
      preloads,
      dependencyCount,
      dependencyBytes,
      networkRequests,
      uniqueNetworkRequests: networkRequestUrls.size,
      compatibilityMarkers,
      remoteImageOrigins,
      remoteFrameOrigins,
      durationMs: roundedDuration(tavernStarted),
    },
  }
}

const [path] = process.argv.slice(2).filter(argument => argument !== '--')
if (path === undefined || process.argv.slice(2).filter(argument => argument !== '--').length !== 1) {
  throw new Error('usage: pnpm run audit:card -- <private-card.png|json|charx>')
}
const report = await auditCharacterCardCompatibility(path, readFileSync(path))
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
