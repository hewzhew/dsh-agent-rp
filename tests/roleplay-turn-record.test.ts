import assert from 'node:assert/strict'
import test from 'node:test'
import { CommandId } from '@deepseek-ai/dsh-commands'
import {
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import {
  appendRoleplayTurnPresentation,
  compileInitialRoleplayTurnPresentation,
  compileRoleplayReplyVersionPresentation,
} from '../src/roleplay-turn-presentation.ts'
import {
  readLatestRoleplayTurnRecord,
  readRoleplayTurnRecord,
  readRoleplayTurnRecords,
} from '../src/roleplay-turn-record.ts'
import {
  appendRoleplayTurnSettlement,
  compileRoleplayTurnSettlement,
} from '../src/roleplay-turn-settlement.ts'
import { prepareRoleplayTurn } from '../src/roleplay-turn-plan.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import { appendSessionRoleplayTurnPlan } from '../src/session-roleplay-turn-plan.ts'

const deployment = resolveConfig({ characterName: '统一回合记录角色' })

function appendModelMessage(
  session: Session,
  turn: number,
  step: number,
  content: Parameters<typeof createAssistantMessage>[0]['content'],
) {
  return session.append('assistant/message', {
    turn,
    step,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

function completeTwoStepTurn() {
  const session = Session.create(SessionId('roleplay-turn-record'))
  const turn = 1
  const pending = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '检查环境后继续。' }],
  })
  session.append('turn/start', { turn })
  const firstRuntime = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const firstPlan = prepareRoleplayTurn({
    session, pendingMessages: [pending], deployment, resolved: firstRuntime,
  })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', pending, { surfaceOp: 'append' })
  const firstPlanEvent = appendSessionRoleplayTurnPlan(session, turn, 1, firstPlan)
  const callId = ToolCallId('turn-record-probe')
  appendModelMessage(session, turn, 1, [{
    type: 'tool-call', id: callId, name: 'inspect', arguments: '{"area":"room"}',
  }])
  const call = session.append('tool/call', {
    turn, step: 1, callId, name: 'inspect', arguments: '{"area":"room"}',
  })
  session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: '窗外正在下雨。' }],
      isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn, step: 1 })

  const secondRuntime = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const secondPlan = prepareRoleplayTurn({ session, deployment, resolved: secondRuntime })
  session.append('step/start', { turn, step: 2 })
  const secondPlanEvent = appendSessionRoleplayTurnPlan(session, turn, 2, secondPlan)
  const reply = appendModelMessage(session, turn, 2, [{ type: 'text', text: '雨声落在窗沿。' }])
  session.append('step/end', { turn, step: 2 })
  const end = session.append('turn/end', { turn, reason: { kind: 'completed' } })

  const after = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id),
    turn,
    result: 'completed',
    plans: [{ step: 1, plan: firstPlan }, { step: 2, plan: secondPlan }],
    events: session.events,
    after: after.snapshot,
  })
  const settlementEvent = appendRoleplayTurnSettlement(session, settlement)
  const presentation = compileInitialRoleplayTurnPresentation({
    session,
    settlementEvent,
    plans: [{ step: 1, plan: firstPlan }, { step: 2, plan: secondPlan }],
  })
  const presentationEvent = appendRoleplayTurnPresentation(session, presentation)
  return {
    session,
    turn,
    end,
    firstPlanEvent,
    secondPlanEvent,
    reply,
    settlementEvent,
    presentationEvent,
  }
}

test('joins prepare, recall, act, settle, and present without writing another event', () => {
  const fixture = completeTwoStepTurn()
  const beforeRead = fixture.session.events.length
  const records = readRoleplayTurnRecords(fixture.session)
  assert.equal(fixture.session.events.length, beforeRead)
  assert.equal(records.length, 1)
  const record = records[0]!
  assert.deepEqual(record.lifecycle, ['prepare', 'recall', 'act', 'settle', 'present'])
  assert.deepEqual(record.boundary, {
    startSeq: fixture.session.events.find(event => event.type === 'turn/start')?.seq,
    endSeq: fixture.end.seq,
    result: 'completed',
  })
  assert.deepEqual(record.plans.map(value => [value.step, value.eventSeq]), [
    [1, fixture.firstPlanEvent.seq],
    [2, fixture.secondPlanEvent.seq],
  ])
  assert.deepEqual(record.prepare.steps.map(value => value.step), [1, 2])
  assert.equal(record.prepare.steps.every(value => value.modules !== undefined), true)
  assert.deepEqual(record.recall.steps.map(value => value.step), [1, 2])
  assert.equal(record.recall.steps.every(value => value.modules !== undefined), true)
  assert.deepEqual(record.act?.steps.map(value => ({
    step: value.step,
    assistants: value.assistantMessages.length,
    calls: value.toolCalls.map(call => call.name),
    results: value.toolResults.map(result => result.outcome),
  })), [
    { step: 1, assistants: 1, calls: ['inspect'], results: ['succeeded'] },
    { step: 2, assistants: 1, calls: [], results: [] },
  ])
  assert.equal(record.settle?.eventSeq, fixture.settlementEvent.seq)
  assert.equal(record.settle?.reply?.eventSeq, fixture.reply.seq)
  assert.equal(record.present?.eventSeq, fixture.presentationEvent.seq)
  assert.equal(record.present?.selectedReply?.sourceSeq, fixture.reply.seq)
  assert.deepEqual(readLatestRoleplayTurnRecord(fixture.session), record)
  assert.deepEqual(readRoleplayTurnRecord(fixture.session, fixture.turn), record)
  assert.equal(readRoleplayTurnRecord(fixture.session, fixture.turn + 1), undefined)
  assert.throws(() => readRoleplayTurnRecord(fixture.session, 0), /positive integer/u)

  const reopened = Session.create(fixture.session.id, structuredClone(fixture.session.events))
  assert.deepEqual(readRoleplayTurnRecords(reopened), records)
})

test('projects a pre-dispatch plan while its turn is still open', () => {
  const session = Session.create(SessionId('roleplay-turn-record-open'))
  const pending = createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: '开放回合。' }],
  })
  const start = session.append('turn/start', { turn: 1 })
  const resolved = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [pending], deployment, resolved })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', pending, { surfaceOp: 'append' })
  const receipt = appendSessionRoleplayTurnPlan(session, 1, 1, plan)

  const record = readLatestRoleplayTurnRecord(session)
  assert.deepEqual(record?.boundary, { startSeq: start.seq })
  assert.equal(record?.plans[0]?.eventSeq, receipt.seq)
  assert.equal(record?.act, undefined)
  assert.equal(record?.settle, undefined)
  assert.equal(record?.present, undefined)
})

test('updates only present when a later reply version is selected', () => {
  const fixture = completeTwoStepTurn()
  const before = readLatestRoleplayTurnRecord(fixture.session)!
  const alternative = appendModelMessage(fixture.session, 2, 1, [{ type: 'text', text: '雨幕映亮了街灯。' }])
  const surface = fixture.session.append('assistant/message', {
    turn: 2,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: '雨幕映亮了街灯。' }],
    }),
  }, {
    surfaceOp: { op: 'replace', start: fixture.reply.seq, end: alternative.seq },
    sourceEventSeqs: [fixture.reply.seq, alternative.seq],
  })
  const trigger = fixture.session.append('command/done', {
    commandId: CommandId('turn-record-version'),
    kind: 'success',
    text: 'selected another reply',
  })
  const updated = compileRoleplayReplyVersionPresentation({
    session: fixture.session,
    eventSeq: trigger.seq,
    groupId: '00000000-0000-4000-8000-000000000215',
    anchorSeq: fixture.reply.seq,
    selectedVersionSeq: alternative.seq,
    surfaceSeq: surface.seq,
  })
  assert.notEqual(updated, undefined)
  appendRoleplayTurnPresentation(fixture.session, updated!)

  const after = readLatestRoleplayTurnRecord(fixture.session)!
  assert.deepEqual(after.plans, before.plans)
  assert.deepEqual(after.act, before.act)
  assert.deepEqual(after.settle, before.settle)
  assert.equal(after.present?.selectedReply?.sourceSeq, alternative.seq)
  assert.equal(after.present?.selectedReply?.surfaceSeq, surface.seq)
  assert.equal(after.present?.version?.selectedVersionSeq, alternative.seq)
})

test('rejects a persisted act receipt that drifted from canonical Session actions', () => {
  const fixture = completeTwoStepTurn()
  const tampered = fixture.session.events.map((event): SessionEvent => {
    if (event.type !== 'agent-rp/turn-settlement' || event.data.act === undefined) {
      return structuredClone(event)
    }
    return {
      ...structuredClone(event),
      data: {
        ...event.data,
        act: {
          steps: event.data.act.steps.map((step, stepIndex) => stepIndex !== 0 ? step : {
            ...step,
            assistantMessages: step.assistantMessages.map((message, messageIndex) => messageIndex !== 0
              ? message
              : { ...message, eventSeq: message.eventSeq + 1 }),
          }),
        },
      },
    }
  })
  assert.equal(readRoleplayTurnRecord({ id: fixture.session.id, events: tampered }, 2), undefined)
  assert.throws(() => readRoleplayTurnRecords({ id: fixture.session.id, events: tampered }), /act receipt drifted/u)
  assert.throws(() => readRoleplayTurnRecord({ id: fixture.session.id, events: tampered }, 1), /act receipt drifted/u)
})

test('normalizes pre-audit act receipts whose steps omit modelCalls', () => {
  const fixture = completeTwoStepTurn()
  const legacy = fixture.session.events.map((event): SessionEvent => {
    if (event.type !== 'agent-rp/turn-settlement' || event.data.act === undefined) {
      return structuredClone(event)
    }
    return {
      ...structuredClone(event),
      data: {
        ...event.data,
        act: {
          steps: event.data.act.steps.map(step => {
            const { modelCalls: _modelCalls, ...legacyStep } = step
            return legacyStep
          }),
        } as unknown as typeof event.data.act,
      },
    }
  })

  const records = readRoleplayTurnRecords({ id: fixture.session.id, events: legacy })
  assert.equal(records.length, 1)
  assert.deepEqual(records.at(-1)?.act?.steps.map(step => step.modelCalls), [[], []])
})
