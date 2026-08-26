import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { decodeGenerationState, encodeGenerationState, executeGenerationCommand } from '../src/generation.ts'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import { createCharacterCardSessionSeed } from '../src/import/character-card-seed.ts'
import { readCurrentSessionMvuState } from '../src/mvu.ts'
import { prepareRoleplayTurn } from '../src/roleplay-turn-plan.ts'
import { bindRoleplayExternalContext } from '../src/roleplay-turn-context.ts'
import {
  applyTavernHelperMutation,
  encodeTavernHelperState,
  encodeTavernHelperStateAttachment,
  initializeTavernHelperState,
  readTavernHelperState,
  type TavernHelperState,
} from '../src/tavern-helper.ts'
import {
  AGENT_RP_SESSION_EVENT_TYPES,
  appendAgentRpSessionEvent,
  supportsAgentRpSessionEvents,
} from '../src/session-event-compat.ts'
import { LEGACY_AGENT_RP_EVENT_TYPES } from '../src/session-repair.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import {
  appendSessionRoleplayTurnPlan,
  replaySessionRoleplayTurnPlan,
} from '../src/session-roleplay-turn-plan.ts'
import { readRoleplayStates } from '../src/roleplay-state.ts'
import { executeRoleplayStateCommand } from '../src/roleplay-state-command.ts'

const state = {
  format: 0 as const,
  id: 'state:fixture',
  revision: 1,
  ownerModuleId: 'roleplay:fixture',
  writerModuleId: 'roleplay:fixture',
  value: { safe: true },
}

function appendAssistant(session: Session, turn: number, text: string) {
  return session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text }], source: { provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
}

function publishedTavernState(
  session: Session,
  replySeq: number,
  marker: string,
): TavernHelperState {
  const initial = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: [], tavernHelperVariables: {}, tavernHelperScripts: [],
  }, 'published-generation-card')
  return applyTavernHelperMutation(initial, {
    format: 0,
    scope: 'chat',
    variables: { marker },
    cause: { format: 0, sessionId: String(session.id), replySeq },
  })
}

function appendPublishedTavernAttachment(
  session: Session,
  commandId: CommandId,
  replySeq: number,
  state: TavernHelperState,
  active: boolean,
) {
  const cause = { format: 0 as const, sessionId: String(session.id), replySeq }
  session.append('command/run', {
    commandId, name: 'rp-tavern-variables', args: '{}', source: { kind: 'user' },
  })
  return session.append('command/done', {
    commandId,
    kind: 'success',
    text: encodeTavernHelperStateAttachment({ format: 0, cause, active, state }),
  })
}

function publishedMvuSession(id: string) {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: '变量角色', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [],
      creator: 'fixture', character_version: '1.0', extensions: {},
      character_book: { recursive_scanning: false, extensions: {}, entries: [{
        id: 1, comment: '[initvar]', keys: [], content: '角色:\n  等级: 1', enabled: false,
        insertion_order: 1, constant: false, extensions: {},
      }] },
    },
  }))
  const seed = createCharacterCardSessionSeed(card, {
    kind: 'file', attachmentId: AttachmentId(`sha256:${id}`), bytes: 1,
    name: 'mvu.json', mediaType: 'application/json',
  }, 0, '')
  return { card, session: Session.create(SessionId(id), seed) }
}

test('refuses an unsafe fallback without changing a published-host Session', () => {
  const session = Session.create(SessionId('published-host-without-plugin-events'))

  assert.equal(supportsAgentRpSessionEvents(session), false)
  assert.throws(() => appendAgentRpSessionEvent(session, 'agent-rp/state', state), /已拒绝写入/u)
  assert.equal(session.seq, 0)
  assert.deepEqual(session.events, [])
})

test('keeps the repair vocabulary identical to the writable private vocabulary', () => {
  assert.deepEqual([...LEGACY_AGENT_RP_EVENT_TYPES], [...AGENT_RP_SESSION_EVENT_TYPES])
})

test('persists a player state revision through command/done on the published Host', () => {
  const session = Session.create(SessionId('published-host-command-state'))
  const agent = { session } as Agent
  const commandId = CommandId('published-host-state-command')
  const rawInput = JSON.stringify({
    format: 0, operation: 'set', id: 'state:scene', expectedRevision: 0, value: { weather: '雨' },
  })
  session.append('command/run', {
    commandId, name: 'rp-state', args: rawInput, source: { kind: 'user' },
  })

  const result = executeRoleplayStateCommand({ commandId, agent, rawInput })
  assert.equal(result.sourceEventSeq, undefined)
  assert.match(result.text ?? '', /^agent-rp-state-v0:/u)
  session.append('command/done', { commandId, ...result })

  assert.equal(session.events.some(event => event.type === 'agent-rp/state'), false)
  assert.deepEqual(readRoleplayStates(session.events), [{
    format: 0,
    id: 'state:scene',
    revision: 1,
    ownerModuleId: 'roleplay:user',
    writerModuleId: 'roleplay:user',
    sourceEventSeq: 0,
    value: { weather: '雨' },
    eventSeq: 1,
  }])
  const reopened = Session.create(SessionId('published-host-command-state-replay'), session.events)
  assert.deepEqual(readRoleplayStates(reopened.events), readRoleplayStates(session.events))
})

test('continues and switches MVU reply checkpoints through command/done on the published Host', async () => {
  const { card, session } = publishedMvuSession('published-host-mvu-versions')
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '提升等级。' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const original = appendAssistant(
    session,
    1,
    '第一段<UpdateVariable><JSONPatch>[{"op":"delta","path":"/角色/等级","value":1}]</JSONPatch></UpdateVariable>',
  )
  const agent = {
    session,
    status: 'idle',
    inbox: { hasPending: false },
    followup(message: ReturnType<typeof createUserMessage>) {
      session.append('user/message', message, { surfaceOp: 'append' })
      appendAssistant(
        session,
        2,
        '第二段<UpdateVariable><JSONPatch>[{"op":"delta","path":"/角色/等级","value":2}]</JSONPatch></UpdateVariable>',
      )
    },
    whenIdle: async () => {},
    cancel: () => {},
  } as unknown as Agent

  const continueId = CommandId('published-host-mvu-continue')
  session.append('command/run', { commandId: continueId, name: 'rp-generation', source: { kind: 'user' } })
  const continued = await executeGenerationCommand({
    agent,
    rawInput: JSON.stringify({ operation: 'continue', replySeq: original.seq }),
    signal: new AbortController().signal,
  })
  session.append('command/done', { commandId: continueId, ...continued })
  assert.deepEqual(decodeGenerationState(continued.text)?.mvu, {
    statData: { 角色: { 等级: 4 } }, updateCount: 2,
  })
  assert.equal(session.events.some(event => event.type === 'agent-rp/mvu-state'), false)
  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 4 } }, updateCount: 2,
  })

  const selectId = CommandId('published-host-mvu-select-original')
  session.append('command/run', { commandId: selectId, name: 'rp-generation', source: { kind: 'user' } })
  const selected = await executeGenerationCommand({
    agent,
    rawInput: JSON.stringify({ operation: 'select', replySeq: original.seq, versionIndex: 0 }),
    signal: new AbortController().signal,
  })
  session.append('command/done', { commandId: selectId, ...selected })
  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 2 } }, updateCount: 1,
  })

  const reopened = Session.create(session.id, session.events)
  assert.deepEqual(readCurrentSessionMvuState(card, reopened), readCurrentSessionMvuState(card, session))
})

test('switches Tavern reply branches through command/done on the published Host', async () => {
  const session = Session.create(SessionId('published-host-tavern-versions'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '选择一条路线。' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const original = appendAssistant(session, 1, '第一条路线')
  const originalState = publishedTavernState(session, original.seq, 'original')
  const originalAttachment = appendPublishedTavernAttachment(
    session, CommandId('published-tavern-original'), original.seq, originalState, false,
  )
  const alternative = appendAssistant(session, 2, '第二条路线')
  const alternativeState = publishedTavernState(session, alternative.seq, 'alternative')
  const alternativeAttachment = appendPublishedTavernAttachment(
    session, CommandId('published-tavern-alternative'), alternative.seq, alternativeState, false,
  )
  const surface = session.append('assistant/message', {
    turn: alternative.data.turn,
    step: alternative.data.step,
    message: alternative.data.message,
  }, {
    surfaceOp: { op: 'replace', start: original.seq, end: alternative.seq },
    sourceEventSeqs: [original.seq, alternative.seq],
  })
  const groupId = '00000000-0000-4000-8000-000000000201'
  const seedId = CommandId('published-tavern-generation-seed')
  session.append('command/run', { commandId: seedId, name: 'rp-generation', source: { kind: 'user' } })
  session.append('command/done', {
    commandId: seedId,
    kind: 'success',
    text: encodeGenerationState({
      format: 0,
      groupId,
      operation: 'regenerate',
      originSeq: original.seq,
      anchorSeq: original.seq,
      assistantSeqs: [original.seq, alternative.seq],
      versions: [
        { seq: original.seq, text: '第一条路线', tavernStateSeq: originalAttachment.seq },
        { seq: alternative.seq, text: '第二条路线', tavernStateSeq: alternativeAttachment.seq },
      ],
      selectedVersionSeq: alternative.seq,
      surfaceSeq: surface.seq,
      tavern: alternativeState,
    }),
  })
  assert.deepEqual(readTavernHelperState(session.events)?.scopes.chat, { marker: 'alternative' })

  const agent = { session } as Agent
  const originalSelectId = CommandId('published-tavern-select-original')
  session.append('command/run', {
    commandId: originalSelectId, name: 'rp-generation', source: { kind: 'user' },
  })
  const selectedOriginal = await executeGenerationCommand({
    agent,
    rawInput: JSON.stringify({ operation: 'select', replySeq: original.seq, versionIndex: 0 }),
    signal: new AbortController().signal,
  })
  session.append('command/done', { commandId: originalSelectId, ...selectedOriginal })
  assert.equal(session.events.some(event => event.type === 'agent-rp/tavern-state'), false)
  assert.deepEqual(readTavernHelperState(session.events)?.scopes.chat, { marker: 'original' })
  assert.deepEqual(readTavernHelperState(Session.create(session.id, session.events).events)?.scopes.chat,
    { marker: 'original' })

  const alternativeSelectId = CommandId('published-tavern-select-alternative')
  session.append('command/run', {
    commandId: alternativeSelectId, name: 'rp-generation', source: { kind: 'user' },
  })
  const selectedAlternative = await executeGenerationCommand({
    agent,
    rawInput: JSON.stringify({ operation: 'select', replySeq: original.seq, versionIndex: 1 }),
    signal: new AbortController().signal,
  })
  session.append('command/done', { commandId: alternativeSelectId, ...selectedAlternative })
  assert.deepEqual(readTavernHelperState(session.events)?.scopes.chat, { marker: 'alternative' })
  assert.deepEqual(readTavernHelperState(Session.create(session.id, session.events).events)?.scopes.chat,
    { marker: 'alternative' })
})

test('rejects unsafe Tavern regeneration before changing a published-host Session', async () => {
  const session = Session.create(SessionId('published-host-tavern-regenerate'))
  const baseline = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: [], tavernHelperVariables: { marker: 'baseline' },
    tavernHelperScripts: [],
  }, 'published-regeneration-card')
  const stateId = CommandId('published-tavern-baseline')
  session.append('command/run', { commandId: stateId, name: 'rp-tavern-state', source: { kind: 'user' } })
  session.append('command/done', {
    commandId: stateId, kind: 'success', text: encodeTavernHelperState(baseline),
  })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '重新回答。' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const original = appendAssistant(session, 1, '保留到安全切换开始。')
  const beforeEvents = structuredClone(session.events)
  const beforeSurface = [...session.surface.nodes]
  let followedUp = false
  const agent = {
    session,
    status: 'idle',
    inbox: { hasPending: false },
    followup() { followedUp = true },
    whenIdle: async () => {},
    cancel: () => {},
  } as unknown as Agent

  await assert.rejects(executeGenerationCommand({
    agent,
    rawInput: JSON.stringify({ operation: 'regenerate', replySeq: original.seq }),
    signal: new AbortController().signal,
  }), /DSH Host 缺少安全插件事件能力/u)
  assert.equal(followedUp, false)
  assert.deepEqual(session.events, beforeEvents)
  assert.deepEqual(session.surface.nodes, beforeSurface)
})

test('writes and exactly replays a prepared turn with a compatible local DSH Host', async (t) => {
  const configuredDshRoot = process.env['DSH_SOURCE_DIR']
  const dshRoot = configuredDshRoot ?? resolve(process.cwd(), '..', 'dsh')
  const entry = resolve(dshRoot, 'packages', 'core', 'session', 'lib', 'index.js')
  if (!existsSync(entry)) {
    t.skip('local DSH session build is unavailable; set DSH_SOURCE_DIR to enable this matrix leg')
    return
  }

  const local = await import(pathToFileURL(entry).href)
  const session = local.Session.create(local.SessionId('agent-rp-new-host-write'))
  if (!supportsAgentRpSessionEvents(session as Session)) {
    if (configuredDshRoot !== undefined) {
      assert.fail(`DSH_SOURCE_DIR does not expose the replay-safe plugin-event seam: ${entry}`)
    }
    t.skip('local DSH session build predates the replay-safe plugin-event seam')
    return
  }

  const written = appendAgentRpSessionEvent(session as Session, 'agent-rp/state', state)
  assert.equal(written.ignorable, true)
  assert.equal(written.type, 'agent-rp/state')
  assert.deepEqual(written.data, state)

  const reopened = local.Session.create(
    local.SessionId('agent-rp-new-host-replay'),
    structuredClone(session.events),
  )
  assert.deepEqual(reopened.events[0], written)

  const turnSession = local.Session.create(local.SessionId('agent-rp-new-host-turn')) as Session
  turnSession.append('turn/start', { turn: 1 })
  const message = createUserMessage({
    content: [{ type: 'text', text: '这段正文只用于准备计划，不应进入收据。' }],
    source: { kind: 'user' },
  })
  const deployment = resolveConfig({ characterName: '候选 Host 兼容角色' })
  const resolved = resolveSessionRoleplayRuntime({
    session: turnSession,
    deployment,
    memoryWriteAvailable: true,
  })
  const plan = prepareRoleplayTurn({
    session: turnSession,
    pendingMessages: [message],
    deployment,
    resolved,
  })
  const staleExternal = createUserMessage({
    content: [{ type: 'text', text: '候选 Host 应覆盖的旧世界上下文。' }],
    source: {
      kind: 'plugin', plugin: 'dsh-worldbook', form: 'snapshot', channel: 'candidate-host',
      sections: [{ name: 'candidate-host', text: '候选 Host 应覆盖的旧世界上下文。' }],
    },
  })
  turnSession.append('step/start', { turn: 1, step: 1 })
  turnSession.append('user/message', message, { surfaceOp: 'append' })
  const staleExternalEvent = turnSession.append('user/message', staleExternal, { surfaceOp: 'append' })
  const external = createUserMessage({
    content: [{ type: 'text', text: '候选 Host 外部世界上下文，不应进入收据。' }],
    source: {
      kind: 'plugin', plugin: 'dsh-worldbook', form: 'snapshot', channel: 'candidate-host',
      sections: [{ name: 'candidate-host', text: '候选 Host 外部世界上下文，不应进入收据。' }],
    },
  })
  const externalEvent = turnSession.append('user/message', external, { surfaceOp: 'append' })
  const dispatchedPlan = bindRoleplayExternalContext({
    plan, events: turnSession.events, visibleMessages: turnSession.deriveMessages(), turn: 1, step: 1,
  })
  const receipt = appendSessionRoleplayTurnPlan(turnSession, 1, 1, dispatchedPlan)
  assert.equal(receipt.ignorable, true)
  assert.equal(receipt.type, 'agent-rp/turn-plan')
  const candidateContextReads = receipt.data.reference.receipt?.recall?.contextReads ?? []
  assert.equal(candidateContextReads.some(read => read.eventSeq === externalEvent.seq), true)
  const supportsSnapshotChannels = (turnSession.constructor as {
    readonly contextSnapshotChannels?: unknown
  }).contextSnapshotChannels === 1
  assert.equal(candidateContextReads.some(read => read.eventSeq === staleExternalEvent.seq), !supportsSnapshotChannels)
  assert.doesNotMatch(JSON.stringify(receipt), /这段正文|候选 Host 兼容角色|外部世界上下文/u)

  const turnReopened = local.Session.create(
    local.SessionId('agent-rp-new-host-turn'),
    structuredClone(turnSession.events),
  ) as Session
  const reopenedReceipt = turnReopened.events[receipt.seq]
  assert.equal(reopenedReceipt?.type, 'agent-rp/turn-plan')
  if (reopenedReceipt?.type !== 'agent-rp/turn-plan') throw new Error('turn receipt was not replayed')
  assert.deepEqual(replaySessionRoleplayTurnPlan({
    session: turnReopened,
    record: reopenedReceipt,
    deployment,
  }), dispatchedPlan)
  assert.throws(() => replaySessionRoleplayTurnPlan({
    session: turnReopened,
    record: reopenedReceipt,
    deployment: resolveConfig({ characterName: '漂移后的候选角色' }),
  }), /content digest/u)
})
