import assert from 'node:assert/strict'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { ToolCallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionSeq } from '@deepseek-ai/dsh-session'
import { validateJsonSchemaValue, valueSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { MEMORY_VALUE_SCHEMA } from '../src/index.ts'
import {
  appendAgentRpMemorySeed,
  parseAgentRpMemoryCommandRequest,
  prepareAgentRpMemory,
  requestsPersistentMemory,
  type AgentRpMemoryRecord,
  readAgentRpMemoryHistory,
} from '../src/memory.ts'
import { executeAgentRpMemoryCommand } from '../src/memory-command.ts'
import { renderMemoryContext } from '../src/prompt.ts'
import { sessionEvents } from '../src/session-events.ts'

test('opens model memory only for explicit persistent user intent', () => {
  const message = (text: string) => createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text }],
  })
  assert.equal(requestsPersistentMemory(message('请记住我喝咖啡不加糖。')), true)
  assert.equal(requestsPersistentMemory(message('下次请叫我小满。')), true)
  assert.equal(requestsPersistentMemory(message('我点点头，陪她去保健室。')), false)
  assert.equal(requestsPersistentMemory(createUserMessage({
    source: { kind: 'plugin', plugin: 'test', form: 'notice', summary: '内部通知' },
    content: [{ type: 'text', text: '请记住这条内部通知。' }],
  })), false)
})

function appendRememberCall(session: Session, callId: string, args: object): SessionSeq {
  return session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId(callId),
    name: 'remember',
    arguments: JSON.stringify(args),
  }).seq
}

function appendRememberResult(
  session: Session,
  callId: string,
  record: AgentRpMemoryRecord,
  callSeq: SessionSeq,
): void {
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId(callId),
      content: [{ type: 'text', text: JSON.stringify(record) }],
      isError: false,
    }),
  }, {
    surfaceOp: 'append',
    sourceEventSeqs: [callSeq],
  })
}

function runMemoryCommand(agent: Agent, rawInput: string, sequence: number, recordInput = false): void {
  const commandId = CommandId(`memory-command-${sequence}`)
  agent.session.append('command/run', {
    commandId,
    name: 'rp-memory',
    ...(recordInput ? { args: rawInput } : {}),
    source: { kind: 'user' },
  })
  const result = executeAgentRpMemoryCommand({ commandId, agent, rawInput })
  agent.session.append('command/done', { commandId, ...result })
}

test('persists one normalized memory and exposes it to the next prompt snapshot', () => {
  const session = Session.create(SessionId('agent-rp-memory'))
  const input = {
    kind: 'preference',
    subject: '  饮品  ',
    text: '  用户喝咖啡时不加糖  ',
  } as const
  const sourceEventSeq = appendRememberCall(session, 'remember-1', input)
  const record = prepareAgentRpMemory(session, 'remember-1', input)
  appendRememberResult(session, 'remember-1', record, sourceEventSeq)

  assert.deepEqual(record, {
    version: 0,
    id: `memory-${sourceEventSeq}`,
    kind: 'preference',
    subject: '饮品',
    text: '用户喝咖啡时不加糖',
    sourceEventSeq,
  })
  assert.deepEqual(validateJsonSchemaValue(valueSchemaSpecToJsonSchema(MEMORY_VALUE_SCHEMA), record), [])
  assert.deepEqual(readAgentRpMemoryHistory(sessionEvents(session)).active, [record])
  assert.match(renderMemoryContext(sessionEvents(session)), /用户喝咖啡时不加糖/u)
  assert.match(renderMemoryContext(sessionEvents(session)), new RegExp(`\\[memory-${sourceEventSeq} \\| preference \\|`, 'u'))
  assert.match(renderMemoryContext(sessionEvents(session)), /持久记忆只读/u)
  assert.doesNotMatch(renderMemoryContext(sessionEvents(session)), /remember|supersedes/u)
  assert.match(renderMemoryContext(sessionEvents(session), true), /调用 remember/u)
  assert.match(renderMemoryContext([], true), /跨轮保留意图/u)
  assert.doesNotMatch(renderMemoryContext(sessionEvents(session)), /来源事件/u)
})

test('keeps correction history while only the replacement remains active', () => {
  const session = Session.create(SessionId('agent-rp-correction'))
  const oldInput = {
    kind: 'fact',
    subject: '住处',
    text: '用户住在杭州',
  } as const
  const oldCallSeq = appendRememberCall(session, 'remember-1', oldInput)
  const old = prepareAgentRpMemory(session, 'remember-1', oldInput)
  appendRememberResult(session, 'remember-1', old, oldCallSeq)
  const replacementInput = {
    kind: 'fact',
    subject: '住处',
    text: '用户已经搬到苏州',
    supersedes: old.id,
  } as const
  const replacementCallSeq = appendRememberCall(session, 'remember-2', replacementInput)
  const replacement = prepareAgentRpMemory(session, 'remember-2', replacementInput)
  appendRememberResult(session, 'remember-2', replacement, replacementCallSeq)

  const history = readAgentRpMemoryHistory(sessionEvents(session))
  assert.deepEqual(history.all, [old, replacement])
  assert.deepEqual(history.active, [replacement])
  assert.doesNotMatch(renderMemoryContext(sessionEvents(session)), /杭州/u)
  assert.match(renderMemoryContext(sessionEvents(session)), /苏州/u)
})

test('rejects a duplicate active topic unless the existing record is superseded', () => {
  const session = Session.create(SessionId('agent-rp-duplicate-topic'))
  const firstInput = { kind: 'preference', subject: '红茶', text: '用户喝红茶不加柠檬' } as const
  const firstCallSeq = appendRememberCall(session, 'remember-1', firstInput)
  const first = prepareAgentRpMemory(session, 'remember-1', firstInput)
  appendRememberResult(session, 'remember-1', first, firstCallSeq)

  const duplicate = { kind: 'preference', subject: ' 红茶 ', text: '用户喜欢热红茶' } as const
  appendRememberCall(session, 'remember-2', duplicate)
  assert.throws(() => prepareAgentRpMemory(session, 'remember-2', duplicate), /use supersedes/u)

  const replacement = { ...duplicate, supersedes: first.id }
  appendRememberCall(session, 'remember-3', replacement)
  assert.equal(prepareAgentRpMemory(session, 'remember-3', replacement).supersedes, first.id)
})

test('lets the user correct and forget active memory without invoking the model', () => {
  const agent = { session: Session.create(SessionId('agent-rp-user-memory')) } as Agent
  const oldInput = { kind: 'preference', subject: '红茶', text: '用户喜欢在红茶里加柠檬' } as const
  const oldCallSeq = appendRememberCall(agent.session, 'remember-user-1', oldInput)
  const old = prepareAgentRpMemory(agent.session, 'remember-user-1', oldInput)
  appendRememberResult(agent.session, 'remember-user-1', old, oldCallSeq)

  const correction = {
    format: 0,
    operation: 'correct',
    id: old.id,
    kind: 'preference',
    subject: '红茶',
    text: '用户希望红茶不要加柠檬',
  } as const
  assert.deepEqual(parseAgentRpMemoryCommandRequest(JSON.stringify(correction)), correction)
  runMemoryCommand(agent, JSON.stringify(correction), 1, true)

  const corrected = readAgentRpMemoryHistory(sessionEvents(agent.session))
  assert.equal(corrected.all.length, 2)
  assert.deepEqual(corrected.active.map(record => record.text), ['用户希望红茶不要加柠檬'])
  assert.doesNotMatch(renderMemoryContext(sessionEvents(agent.session)), /喜欢在红茶里加柠檬/u)
  assert.match(renderMemoryContext(sessionEvents(agent.session)), /红茶不要加柠檬/u)

  runMemoryCommand(agent, JSON.stringify({
    format: 0,
    operation: 'forget',
    id: corrected.active[0]!.id,
  }), 2)
  const forgotten = readAgentRpMemoryHistory(sessionEvents(agent.session))
  assert.equal(forgotten.all.length, 2)
  assert.deepEqual(forgotten.active, [])
  assert.equal(renderMemoryContext(sessionEvents(agent.session)), '')
})

test('lets the user add normalized memory without invoking the model', () => {
  const agent = { session: Session.create(SessionId('agent-rp-user-added-memory')) } as Agent
  const request = {
    format: 0,
    operation: 'add',
    kind: 'relationship',
    subject: '  称呼  ',
    text: '  角色称呼用户为小满  ',
  } as const
  assert.deepEqual(parseAgentRpMemoryCommandRequest(JSON.stringify(request)), {
    ...request,
    subject: '称呼',
    text: '角色称呼用户为小满',
  })
  runMemoryCommand(agent, JSON.stringify(request), 1)

  const history = readAgentRpMemoryHistory(sessionEvents(agent.session))
  assert.equal(history.all.length, 1)
  assert.deepEqual(history.active.map(record => ({ kind: record.kind, subject: record.subject, text: record.text })), [{
    kind: 'relationship', subject: '称呼', text: '角色称呼用户为小满',
  }])
  assert.match(renderMemoryContext(sessionEvents(agent.session)), /角色称呼用户为小满/u)
  assert.throws(() => {
    runMemoryCommand(agent, JSON.stringify({ ...request, subject: '称呼', text: '重复内容' }), 2)
  }, /已经有一条有效记忆/u)
})

test('rejects a user correction that would collide with another active topic', () => {
  const agent = { session: Session.create(SessionId('agent-rp-user-memory-conflict')) } as Agent
  const teaInput = { kind: 'preference', subject: '红茶', text: '用户喝红茶不加柠檬' } as const
  const teaCallSeq = appendRememberCall(agent.session, 'remember-tea', teaInput)
  const tea = prepareAgentRpMemory(agent.session, 'remember-tea', teaInput)
  appendRememberResult(agent.session, 'remember-tea', tea, teaCallSeq)
  const homeInput = { kind: 'fact', subject: '住处', text: '用户住在杭州' } as const
  const homeCallSeq = appendRememberCall(agent.session, 'remember-home', homeInput)
  const home = prepareAgentRpMemory(agent.session, 'remember-home', homeInput)
  appendRememberResult(agent.session, 'remember-home', home, homeCallSeq)
  const commandId = CommandId('memory-command-conflict')
  const request = {
    format: 0,
    operation: 'correct',
    id: home.id,
    kind: 'fact',
    subject: '红茶',
    text: '用户住在杭州',
  } as const
  agent.session.append('command/run', {
    commandId,
    name: 'rp-memory',
    args: JSON.stringify(request),
    source: { kind: 'user' },
  })

  assert.throws(() => executeAgentRpMemoryCommand({ commandId, agent, rawInput: JSON.stringify(request) }), /另一条有效记忆/u)
})

test('copies only active memory into a new Session where it remains editable', () => {
  const source = { session: Session.create(SessionId('agent-rp-memory-source')) } as Agent
  const forgottenInput = { kind: 'fact', subject: '旧住处', text: '用户曾住在杭州' } as const
  const forgottenCallSeq = appendRememberCall(source.session, 'remember-source-1', forgottenInput)
  const forgotten = prepareAgentRpMemory(source.session, 'remember-source-1', forgottenInput)
  appendRememberResult(source.session, 'remember-source-1', forgotten, forgottenCallSeq)
  const retainedInput = { kind: 'preference', subject: '红茶', text: '用户喝红茶不加柠檬' } as const
  const retainedCallSeq = appendRememberCall(source.session, 'remember-source-2', retainedInput)
  const retained = prepareAgentRpMemory(source.session, 'remember-source-2', retainedInput)
  appendRememberResult(source.session, 'remember-source-2', retained, retainedCallSeq)
  runMemoryCommand(source, JSON.stringify({ format: 0, operation: 'forget', id: forgotten.id }), 1)

  const activeSource = readAgentRpMemoryHistory(sessionEvents(source.session)).active
  const target = { session: Session.create(
    SessionId('agent-rp-memory-target'),
    appendAgentRpMemorySeed([], activeSource, String(source.session.id)),
  ) } as Agent
  const inherited = readAgentRpMemoryHistory(sessionEvents(target.session))
  assert.equal(inherited.all.length, 1)
  assert.deepEqual(inherited.active.map(record => ({ kind: record.kind, subject: record.subject, text: record.text })), [{
    kind: 'preference', subject: '红茶', text: '用户喝红茶不加柠檬',
  }])
  assert.match(String(inherited.active[0]?.id), /^memory-seed-0-0$/u)

  runMemoryCommand(target, JSON.stringify({
    format: 0,
    operation: 'correct',
    id: inherited.active[0]?.id,
    kind: 'preference',
    subject: '红茶',
    text: '用户只在冬天喝红茶',
  }), 2)
  const corrected = readAgentRpMemoryHistory(sessionEvents(target.session))
  assert.deepEqual(corrected.active.map(record => record.text), ['用户只在冬天喝红茶'])
  runMemoryCommand(target, JSON.stringify({
    format: 0,
    operation: 'forget',
    id: corrected.active[0]?.id,
  }), 3)
  assert.deepEqual(readAgentRpMemoryHistory(sessionEvents(target.session)).active, [])
})

test('rejects blank memory and invalid correction without appending state', () => {
  const session = Session.create(SessionId('agent-rp-invalid'))
  appendRememberCall(session, 'remember-1', {
    kind: 'fact',
    subject: '资料',
    text: '   ',
  })

  assert.throws(() => prepareAgentRpMemory(session, 'remember-1', {
    kind: 'fact',
    subject: '资料',
    text: '   ',
  }), /must contain non-whitespace/u)
  appendRememberCall(session, 'remember-2', {
    kind: 'fact',
    subject: '资料',
    text: '有效内容',
    supersedes: 'memory-999',
  })
  assert.throws(() => prepareAgentRpMemory(session, 'remember-2', {
    kind: 'fact',
    subject: '资料',
    text: '有效内容',
    supersedes: 'memory-999',
  }), /missing or inactive/u)
  assert.equal(readAgentRpMemoryHistory(sessionEvents(session)).all.length, 0)
})

test('rejects a source that is not the direct remember tool call', () => {
  const session = Session.create(SessionId('agent-rp-source'))
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId('other-1'),
    name: 'other',
    arguments: '{}',
  })

  assert.throws(() => prepareAgentRpMemory(session, 'other-1', {
    kind: 'fact',
    subject: '资料',
    text: '有效内容',
  }), /matching direct Session tool call/u)
})

test('rejects a durable record that diverges from its source call arguments', () => {
  const session = Session.create(SessionId('agent-rp-tampered-source'))
  const sourceEventSeq = appendRememberCall(session, 'remember-1', {
    kind: 'fact',
    subject: '称呼',
    text: '用户喜欢被叫作阿澄',
  })
  appendRememberResult(session, 'remember-1', {
    version: 0,
    id: `memory-${sourceEventSeq}` as never,
    kind: 'fact',
    subject: '称呼',
    text: '用户喜欢被叫作小澄',
    sourceEventSeq,
  }, sourceEventSeq)

  assert.throws(() => readAgentRpMemoryHistory(sessionEvents(session)), /does not match its source call arguments/u)
})
