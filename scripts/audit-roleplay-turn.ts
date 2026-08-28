/** Content-free, model-free audit of one complete native Roleplay turn. */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import {
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import {
  Session,
  SessionId,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { EjsTemplateEngine } from '../src/ejs-template.ts'
import { parseCharx } from '../src/import/charx.ts'
import {
  parseCharacterCardJson,
  parseCharacterCardJsonBytes,
} from '../src/import/character-card.ts'
import {
  createCharacterCardSessionSeed,
} from '../src/import/character-card-seed.ts'
import { readCharacterCardPng } from '../src/import/png.ts'
import {
  createPresetSessionSeed,
} from '../src/import/session-preset.ts'
import {
  parseSillyTavernPresetBytes,
  presetTavernHelperScripts,
} from '../src/import/sillytavern-preset.ts'
import type {
  CharacterCardAttachmentRef,
  CharacterImportTransport,
} from '../src/import/session-character.ts'
import type { ImportedCharacterCard } from '../src/import/types.ts'
import { parseWorldInfoJsonBytes } from '../src/import/world-info.ts'
import { appendWorldInfoLibrarySessionSeed } from '../src/import/world-info-seed.ts'
import { appendMvuState, readCurrentSessionMvuState } from '../src/mvu.ts'
import {
  appendAgentRpMemorySeed,
  type AgentRpMemoryId,
} from '../src/memory.ts'
import { substituteCardMacros } from '../src/prompt.ts'
import {
  readCurrentRoleplayTurnPresentation,
  readRoleplayTurnPresentations,
} from '../src/roleplay-turn-presentation.ts'
import { prepareRoleplayTurn } from '../src/roleplay-turn-plan.ts'
import {
  readRoleplayTurnSettlements,
} from '../src/roleplay-turn-settlement.ts'
import {
  collectRoleplayStagedStateSettlement,
  runRoleplayStagedStateSettlement,
} from '../src/roleplay-staged-state-settlement.ts'
import { readRoleplayTurnRecords } from '../src/roleplay-turn-record.ts'
import { summarizeRoleplayTurnHealth } from '../src/roleplay-turn-health.ts'
import { ensureDefaultRoleplayTurnMode } from '../src/roleplay-turn-mode.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import { recoverSessionRoleplayTurns } from '../src/session-roleplay-turn-recovery.ts'
import {
  appendSessionRoleplayTurnPlan,
  replaySessionRoleplayTurnPlan,
} from '../src/session-roleplay-turn-plan.ts'
import {
  appendTavernHelperState,
  initializeTavernHelperPresetState,
  initializeTavernHelperState,
} from '../src/tavern-helper.ts'

type Counter = Readonly<Record<string, number>>

const DEFAULT_STATE_VERIFICATION_SETTINGS = {
  model: null,
  reasoningEffort: null,
} as const

/** Private file inputs consumed by the local audit. Paths are never returned. */
export interface RoleplayTurnAuditInput {
  readonly cardPath: string
  readonly presetPath: string
  readonly worldInfoPath: string
}

/** Content-free result safe to paste into an issue or community feedback thread. */
export interface RoleplayTurnAuditResult {
  readonly audit: 'roleplay-turn-roundtrip-v2'
  readonly ok: true
  readonly assets: {
    readonly card: {
      readonly transport: 'png' | 'json' | 'charx'
      readonly bytes: number
      readonly greetings: number
      readonly worldEntries: number
      readonly helperScripts: number
    }
    readonly preset: {
      readonly bytes: number
      readonly prompts: number
      readonly enabledPrompts: number
      readonly helperScripts: number
    }
    readonly worldInfo: {
      readonly bytes: number
      readonly entries: number
      readonly degradations: number
    }
  }
  readonly prepare: {
    readonly resources: number
    readonly stateReads: number
    readonly moduleOutcomes: Counter
    readonly promptModules: number
    readonly templateFailures: number
  }
  readonly recall: {
    readonly activeWorldEntries: number
    readonly memoryReads: number
    readonly moduleOutcomes: Counter
  }
  readonly settlement: {
    readonly receiptPresent: boolean
    readonly replyPresent: boolean
    readonly actSteps: number
    readonly assistantActions: number
    readonly toolCalls: number
    readonly toolResults: number
    readonly stagedState: boolean
    readonly moduleOutcomes: Counter
    readonly stateOutcomes: Counter
  }
  readonly presentation: {
    readonly current: boolean
    readonly replySelected: boolean
    readonly stateReferences: number
    readonly moduleOutcomes: Counter
  }
  readonly replay: {
    readonly events: number
    readonly settlementRecovered: boolean
    readonly presentationRecovered: boolean
    readonly preDispatchReceiptRecovered: boolean
    readonly recallReceiptRecovered: boolean
    readonly actReceiptRecovered: boolean
    readonly stagedStateRecovered: boolean
    readonly turnRecordRecovered: boolean
    readonly turnHealthRecovered: boolean
    readonly exactPlanRecovered: boolean
    readonly coldSettlementRecovered: boolean
    readonly resourceReferencesMatch: boolean
    readonly worldActivationMatches: boolean
    readonly stateReferencesResolve: boolean
    readonly memoryReferencesResolve: boolean
    readonly currentReplyMatches: boolean
    readonly nextPrepareContinues: boolean
    readonly nextRecallContinues: boolean
    readonly nextPrepareOutcomes: Counter
    readonly nextRecallOutcomes: Counter
  }
}

function counter(values: readonly string[]): Counter {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return result
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function fileAttachment(bytes: Uint8Array, path: string, mediaType: string) {
  return {
    kind: 'file' as const,
    attachmentId: AttachmentId(`sha256:${digest(bytes)}`),
    bytes: bytes.byteLength,
    name: basename(path),
    mediaType,
  }
}

function createCardAttachment(
  bytes: Uint8Array,
  path: string,
  transport: RoleplayTurnAuditResult['assets']['card']['transport'],
): CharacterCardAttachmentRef {
  if (transport !== 'png') {
    return fileAttachment(
      bytes,
      path,
      transport === 'charx' ? 'application/zip' : 'application/json',
    )
  }
  if (bytes.byteLength < 24) throw new Error('Roleplay turn audit PNG is truncated')
  const dimensions = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    attachmentId: AttachmentId(`sha256:${digest(bytes)}`),
    bytes: bytes.byteLength,
    mediaType: 'image/png',
    width: dimensions.getUint32(16),
    height: dimensions.getUint32(20),
  }
}

function parseCard(path: string, bytes: Uint8Array): {
  readonly card: ImportedCharacterCard
  readonly transport: CharacterImportTransport
  readonly label: RoleplayTurnAuditResult['assets']['card']['transport']
} {
  const extension = extname(path).toLocaleLowerCase()
  if (extension === '.png') {
    const payload = readCharacterCardPng(bytes)
    return {
      card: parseCharacterCardJson(payload.json),
      transport: { transport: 'png', metadataKeyword: payload.keyword },
      label: 'png',
    }
  }
  if (extension === '.charx') {
    return {
      card: parseCharx(bytes).card,
      transport: { transport: 'charx' },
      label: 'charx',
    }
  }
  if (extension === '.json') {
    return {
      card: parseCharacterCardJsonBytes(bytes),
      transport: { transport: 'json' },
      label: 'json',
    }
  }
  throw new Error('Roleplay turn audit card must be PNG, JSON, or CHARX')
}

function nextTurn(events: readonly SessionEvent[]): number {
  let highest = 0
  for (const event of events) {
    if (event.type === 'turn/start') highest = Math.max(highest, event.data.turn)
  }
  return highest + 1
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function appendSyntheticTurn(
  session: Session,
  turn: number,
  pending: ReturnType<typeof createUserMessage>,
  plan: ReturnType<typeof prepareRoleplayTurn>,
): Promise<Extract<SessionEvent, { type: 'assistant/message' }>> {
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', pending, { surfaceOp: 'append' })
  appendSessionRoleplayTurnPlan(session, turn, 1, plan)
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'agent-rp-audit', model: 'local-fixture', maxTokens: 4096 } },
  })
  const callId = ToolCallId('agent-rp-model-free-audit-call')
  const reply = session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'agent-rp-audit', model: 'local-fixture' },
      content: [
        { type: 'text', text: '[agent-rp:model-free-audit-reply]' },
        { type: 'tool-call', id: callId, name: 'agent_rp_audit_probe', arguments: '{}' },
      ],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const call = session.append('tool/call', {
    turn,
    step: 1,
    callId,
    name: 'agent_rp_audit_probe',
    arguments: '{}',
  })
  session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: '[agent-rp:model-free-audit-tool-result]' }],
      isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn, step: 1 })
  if (plan.act.stateActions.length > 0) {
    const fakeContext = {
      sessions: { flush: async () => true },
      llm: {
        stream() {
          return (async function* () {
            const text = '{"operations":[]}'
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text }
            yield { type: 'block-end', index: 0, block: { type: 'text', text } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
    } as unknown as Context
    await runRoleplayStagedStateSettlement({
      ctx: fakeContext,
      agent: { id: session.id, session } as Agent,
      turn,
      plan: { step: 1, plan },
      verification: DEFAULT_STATE_VERIFICATION_SETTINGS,
      signal: new AbortController().signal,
    })
  }
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return reply
}

/** Run one complete local turn and prove that its log can be reopened and continued. */
export async function auditRoleplayTurn(input: RoleplayTurnAuditInput): Promise<RoleplayTurnAuditResult> {
  const cardBytes = new Uint8Array(readFileSync(input.cardPath))
  const presetBytes = new Uint8Array(readFileSync(input.presetPath))
  const worldBytes = new Uint8Array(readFileSync(input.worldInfoPath))
  const parsedCard = parseCard(input.cardPath, cardBytes)
  const preset = parseSillyTavernPresetBytes(presetBytes, basename(input.presetPath))
  const worldInfo = parseWorldInfoJsonBytes(worldBytes)
  const cardAttachment = createCardAttachment(cardBytes, input.cardPath, parsedCard.label)
  const presetAttachment = fileAttachment(presetBytes, input.presetPath, 'application/json')
  const persona = {
    id: 'persona-00000000-0000-4000-8000-000000000999',
    name: 'Audit User',
    description: 'Local model-free audit participant.',
  }
  let seed = createCharacterCardSessionSeed(
    parsedCard.card,
    cardAttachment,
    0,
    substituteCardMacros(parsedCard.card.firstMessage, parsedCard.card, persona.name),
    parsedCard.transport,
    persona.name,
    persona,
  )
  const worldId = `world-info-${digest(worldBytes).slice(0, 32)}`
  seed = appendWorldInfoLibrarySessionSeed(seed, {
    upload: {
      id: worldId,
      name: worldInfo.name?.trim() || basename(input.worldInfoPath, '.json'),
      entryCount: worldInfo.lorebook.entries.length,
      degradations: worldInfo.degradations,
      defaultForNewSessions: false,
    },
    worldInfo,
    filename: basename(input.worldInfoPath),
    data: worldBytes,
  })
  seed = createPresetSessionSeed(seed, preset, presetAttachment)
  seed = appendAgentRpMemorySeed(seed, [{
    version: 0,
    id: 'memory-audit-fixture' as AgentRpMemoryId,
    kind: 'fact',
    subject: 'local-audit',
    text: 'This entry verifies replayable memory references.',
    sourceEventSeq: 0,
  }], 'agent-rp-local-audit-source')

  const session = Session.create(SessionId('agent-rp-roleplay-turn-audit'), seed)
  ensureDefaultRoleplayTurnMode(session, 'agent')
  let tavern = initializeTavernHelperState(
    parsedCard.card.frontend,
    String(cardAttachment.attachmentId),
  )
  tavern = initializeTavernHelperPresetState(
    tavern,
    presetTavernHelperScripts(preset),
    preset.tavernHelperVariables ?? {},
    String(presetAttachment.attachmentId),
  )
  appendTavernHelperState(session, tavern)
  const initialMvu = readCurrentSessionMvuState(parsedCard.card, session)
  if (initialMvu !== undefined) appendMvuState(session, initialMvu)

  const deployment = resolveConfig({ characterName: 'Audit Actor' })
  const engine = await EjsTemplateEngine.create()
  const pending = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '[agent-rp:model-free-audit-input]' }],
  })
  const turn = nextTurn(session.events)
  session.append('turn/start', { turn })
  const before = resolveSessionRoleplayRuntime({
    session,
    deployment,
    memoryWriteAvailable: true,
    templateEngineAvailable: true,
  })
  const plan = prepareRoleplayTurn({
    session,
    pendingMessages: [pending],
    deployment,
    resolved: before,
    templateEngine: engine,
  })
  const reply = await appendSyntheticTurn(session, turn, pending, plan)
  const recovery = recoverSessionRoleplayTurns({
    session,
    deployment,
    templateEngineAvailable: true,
  })
  const settlementEvent = session.events.find(event => event.type === 'agent-rp/turn-settlement'
    && event.data.turn === turn)
  if (settlementEvent?.type !== 'agent-rp/turn-settlement') {
    throw new Error('Roleplay turn audit settlement recovery failed')
  }
  const settlement = settlementEvent.data
  const stagedState = collectRoleplayStagedStateSettlement({
    events: session.events,
    sessionId: String(session.id),
    turn,
    plans: settlement.plans,
  })
  const presentation = readCurrentRoleplayTurnPresentation(session.events)
  if (presentation === undefined || presentation.settlementSeq !== settlementEvent.seq) {
    throw new Error('Roleplay turn audit presentation recovery failed')
  }

  const reopened = Session.create(session.id, structuredClone(session.events))
  const recoveredSettlement = readRoleplayTurnSettlements(reopened.events).find(value => value.turn === turn)
  const recoveredPresentation = readRoleplayTurnPresentations(reopened.events).find(value =>
    value.settlementSeq === settlementEvent.seq)
  const settlementRecovered = recoveredSettlement !== undefined && equalJson(recoveredSettlement, settlement)
  const presentationRecovered = recoveredPresentation !== undefined
    && equalJson(recoveredPresentation, presentation)
  const currentPresentation = readCurrentRoleplayTurnPresentation(reopened.events)
  const replayed = resolveSessionRoleplayRuntime({
    session: reopened,
    deployment,
    memoryWriteAvailable: true,
    templateEngineAvailable: true,
  })
  const receipt = recoveredSettlement?.plans[0]?.receipt
  const planRecord = reopened.events.find(event => event.type === 'agent-rp/turn-plan'
    && event.data.turn === turn && event.data.reference.step === 1)
  const preDispatchReceiptRecovered = planRecord?.type === 'agent-rp/turn-plan'
  const recallReceiptRecovered = receipt?.recall !== undefined && equalJson(receipt.recall, plan.recall)
  const actReceiptRecovered = recoveredSettlement?.act !== undefined
    && equalJson(recoveredSettlement.act, settlement.act)
    && recoveredSettlement.act.steps.some(step => step.assistantMessages.some(message =>
      message.eventSeq === reply.seq && message.messageId === String(reply.data.message.id)))
  const stagedStateRecovered = plan.act.stateActions.length === 0
    ? stagedState === undefined
    : stagedState?.outcome === 'success'
  const turnRecord = readRoleplayTurnRecords(reopened).find(value => value.turn === turn)
  const turnRecordRecovered = turnRecord?.plans.length === 1
    && turnRecord.act?.steps.length === 1
    && turnRecord.act.steps[0]?.toolCalls.length === 1
    && turnRecord.act.steps[0]?.toolResults.length === 1
    && turnRecord.settle?.eventSeq === settlementEvent.seq
    && turnRecord.settle.reply?.eventSeq === reply.seq
    && turnRecord.present?.selectedReply?.sourceSeq === reply.seq
  const turnHealth = summarizeRoleplayTurnHealth(readRoleplayTurnRecords(reopened))
  const turnHealthRecovered = turnHealth.latest?.turn === turn
    && turnHealth.latest.status === 'complete'
    && turnHealth.latest.nextPhase === undefined
    && (turnHealth.latest.worldRecall?.outcomes.applied ?? 0) > 0
    && (turnHealth.latest.worldRecall?.contributions ?? 0) > 0
    && turnHealth.latest.phases.settled
    && turnHealth.latest.phases.presented
  const exactPlanRecovered = planRecord?.type === 'agent-rp/turn-plan' && equalJson(
    replaySessionRoleplayTurnPlan({ session: reopened, record: planRecord, deployment, templateEngine: engine }),
    plan,
  )
  const coldSettlementRecovered = recovery.settlements === 1 && recovery.presentations === 1
  const runtimeResourceIds = [
    replayed.snapshot.experience.id,
    ...(replayed.snapshot.actor === undefined ? [] : [replayed.snapshot.actor.id]),
    ...(replayed.snapshot.participant === undefined ? [] : [replayed.snapshot.participant.id]),
    ...replayed.snapshot.world.bindings.map(binding => binding.id),
    ...(replayed.snapshot.prompt.resource === undefined ? [] : [replayed.snapshot.prompt.resource.id]),
  ]
  const receiptResourceIds = receipt === undefined ? [] : [
    receipt.runtime.experienceId,
    ...(receipt.runtime.actorId === undefined ? [] : [receipt.runtime.actorId]),
    ...(receipt.runtime.participantId === undefined ? [] : [receipt.runtime.participantId]),
    ...receipt.runtime.worldIds,
    ...(receipt.runtime.promptId === undefined ? [] : [receipt.runtime.promptId]),
  ]
  const planWorldEntries = plan.world.resources.map(resource => ({
    resourceId: resource.resource.id,
    entryIds: resource.entries.filter(entry => entry.active).map(entry => entry.entryId),
  }))
  const worldActivationMatches = receipt !== undefined
    && receipt.world.activeEntries.length === planWorldEntries.length
    && receipt.world.activeEntries.every((entry, index) => {
      const expected = planWorldEntries[index]
      return expected !== undefined && entry.resourceId === expected.resourceId
        && equalStrings(entry.entryIds, expected.entryIds)
    })
  const stateReferencesResolve = receipt !== undefined && receipt.stateReads.every(read =>
    replayed.snapshot.state.some(binding => binding.id === read.id)
      && (read.eventSeq === undefined || reopened.events[read.eventSeq]?.seq === read.eventSeq))
  const memoryReferencesResolve = receipt !== undefined && receipt.memoryReads.every(read =>
    reopened.events[read.sourceEventSeq]?.seq === read.sourceEventSeq)
  const currentReplyMatches = currentPresentation?.current === true
    && currentPresentation.selectedReply?.sourceSeq === reply.seq
    && currentPresentation.selectedReply?.messageId === String(reply.data.message.id)
    && recoveredSettlement?.reply?.eventSeq === reply.seq
  const nextPending = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '[agent-rp:model-free-audit-next-input]' }],
  })
  const nextPlan = prepareRoleplayTurn({
    session: reopened,
    pendingMessages: [nextPending],
    deployment,
    resolved: replayed,
    templateEngine: engine,
  })
  const nextPrepareContinues = nextPlan.input.sessionSeq === reopened.seq
    && nextPlan.input.pendingMessageIds.length === 1
    && nextPlan.prepare.modules.length === nextPlan.runtime.modules.filter(module =>
      module.phases.includes('prepare')).length
  const nextRecallContinues = nextPlan.recall.modules.length === nextPlan.runtime.modules.filter(module =>
    module.phases.includes('recall')).length
    && equalStrings(
      nextPlan.runtime.world.bindings.map(binding => binding.id),
      plan.runtime.world.bindings.map(binding => binding.id),
    )

  if (receipt === undefined || !settlementRecovered || !presentationRecovered
    || !equalStrings(runtimeResourceIds, receiptResourceIds)
    || !worldActivationMatches || !stateReferencesResolve || !memoryReferencesResolve
    || !preDispatchReceiptRecovered || !recallReceiptRecovered || !actReceiptRecovered
    || !stagedStateRecovered || !turnRecordRecovered
    || !turnHealthRecovered
    || !exactPlanRecovered || !coldSettlementRecovered
    || !currentReplyMatches || !nextPrepareContinues || !nextRecallContinues) {
    throw new Error('Roleplay turn audit replay invariant failed')
  }

  return {
    audit: 'roleplay-turn-roundtrip-v2',
    ok: true,
    assets: {
      card: {
        transport: parsedCard.label,
        bytes: cardBytes.byteLength,
        greetings: 1 + parsedCard.card.alternateGreetings.length,
        worldEntries: parsedCard.card.lorebook?.entries.length ?? 0,
        helperScripts: parsedCard.card.frontend.tavernHelperScripts.length,
      },
      preset: {
        bytes: presetBytes.byteLength,
        prompts: preset.prompts.length,
        enabledPrompts: preset.order.filter(entry => entry.enabled).length,
        helperScripts: presetTavernHelperScripts(preset).length,
      },
      worldInfo: {
        bytes: worldBytes.byteLength,
        entries: worldInfo.lorebook.entries.length,
        degradations: worldInfo.degradations.length,
      },
    },
    prepare: {
      resources: runtimeResourceIds.length,
      stateReads: plan.stateReads.length,
      moduleOutcomes: counter(plan.prepare.modules.map(module => module.outcome)),
      promptModules: plan.prompt.diagnostics.enabledModules,
      templateFailures: plan.prompt.diagnostics.templateFailures,
    },
    recall: {
      activeWorldEntries: planWorldEntries.reduce((total, resource) => total + resource.entryIds.length, 0),
      memoryReads: plan.memory.reads.length,
      moduleOutcomes: counter(plan.recall.modules.map(module => module.outcome)),
    },
    settlement: {
      receiptPresent: true,
      replyPresent: recoveredSettlement?.reply !== undefined,
      actSteps: settlement.act?.steps.length ?? 0,
      assistantActions: settlement.act?.steps.reduce((total, step) =>
        total + step.assistantMessages.length, 0) ?? 0,
      toolCalls: settlement.act?.steps.reduce((total, step) => total + step.toolCalls.length, 0) ?? 0,
      toolResults: settlement.act?.steps.reduce((total, step) => total + step.toolResults.length, 0) ?? 0,
      stagedState: stagedState?.outcome === 'success',
      moduleOutcomes: counter(settlement.settle.modules.map(module => module.outcome)),
      stateOutcomes: counter(settlement.state.map(state => state.outcome)),
    },
    presentation: {
      current: presentation.current,
      replySelected: presentation.selectedReply !== undefined,
      stateReferences: presentation.state.length,
      moduleOutcomes: counter(presentation.present.modules.map(module => module.outcome)),
    },
    replay: {
      events: reopened.events.length,
      settlementRecovered,
      presentationRecovered,
      preDispatchReceiptRecovered,
      recallReceiptRecovered,
      actReceiptRecovered,
      stagedStateRecovered,
      turnRecordRecovered,
      turnHealthRecovered,
      exactPlanRecovered,
      coldSettlementRecovered,
      resourceReferencesMatch: true,
      worldActivationMatches,
      stateReferencesResolve,
      memoryReferencesResolve,
      currentReplyMatches,
      nextPrepareContinues,
      nextRecallContinues,
      nextPrepareOutcomes: counter(nextPlan.prepare.modules.map(module => module.outcome)),
      nextRecallOutcomes: counter(nextPlan.recall.modules.map(module => module.outcome)),
    },
  }
}

function requiredOption(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  const value = index < 0 ? undefined : args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing required option ${name}`)
  return resolve(value)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const result = await auditRoleplayTurn({
    cardPath: requiredOption(args, '--card'),
    presetPath: requiredOption(args, '--preset'),
    worldInfoPath: requiredOption(args, '--world-info'),
  })
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
}

const entry = process.argv[1]
if (entry !== undefined && basename(entry).startsWith('audit-roleplay-turn.')
  && pathToFileURL(resolve(entry)).href === import.meta.url) {
  main().catch(() => {
    process.stderr.write(`${JSON.stringify({ audit: 'roleplay-turn-roundtrip-v2', ok: false })}\n`)
    process.exitCode = 1
  })
}
