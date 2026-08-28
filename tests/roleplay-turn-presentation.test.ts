import assert from 'node:assert/strict'
import test from 'node:test'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { ToolCallId, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type JsonValue } from '@deepseek-ai/dsh-session'
import { decodeGenerationState, encodeGenerationState, executeGenerationCommand } from '../src/generation.ts'
import { agentRpProjectionDefinition } from '../src/projection.ts'
import { ROLEPLAY_TURN_PHASES, type RoleplayRuntimeSnapshot } from '../src/roleplay-runtime.ts'
import type { RoleplayTurnPlan } from '../src/roleplay-turn-plan.ts'
import { prepareRoleplayToolPolicy } from '../src/roleplay-tool-guidance.ts'
import {
  appendRoleplayTurnPresentation,
  compileInitialRoleplayTurnPresentation,
  compileRoleplayModulePresentationUpdate,
  readCurrentRoleplayTurnPresentation,
  readRoleplayTurnPresentations,
} from '../src/roleplay-turn-presentation.ts'
import {
  normalizeRoleplayTurnPresentation,
  roleplayPresentedState,
} from '../src/roleplay-turn-presentation-state.ts'
import {
  compileInitialSessionRoleplayTurnPresentation,
  compileSessionRoleplayTurnPresentationUpdate,
} from '../src/session-roleplay-turn-presentation.ts'
import {
  appendRoleplayTurnSettlement,
  compileRoleplayTurnSettlement,
} from '../src/roleplay-turn-settlement.ts'
import {
  appendTavernHelperState,
  appendTavernHelperStateAttachment,
  applyTavernHelperMutation,
  initializeTavernHelperState,
  parseTavernHelperMutationRequest,
  readTavernHelperState,
} from '../src/tavern-helper.ts'
import { validateTavernMutationCause } from '../src/tavern-helper-command.ts'

const modules = [
  { id: 'roleplay:reply-versions', source: 'native', phases: ['present'] },
  { id: 'adapter:mvu', source: 'adapter', phases: ['prepare', 'settle'], stateIds: ['state:mvu'] },
  {
    id: 'adapter:tavern-helper', source: 'adapter', phases: ROLEPLAY_TURN_PHASES,
    stateIds: ['state:tavern-helper'],
  },
] as const

function runtime(state: RoleplayRuntimeSnapshot['state'] = []): RoleplayRuntimeSnapshot {
  return {
    format: 0,
    lifecycle: ROLEPLAY_TURN_PHASES,
    experience: { id: 'actor:test', name: '测试角色', owner: 'session', mode: 'character' },
    world: { bindings: [] },
    prompt: { strategy: 'native' },
    state,
    memory: { read: true, write: false },
    modules,
  }
}

function plan(session: Session, state: RoleplayRuntimeSnapshot['state'] = []): RoleplayTurnPlan {
  const snapshot = runtime(state)
  return {
    format: 0,
    input: { sessionId: String(session.id), sessionSeq: session.seq, pendingMessageIds: [] },
    runtime: snapshot,
    world: {
      engine: 'native-v0', resources: [], inChat: [], experienceBeforeActor: [], actorBefore: [], actorAfter: [],
      experienceAfterActor: [], approximateTokens: 0,
    },
    prompt: {
      beforeHistory: [], afterHistory: [], inChat: [], includeHistory: true, systemPromptText: '',
      transforms: { actorName: snapshot.experience.name, operations: [] },
      diagnostics: { enabledModules: 0, unsupportedMacros: 0, templateFailures: 0 },
    },
    act: { strategy: 'conversation', responseRepairs: [], stateActions: [] },
    tools: prepareRoleplayToolPolicy(),
    stateReads: snapshot.state,
    memory: { ...snapshot.memory, reads: [], contextText: '' },
    generation: {},
    prepare: { modules: [] },
    recall: { modules: [] },
  }
}

function appendReply(session: Session, turn: number, text: string) {
  return session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

function appendAutoStagedArtifact(session: Session, turn: number, id: string) {
  const attachment: ImageAttachmentRef = {
    attachmentId: AttachmentId(`sha256:${id}`),
    mediaType: 'image/png',
    bytes: 68,
    width: 1,
    height: 1,
  }
  const callId = ToolCallId(`image-${id}`)
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'tool-call', id: callId, name: 'generate_image', arguments: '{}' }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const call = session.append('tool/call', {
    turn, step: 1, callId, name: 'generate_image', arguments: '{}',
  })
  const result = session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId, content: [{ type: 'text', text: '[image artifact]' }], isError: false,
    }),
    meta: {
      format: 'dsh.tool-artifacts',
      version: 0,
      artifacts: [{ type: 'image', attachment }],
      data: { format: 'agent-rp.artifact-stage-intent', version: 0, caption: id },
    } as unknown as JsonValue,
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  return { attachment, result }
}

function tavernState() {
  return initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: [], tavernHelperVariables: {}, tavernHelperScripts: [],
  }, 'presentation-card')
}

function settle(session: Session, turnPlan: RoleplayTurnPlan, turn: number, deferred = true) {
  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id),
    turn,
    result: 'completed',
    plans: [{ step: 1, plan: turnPlan }],
    events: session.events,
    after: runtime(turnPlan.stateReads),
    ...(deferred ? {
      contributions: [{ moduleId: 'adapter:tavern-helper', outcome: 'deferred' as const }],
    } : {}),
  })
  return appendRoleplayTurnSettlement(session, settlement)
}

test('presents the settled reply with pending browser state and survives replay', () => {
  const session = Session.create(SessionId('presentation-initial'))
  appendTavernHelperState(session, tavernState())
  session.append('turn/start', { turn: 1 })
  const turnPlan = plan(session, [
    { id: 'state:mvu', owner: 'session', revision: 2 },
    { id: 'state:tavern-helper', owner: 'session', revision: 0 },
  ])
  const reply = appendReply(session, 1, '第一轮回复')
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const settlementEvent = settle(session, turnPlan, 1)
  const presentation = compileInitialSessionRoleplayTurnPresentation({
    session, settlementEvent, plans: [{ step: 1, plan: turnPlan }],
  })
  const first = appendRoleplayTurnPresentation(session, presentation)
  const duplicate = appendRoleplayTurnPresentation(session, presentation)

  assert.equal(duplicate.seq, first.seq)
  assert.deepEqual(presentation.selectedReply, {
    sourceSeq: reply.seq, surfaceSeq: reply.seq, messageId: String(reply.data.message.id),
  })
  assert.deepEqual(presentation.state, [
    { id: 'state:mvu', status: 'settled', eventSeq: settlementEvent.seq },
    { id: 'state:tavern-helper', status: 'pending', eventSeq: 0 },
  ])
  assert.deepEqual(presentation.present.modules, [
    { moduleId: 'roleplay:reply-versions', outcome: 'applied', changes: 1 },
    { moduleId: 'adapter:tavern-helper', outcome: 'pending', changes: 0 },
  ])
  const reopened = Session.create(session.id, session.events)
  assert.deepEqual(readRoleplayTurnPresentations(reopened.events), [presentation])
  assert.deepEqual(readCurrentRoleplayTurnPresentation(reopened.events), presentation)
  let projected = agentRpProjectionDefinition.init(reopened.header)
  for (const event of reopened.events) projected = agentRpProjectionDefinition.apply(projected, event)
  assert.deepEqual(agentRpProjectionDefinition.wire.view(projected).presentation, presentation)
})

test('binds only explicitly staged durable artifacts to the settled reply', () => {
  const session = Session.create(SessionId('presentation-artifact'))
  session.append('turn/start', { turn: 1 })
  const turnPlan = plan(session)
  const attachment: ImageAttachmentRef = {
    attachmentId: AttachmentId('sha256:presentation-artifact'),
    mediaType: 'image/png',
    bytes: 68,
    width: 1,
    height: 1,
  }
  const reply = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [
        { type: 'text', text: '雨还没有停。' },
        { type: 'tool-call', id: ToolCallId('image-source'), name: 'generate_image', arguments: '{}' },
      ],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const sourceCall = session.append('tool/call', {
    turn: 1, step: 1, callId: ToolCallId('image-source'), name: 'generate_image', arguments: '{}',
  })
  const sourceResult = session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId('image-source'), content: [{ type: 'text', text: '[image artifact]' }], isError: false,
    }),
    meta: {
      format: 'dsh.tool-artifacts', version: 0, artifacts: [{ type: 'image', attachment }],
    } as unknown as JsonValue,
  }, { surfaceOp: 'append', sourceEventSeqs: [sourceCall.seq] })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{
        type: 'tool-call', id: ToolCallId('image-stage'), name: 'stage_roleplay_artifact', arguments: '{}',
      }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const stageCall = session.append('tool/call', {
    turn: 1, step: 1, callId: ToolCallId('image-stage'), name: 'stage_roleplay_artifact', arguments: '{}',
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId('image-stage'), content: [{ type: 'text', text: 'staged' }], isError: false,
    }),
    meta: {
      format: 'agent-rp.staged-artifact',
      version: 0,
      artifact: { type: 'image', attachment },
      sourceResultSeq: sourceResult.seq,
      sourceCallId: 'image-source',
      sourceToolName: 'generate_image',
      caption: '钟楼外的雨夜。',
    } as unknown as JsonValue,
  }, { surfaceOp: 'append', sourceEventSeqs: [stageCall.seq] })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const settlementEvent = settle(session, turnPlan, 1)
  const presentation = compileInitialSessionRoleplayTurnPresentation({
    session, settlementEvent, plans: [{ step: 1, plan: turnPlan }],
  })

  assert.deepEqual(presentation.present.artifacts, [{
    type: 'image',
    artifactId: String(attachment.attachmentId),
    attachment,
    sourceResultSeq: sourceResult.seq,
    sourceCallId: 'image-source',
    sourceToolName: 'generate_image',
    caption: '钟楼外的雨夜。',
  }])
  assert.equal(presentation.selectedReply?.surfaceSeq, reply.seq)
})

test('binds Thetail-compatible automatic publication artifacts to the settled reply', () => {
  const session = Session.create(SessionId('presentation-publish-compat'))
  session.append('turn/start', { turn: 1 })
  const turnPlan = plan(session)
  const attachment: ImageAttachmentRef = {
    attachmentId: AttachmentId('sha256:presentation-publish-compat'),
    mediaType: 'image/png',
    bytes: 68,
    width: 1,
    height: 1,
  }
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{
        type: 'tool-call', id: ToolCallId('image-publish'), name: 'publish_roleplay_image', arguments: '{}',
      }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const publishCall = session.append('tool/call', {
    turn: 1, step: 1, callId: ToolCallId('image-publish'), name: 'publish_roleplay_image', arguments: '{}',
  })
  const publishResult = session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId('image-publish'), content: [{ type: 'text', text: 'published' }], isError: false,
    }),
    meta: {
      format: 'dsh.tool-artifacts',
      version: 0,
      artifacts: [{ type: 'image', attachment }],
      data: {
        format: 'agent-rp.artifact-stage-intent',
        version: 0,
        caption: '钟楼外的雨夜。',
      },
    } as unknown as JsonValue,
  }, { surfaceOp: 'append', sourceEventSeqs: [publishCall.seq] })
  const reply = appendReply(session, 1, '雨还没有停。')
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const settlementEvent = settle(session, turnPlan, 1)
  const presentation = compileInitialSessionRoleplayTurnPresentation({
    session, settlementEvent, plans: [{ step: 1, plan: turnPlan }],
  })

  assert.deepEqual(presentation.present.artifacts, [{
    type: 'image',
    artifactId: String(attachment.attachmentId),
    attachment,
    sourceResultSeq: publishResult.seq,
    sourceCallId: 'image-publish',
    sourceToolName: 'publish_roleplay_image',
    caption: '钟楼外的雨夜。',
  }])
  assert.equal(presentation.selectedReply?.surfaceSeq, reply.seq)
})

test('records a blocked turn without inventing a selected reply', () => {
  const session = Session.create(SessionId('presentation-no-reply'))
  const turnPlan = plan(session)
  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id), turn: 1, result: 'blocked',
    plans: [{ step: 1, plan: turnPlan }], events: session.events, after: runtime(),
    contributions: [{ moduleId: 'adapter:tavern-helper', outcome: 'deferred' }],
  })
  const settlementEvent = appendRoleplayTurnSettlement(session, settlement)
  const presentation = compileInitialSessionRoleplayTurnPresentation({
    session, settlementEvent, plans: [{ step: 1, plan: turnPlan }],
  })

  assert.equal(presentation.selectedReply, undefined)
  assert.equal(presentation.current, false)
  assert.equal(roleplayPresentedState(presentation, 'state:tavern-helper')?.status, 'absent')
  assert.deepEqual(presentation.present.modules, [
    { moduleId: 'roleplay:reply-versions', outcome: 'idle', changes: 0 },
    { moduleId: 'adapter:tavern-helper', outcome: 'idle', changes: 0 },
  ])
})

test('attaches a late Tavern mutation to its causal reply after a later reply exists', () => {
  const session = Session.create(SessionId('presentation-late-tavern'))
  const initialTavern = tavernState()
  appendTavernHelperState(session, initialTavern)
  const turnPlan = plan(session, [{ id: 'state:tavern-helper', owner: 'session', revision: 0 }])
  const firstReply = appendReply(session, 1, '旧回复')
  const settlementEvent = settle(session, turnPlan, 1)
  appendRoleplayTurnPresentation(session, compileInitialSessionRoleplayTurnPresentation({
    session, settlementEvent, plans: [{ step: 1, plan: turnPlan }],
  }))
  appendReply(session, 2, '更新的回复')
  const cause = { format: 0, sessionId: String(session.id), replySeq: firstReply.seq } as const
  const mutation = parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, scope: 'message', variables: { stat_data: { trust: 4 } }, cause,
  }))
  validateTavernMutationCause({ session } as never, mutation.cause)
  const mutated = applyTavernHelperMutation(initialTavern, mutation)
  const result = appendTavernHelperStateAttachment(session, mutated, cause, false)
  const resultEvent = session.events[result.eventSeq]
  assert.equal(resultEvent?.type, 'agent-rp/tavern-state-attachment')
  if (resultEvent?.type !== 'agent-rp/tavern-state-attachment') throw new Error('missing attachment fixture')
  const attached = compileSessionRoleplayTurnPresentationUpdate(session, resultEvent)

  assert.notEqual(attached, undefined)
  assert.equal(attached?.selectedReply?.sourceSeq, firstReply.seq)
  assert.equal(attached?.settlementSeq, settlementEvent.seq)
  assert.equal(attached?.current, false)
  assert.deepEqual(attached?.state, [
    { id: 'state:tavern-helper', status: 'attached', eventSeq: resultEvent.seq },
    { id: 'state:mvu', status: 'attached', eventSeq: resultEvent.seq },
  ])
  assert.deepEqual(mutated.lastMutation?.cause, cause)
  assert.equal(readTavernHelperState(session.events)?.revision, 0)
  let projected = agentRpProjectionDefinition.init(session.header)
  for (const event of session.events) projected = agentRpProjectionDefinition.apply(projected, event)
  assert.equal(agentRpProjectionDefinition.wire.view(projected).tavern?.revision, 0)
  assert.throws(() => validateTavernMutationCause({ session } as never, {
    ...cause, sessionId: 'another-session',
  }), /another Session/u)
})

test('reply-version selection produces the current unified presentation', () => {
  const session = Session.create(SessionId('presentation-version'))
  const turnPlan = plan(session)
  const original = appendReply(session, 1, '第一版')
  const settlementEvent = settle(session, turnPlan, 1, false)
  appendRoleplayTurnPresentation(session, compileInitialSessionRoleplayTurnPresentation({
    session, settlementEvent, plans: [{ step: 1, plan: turnPlan }],
  }))
  const alternative = appendReply(session, 2, '第二版')
  const surface = session.append('assistant/message', {
    turn: 2,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: '第二版' }],
    }),
  }, {
    surfaceOp: { op: 'replace', start: original.seq, end: alternative.seq },
    sourceEventSeqs: [original.seq, alternative.seq],
  })
  const groupId = '00000000-0000-4000-8000-000000000183'
  const resultEvent = session.append('command/done', {
    commandId: CommandId('presentation-version'),
    kind: 'success',
    text: encodeGenerationState({
      format: 0,
      groupId,
      operation: 'regenerate',
      originSeq: original.seq,
      anchorSeq: original.seq,
      assistantSeqs: [original.seq, alternative.seq],
      versions: [{ seq: original.seq, text: '第一版' }, { seq: alternative.seq, text: '第二版' }],
      selectedVersionSeq: alternative.seq,
      surfaceSeq: surface.seq,
    }),
  })
  const presentation = compileSessionRoleplayTurnPresentationUpdate(session, resultEvent)
  assert.notEqual(presentation, undefined)
  assert.deepEqual(presentation?.selectedReply, {
    sourceSeq: alternative.seq,
    surfaceSeq: surface.seq,
    messageId: String(surface.data.message.id),
  })
  assert.deepEqual(presentation?.version, {
    groupId, anchorSeq: original.seq, selectedVersionSeq: alternative.seq,
  })
  assert.equal(presentation?.current, true)
})

test('reply versions restore branch-local state and artifacts together after replay', async () => {
  const session = Session.create(SessionId('presentation-version-attachment'))
  const originalBase = applyTavernHelperMutation(tavernState(), {
    format: 0, scope: 'chat', variables: { marker: 'original-base' },
  })
  const originalBaseEvent = appendTavernHelperState(session, originalBase)
  const turnPlan = plan(session, [{
    id: 'state:tavern-helper', owner: 'session', revision: originalBase.revision,
  }])
  const originalArtifact = appendAutoStagedArtifact(session, 1, 'branch-original')
  const original = appendReply(session, 1, '第一版')
  const settlementEvent = settle(session, turnPlan, 1)
  appendRoleplayTurnPresentation(session, compileInitialSessionRoleplayTurnPresentation({
    session, settlementEvent, plans: [{ step: 1, plan: turnPlan }],
  }))
  const alternativeArtifact = appendAutoStagedArtifact(session, 2, 'branch-alternative')
  const alternative = appendReply(session, 2, '第二版')
  const surface = session.append('assistant/message', {
    turn: 2,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: '第二版' }],
    }),
  }, {
    surfaceOp: { op: 'replace', start: original.seq, end: alternative.seq },
    sourceEventSeqs: session.surface.nodes.slice(session.surface.nodes.indexOf(original.seq)),
  })
  const alternativeState = applyTavernHelperMutation(originalBase, {
    format: 0, scope: 'chat', variables: { marker: 'alternative' },
  })
  const alternativeStateEvent = appendTavernHelperState(session, alternativeState)
  const groupId = '00000000-0000-4000-8000-000000000184'
  const generationEvent = session.append('command/done', {
    commandId: CommandId('presentation-version-active'),
    kind: 'success',
    text: encodeGenerationState({
      format: 0, groupId, operation: 'regenerate', originSeq: original.seq, anchorSeq: original.seq,
      assistantSeqs: [original.seq, alternative.seq],
      versions: [
        {
          seq: original.seq, text: '第一版', artifactReplySeqs: [original.seq],
          tavernStateSeq: originalBaseEvent.eventSeq,
        },
        {
          seq: alternative.seq, text: '第二版', artifactReplySeqs: [alternative.seq],
          tavernStateSeq: alternativeStateEvent.eventSeq,
        },
      ],
      selectedVersionSeq: alternative.seq,
      surfaceSeq: surface.seq,
    }),
  })
  const versionPresentation = compileSessionRoleplayTurnPresentationUpdate(session, generationEvent)
  if (versionPresentation === undefined) throw new Error('missing version presentation fixture')
  appendRoleplayTurnPresentation(session, versionPresentation)
  assert.deepEqual(versionPresentation.present.artifacts?.map(artifact => artifact.artifactId), [
    String(alternativeArtifact.attachment.attachmentId),
  ])

  const cause = { format: 0, sessionId: String(session.id), replySeq: original.seq } as const
  const originalLate = applyTavernHelperMutation(originalBase, {
    format: 0, scope: 'chat', variables: { marker: 'original-late' }, cause,
  })
  const attachment = appendTavernHelperStateAttachment(session, originalLate, cause, false)
  const attachmentEvent = session.events[attachment.eventSeq]
  if (attachmentEvent?.type !== 'agent-rp/tavern-state-attachment') throw new Error('missing attachment fixture')
  const attachmentPresentation = compileSessionRoleplayTurnPresentationUpdate(session, attachmentEvent)
  if (attachmentPresentation === undefined) throw new Error('missing attachment presentation fixture')
  appendRoleplayTurnPresentation(session, attachmentPresentation)

  const originalResult = await executeGenerationCommand({
    agent: { session } as never,
    rawInput: JSON.stringify({ operation: 'select', replySeq: original.seq, versionIndex: 0 }),
    signal: new AbortController().signal,
  })
  const originalResultEvent = session.append('command/done', {
    commandId: CommandId('presentation-version-select-original'), kind: 'success', text: originalResult.text,
  })
  const originalPresentation = compileSessionRoleplayTurnPresentationUpdate(session, originalResultEvent)
  if (originalPresentation === undefined) throw new Error('missing original branch presentation fixture')
  appendRoleplayTurnPresentation(session, originalPresentation)
  const selected = decodeGenerationState(originalResult.text)
  assert.equal(selected?.selectedVersionSeq, original.seq)
  assert.equal(selected?.versions[0]?.tavernStateSeq, attachment.eventSeq)
  assert.equal(readTavernHelperState(session.events)?.scopes.chat.marker, 'original-late')
  assert.deepEqual(originalPresentation.present.artifacts?.map(artifact => artifact.artifactId), [
    String(originalArtifact.attachment.attachmentId),
  ])

  const alternativeResult = await executeGenerationCommand({
    agent: { session } as never,
    rawInput: JSON.stringify({ operation: 'select', replySeq: original.seq, versionIndex: 1 }),
    signal: new AbortController().signal,
  })
  const alternativeResultEvent = session.append('command/done', {
    commandId: CommandId('presentation-version-select-alternative'), kind: 'success', text: alternativeResult.text,
  })
  const alternativePresentation = compileSessionRoleplayTurnPresentationUpdate(session, alternativeResultEvent)
  if (alternativePresentation === undefined) throw new Error('missing alternative branch presentation fixture')
  appendRoleplayTurnPresentation(session, alternativePresentation)
  assert.equal(readTavernHelperState(session.events)?.scopes.chat.marker, 'alternative')
  assert.deepEqual(alternativePresentation.present.artifacts?.map(artifact => artifact.artifactId), [
    String(alternativeArtifact.attachment.attachmentId),
  ])

  const reopened = Session.create(session.id, session.events)
  assert.equal(readTavernHelperState(reopened.events)?.scopes.chat.marker, 'alternative')
  assert.deepEqual(readCurrentRoleplayTurnPresentation(reopened.events)?.present.artifacts
    ?.map(artifact => artifact.artifactId), [String(alternativeArtifact.attachment.attachmentId)])
})

test('rejects malformed or non-assistant mutation causes', () => {
  assert.throws(() => parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, scope: 'chat', variables: {},
    cause: { format: 0, sessionId: 'session', replySeq: -1 },
  })), /cause is invalid/u)
  const session = Session.create(SessionId('presentation-invalid-cause'))
  assert.throws(() => validateTavernMutationCause({ session } as never, {
    format: 0, sessionId: String(session.id), replySeq: 42,
  }), /does not reference an assistant reply/u)
})

test('presents arbitrary runtime modules without a source-specific core branch', () => {
  const session = Session.create(SessionId('presentation-generic-module'))
  const state = [{ id: 'state:clock', owner: 'session' as const, revision: 4 }]
  const genericRuntime: RoleplayRuntimeSnapshot = {
    ...runtime(state),
    state,
    modules: [{
      id: 'roleplay:clock', source: 'native', phases: ['settle', 'present'], stateIds: ['state:clock'],
    }],
  }
  const genericPlan: RoleplayTurnPlan = { ...plan(session, state), runtime: genericRuntime }
  const reply = appendReply(session, 1, '午夜钟声响起。')
  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id), turn: 1, result: 'completed',
    plans: [{ step: 1, plan: genericPlan }], events: session.events, after: genericRuntime,
  })
  const settlementEvent = appendRoleplayTurnSettlement(session, settlement)
  const initial = compileInitialRoleplayTurnPresentation({
    session,
    settlementEvent,
    plans: [{ step: 1, plan: genericPlan }],
    contributions: [{
      module: { moduleId: 'roleplay:clock', outcome: 'pending', changes: 0 },
      states: [{ id: 'state:clock', status: 'pending', eventSeq: settlementEvent.seq }],
    }],
  })
  appendRoleplayTurnPresentation(session, initial)
  const updateEvent = session.append('command/done', {
    commandId: CommandId('presentation-generic-update'), kind: 'success', text: 'clock settled',
  })
  const updated = compileRoleplayModulePresentationUpdate({
    session,
    eventSeq: updateEvent.seq,
    moduleId: 'roleplay:clock',
    replySeq: reply.seq,
    contributions: [{
      module: { moduleId: 'roleplay:clock', outcome: 'attached', changes: 1 },
      states: [{ id: 'state:clock', status: 'attached', eventSeq: updateEvent.seq }],
    }],
  })

  assert.deepEqual(initial.state, [{ id: 'state:clock', status: 'pending', eventSeq: settlementEvent.seq }])
  assert.deepEqual(updated?.trigger, {
    kind: 'module-update', eventSeq: updateEvent.seq, moduleId: 'roleplay:clock',
  })
  assert.deepEqual(updated?.present.modules, [{
    moduleId: 'roleplay:clock', outcome: 'attached', changes: 1,
  }])
  assert.deepEqual(updated?.state, [{ id: 'state:clock', status: 'attached', eventSeq: updateEvent.seq }])
})

test('normalizes earlier adapter-shaped presentation events on read', () => {
  const legacy = {
    format: 0,
    sessionId: 'presentation-legacy',
    turn: 1,
    settlementSeq: 4,
    trigger: { kind: 'tavern-mutation', eventSeq: 9 },
    current: true,
    selectedReply: { sourceSeq: 2, surfaceSeq: 2, messageId: 'legacy-reply' },
    state: { mvuStateSeq: 9, tavernStateSeq: 9, tavernStatus: 'attached' },
    present: { modules: [{ moduleId: 'adapter:tavern-helper', outcome: 'attached', changes: 1 }] },
  } as unknown as Parameters<typeof normalizeRoleplayTurnPresentation>[0]

  const normalized = normalizeRoleplayTurnPresentation(legacy)
  assert.deepEqual(normalized.trigger, {
    kind: 'module-update', eventSeq: 9, moduleId: 'adapter:tavern-helper',
  })
  assert.deepEqual(normalized.state, [
    { id: 'state:mvu', status: 'attached', eventSeq: 9 },
    { id: 'state:tavern-helper', status: 'attached', eventSeq: 9 },
  ])
})
