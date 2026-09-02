import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq, type SurfaceOp } from '@deepseek-ai/dsh-session'
import {
  decodeGenerationState,
  encodeGenerationState,
  executeGenerationCommand,
  parseGenerationRequest,
  readGenerationGroups,
} from '../src/generation.ts'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { executeTavernTrigger } from '../src/tavern-trigger.ts'
import {
  appendTavernHelperState,
  applyTavernHelperMutation,
  initializeTavernHelperState,
  readTavernHelperState,
  type TavernHelperState,
} from '../src/tavern-helper.ts'
import { encodeWorldInfoConfiguration, readWorldInfoConfiguration } from '../src/world-info-configuration-core.ts'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import { createCharacterCardSessionSeed } from '../src/import/character-card-seed.ts'
import { appendMvuState, readCurrentSessionMvuState } from '../src/mvu.ts'
import { sessionEvents } from '../src/session-events.ts'

function appendAssistant(session: Session, turn: number, text: string, surfaceOp: SurfaceOp = 'append') {
  const sourceEventSeqs = surfaceOp === 'append' ? [] : [...session.surface.nodes]
  return session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'fixture', model: 'fixture' } }),
  }, { surfaceOp, sourceEventSeqs })
}

function scriptState(marker: string, prompt: string): TavernHelperState {
  const initial = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: ['状态同步'], tavernHelperVariables: {},
    tavernHelperScripts: [{
      id: 'state', name: '状态同步', content: '', info: '', enabled: true,
      buttonEnabled: false, buttons: [], data: {},
    }],
  }, 'generation-state-card')
  const variables = applyTavernHelperMutation(initial, {
    format: 0, scope: 'message', variables: { stat_data: { marker } },
  })
  return applyTavernHelperMutation(variables, {
    format: 0, operation: 'replace-script-injections', scriptScope: 'character', scriptId: 'state',
    prompts: [{
      id: 'next-request', position: 'in_chat', depth: 0, role: 'system', content: prompt,
      shouldScan: true, once: true,
    }],
  })
}

function mvuCardSession(id: string) {
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

test('parses only the three private reply-version operations', () => {
  assert.deepEqual(parseGenerationRequest('{"operation":"regenerate","replySeq":4}'), { operation: 'regenerate', replySeq: 4 })
  assert.deepEqual(parseGenerationRequest('{"operation":"continue","replySeq":4}'), { operation: 'continue', replySeq: 4 })
  assert.deepEqual(parseGenerationRequest('{"operation":"select","replySeq":4,"versionIndex":1}'), { operation: 'select', replySeq: 4, versionIndex: 1 })
  assert.throws(() => parseGenerationRequest('{"operation":"select","replySeq":4,"versionIndex":-1}'), /版本序号无效/)
  assert.throws(() => parseGenerationRequest('{"operation":"regenerate","replySeq":4,"extra":true}'), /未知字段/)
})

test('folds latest selectable reply group snapshots across replacement events', () => {
  const session = Session.create(SessionId('generation-fold'))
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const original = appendAssistant(session, 1, '第一版')
  const generated = appendAssistant(session, 2, '第二版')
  const replacement = appendAssistant(session, 2, '第二版', { op: 'replace', start: SessionSeq(0), end: generated.seq })
  const groupId = '00000000-0000-4000-8000-000000000001'
  const firstState = {
    format: 0,
    groupId,
    operation: 'regenerate',
    originSeq: original.seq,
    anchorSeq: original.seq,
    assistantSeqs: [original.seq, generated.seq],
    versions: [{ seq: original.seq, text: '第一版' }, { seq: generated.seq, text: '第二版' }],
    selectedVersionSeq: generated.seq,
    surfaceSeq: replacement.seq,
  } as const
  session.append('command/done', { commandId: CommandId('generation-1'), kind: 'success', text: encodeGenerationState(firstState) })
  const restored = appendAssistant(session, 1, '第一版', { op: 'replace', start: replacement.seq, end: replacement.seq })
  const selectedState = {
    format: 0,
    groupId,
    operation: 'select',
    originSeq: original.seq,
    anchorSeq: original.seq,
    assistantSeqs: [original.seq, generated.seq],
    versions: [{ seq: original.seq, text: '第一版' }, { seq: generated.seq, text: '第二版' }],
    selectedVersionSeq: original.seq,
    surfaceSeq: restored.seq,
  } as const
  session.append('command/done', { commandId: CommandId('generation-2'), kind: 'success', text: encodeGenerationState(selectedState) })

  const [group] = readGenerationGroups(sessionEvents(session))
  assert.equal(group?.selectedVersionSeq, original.seq)
  assert.equal(group?.surfaceSeq, restored.seq)
  assert.deepEqual(session.deriveMessages().map(message => message.content[0]?.type === 'text' ? message.content[0].text : ''), ['第一版'])
})

test('rejects reply versions that reference a non-state event', () => {
  const session = Session.create(SessionId('generation-invalid-state-reference'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '你好' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const reply = appendAssistant(session, 1, '回复')
  session.append('command/done', {
    commandId: CommandId('generation-invalid-state-reference'),
    kind: 'success',
    text: encodeGenerationState({
      format: 0,
      groupId: '00000000-0000-4000-8000-000000000099',
      operation: 'regenerate',
      originSeq: reply.seq,
      anchorSeq: reply.seq,
      assistantSeqs: [reply.seq],
      versions: [{ seq: reply.seq, text: '回复', tavernStateSeq: reply.seq }],
      selectedVersionSeq: reply.seq,
      surfaceSeq: reply.seq,
    }),
  })

  assert.throws(() => readGenerationGroups(sessionEvents(session)), /脚本状态不存在/u)
})

test('regenerates without exposing the rejected reply to the replacement request', async () => {
  const session = Session.create(SessionId('generation-isolated-regenerate'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '请描述没有状态栏的房间。' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const original = appendAssistant(session, 1, '有问题的回复\n<状态栏>仍然显示</状态栏>')
  let requestTranscript: readonly string[] = []
  const agent = {
    session,
    status: 'idle',
    inbox: { hasPending: false },
    followup(message: ReturnType<typeof createUserMessage>) {
      session.append('user/message', message, { surfaceOp: 'append' })
      requestTranscript = session.deriveMessages().map(item => item.content.flatMap(block =>
        block.type === 'text' ? [block.text] : []).join('\n'))
      appendAssistant(session, 2, '房间里只有安静的灯光。')
    },
    whenIdle: async () => {},
    cancel: () => {},
  }

  const result = await executeGenerationCommand({
    agent: agent as never,
    rawInput: JSON.stringify({ operation: 'regenerate', replySeq: original.seq }),
    signal: new AbortController().signal,
  })
  const state = decodeGenerationState(result.text)

  assert.equal(requestTranscript.some(text => text.includes('有问题的回复') || text.includes('<状态栏>')), false)
  assert.deepEqual(session.deriveMessages().map(message => message.content.flatMap(block =>
    block.type === 'text' ? [block.text] : []).join('\n')), [
    '请描述没有状态栏的房间。',
    '房间里只有安静的灯光。',
  ])
  assert.deepEqual(state?.versions.map(version => version.text), [
    '有问题的回复\n<状态栏>仍然显示</状态栏>',
    '房间里只有安静的灯光。',
  ])
})

test('keeps adapter replay state only while reply content remains exact', async () => {
  const replay = (id: string) => ({ kind: 'fixture-replay', id })
  const appendReplayAssistant = (session: Session, turn: number, text: string, id: string) => session.append(
    'assistant/message',
    {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'fixture', model: 'fixture', replayState: replay(id) },
      }),
    },
    { surfaceOp: 'append' },
  )

  const regenerateSession = Session.create(SessionId('generation-replay-regenerate'))
  regenerateSession.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '重新写。' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const rejected = appendReplayAssistant(regenerateSession, 1, '旧回复', 'old')
  let placeholderReplay: unknown = replay('not-observed')
  const regenerateAgent = {
    session: regenerateSession,
    status: 'idle',
    inbox: { hasPending: false },
    followup(message: ReturnType<typeof createUserMessage>) {
      regenerateSession.append('user/message', message, { surfaceOp: 'append' })
      const placeholder = regenerateSession.deriveMessages().findLast(item => item.role === 'assistant')
      placeholderReplay = placeholder?.source.kind === 'model' ? placeholder.source.replayState : undefined
      appendReplayAssistant(regenerateSession, 2, '新回复', 'new')
    },
    whenIdle: async () => {},
    cancel: () => {},
  }
  await executeGenerationCommand({
    agent: regenerateAgent as never,
    rawInput: JSON.stringify({ operation: 'regenerate', replySeq: rejected.seq }),
    signal: new AbortController().signal,
  })
  assert.equal(placeholderReplay, undefined)
  const regenerated = regenerateSession.deriveMessages().findLast(item => item.role === 'assistant')
  assert.deepEqual(regenerated?.source.kind === 'model' ? regenerated.source.replayState : undefined, replay('new'))

  const continueSession = Session.create(SessionId('generation-replay-continue'))
  continueSession.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '继续写。' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const first = appendReplayAssistant(continueSession, 1, '第一段', 'first')
  const continueAgent = {
    session: continueSession,
    status: 'idle',
    inbox: { hasPending: false },
    followup(message: ReturnType<typeof createUserMessage>) {
      continueSession.append('user/message', message, { surfaceOp: 'append' })
      appendReplayAssistant(continueSession, 2, '第二段', 'second')
    },
    whenIdle: async () => {},
    cancel: () => {},
  }
  await executeGenerationCommand({
    agent: continueAgent as never,
    rawInput: JSON.stringify({ operation: 'continue', replySeq: first.seq }),
    signal: new AbortController().signal,
  })
  const continued = continueSession.deriveMessages().findLast(item => item.role === 'assistant')
  assert.equal(continued?.source.kind === 'model' ? continued.source.replayState : undefined, undefined)
  assert.equal(continued?.content[0]?.type === 'text' ? continued.content[0].text : '', '第一段第二段')
})

test('regenerates from pre-reply script state and restores each swipe state', async () => {
  const { card, session } = mvuCardSession('generation-script-state')
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '请重新描写房间。' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const baseline = scriptState('before-reply', 'fresh-context')
  appendTavernHelperState(session, baseline)
  appendMvuState(session, { statData: { 角色: { 等级: 2 } }, updateCount: 1 })
  const original = appendAssistant(session, 1,
    '错误版本带状态栏<UpdateVariable><JSONPatch>[{"op":"delta","path":"/角色/等级","value":7}]</JSONPatch></UpdateVariable>')
  const rejected = scriptState('rejected-reply', 'rejected-context')
  appendTavernHelperState(session, rejected)
  appendMvuState(session, { statData: { 角色: { 等级: 9 } }, updateCount: 2 })
  session.append('command/done', {
    commandId: CommandId('generation-world-info-latest'),
    kind: 'success',
    text: encodeWorldInfoConfiguration({ format: 0, revision: 7, overrides: [], tokenBudget: 4_096 }),
  })
  let requestState: TavernHelperState | undefined
  let requestWorldInfoRevision: number | undefined
  let requestMvu: ReturnType<typeof readCurrentSessionMvuState>
  const agent = {
    session,
    status: 'idle',
    inbox: { hasPending: false },
    followup(message: ReturnType<typeof createUserMessage>) {
      session.append('user/message', message, { surfaceOp: 'append' })
      requestState = readTavernHelperState(sessionEvents(session))
      requestWorldInfoRevision = readWorldInfoConfiguration(sessionEvents(session)).revision
      requestMvu = readCurrentSessionMvuState(card, session)
      appendAssistant(session, 2,
        '干净的新版本<UpdateVariable><JSONPatch>[{"op":"delta","path":"/角色/等级","value":2}]</JSONPatch></UpdateVariable>')
    },
    whenIdle: async () => {},
    cancel: () => {},
  }

  const regenerated = await executeGenerationCommand({
    agent: agent as never,
    rawInput: JSON.stringify({ operation: 'regenerate', replySeq: original.seq }),
    signal: new AbortController().signal,
  })
  session.append('command/done', {
    commandId: CommandId('generation-script-state-regenerate'), kind: 'success', text: regenerated.text,
  })

  assert.deepEqual(requestState?.scopes.message, { stat_data: { marker: 'before-reply' } })
  assert.deepEqual(requestState?.injectedPrompts?.map(prompt => prompt.content), ['fresh-context'])
  assert.equal(requestWorldInfoRevision, 7)
  assert.deepEqual(requestMvu, { statData: { 角色: { 等级: 2 } }, updateCount: 1 })
  assert.deepEqual(decodeGenerationState(regenerated.text)?.mvu, {
    statData: { 角色: { 等级: 4 } }, updateCount: 2,
  })
  const regeneratedState = decodeGenerationState(regenerated.text)
  const replacementReplySeq = regeneratedState?.assistantSeqs.at(-1)
  if (replacementReplySeq === undefined) throw new Error('missing regenerated reply fixture')
  assert.deepEqual(regeneratedState?.versions.map(version => version.artifactReplySeqs), [
    [original.seq], [replacementReplySeq],
  ])
  assert.deepEqual(readTavernHelperState(sessionEvents(session))?.scopes.message, { stat_data: { marker: 'before-reply' } })

  const accepted = scriptState('replacement-reply', 'replacement-context')
  appendTavernHelperState(session, accepted)
  const originalSelected = await executeGenerationCommand({
    agent: agent as never,
    rawInput: JSON.stringify({ operation: 'select', replySeq: original.seq, versionIndex: 0 }),
    signal: new AbortController().signal,
  })
  session.append('command/done', {
    commandId: CommandId('generation-script-state-original'), kind: 'success', text: originalSelected.text,
  })
  assert.deepEqual(readTavernHelperState(sessionEvents(session))?.scopes.message, { stat_data: { marker: 'rejected-reply' } })
  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 9 } }, updateCount: 2,
  })

  const replacementSelected = await executeGenerationCommand({
    agent: agent as never,
    rawInput: JSON.stringify({ operation: 'select', replySeq: original.seq, versionIndex: 1 }),
    signal: new AbortController().signal,
  })
  session.append('command/done', {
    commandId: CommandId('generation-script-state-replacement'), kind: 'success', text: replacementSelected.text,
  })
  assert.deepEqual(readTavernHelperState(sessionEvents(session))?.scopes.message, { stat_data: { marker: 'replacement-reply' } })
  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 4 } }, updateCount: 2,
  })
  assert.equal(decodeGenerationState(replacementSelected.text)?.selectedVersionSeq,
    decodeGenerationState(regenerated.text)?.versions[1]?.seq)
  const reopened = Session.create(session.id, sessionEvents(session))
  assert.deepEqual(readTavernHelperState(sessionEvents(reopened))?.scopes.message, { stat_data: { marker: 'replacement-reply' } })
  assert.equal(readGenerationGroups(sessionEvents(reopened))[0]?.selectedVersionSeq,
    decodeGenerationState(regenerated.text)?.versions[1]?.seq)
})

test('restores the selected reply when isolated regeneration produces no replacement', async () => {
  const session = Session.create(SessionId('generation-isolated-regenerate-failure'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '继续。' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  appendTavernHelperState(session, scriptState('before-retained-reply', 'before-retained-context'))
  const original = appendAssistant(session, 1, '保留这一版。')
  const retainedState = scriptState('retained-reply', 'retained-context')
  appendTavernHelperState(session, retainedState)
  const agent = {
    session,
    status: 'idle',
    inbox: { hasPending: false },
    followup(message: ReturnType<typeof createUserMessage>) {
      session.append('user/message', message, { surfaceOp: 'append' })
    },
    whenIdle: async () => {},
    cancel: () => {},
  }

  await assert.rejects(executeGenerationCommand({
    agent: agent as never,
    rawInput: JSON.stringify({ operation: 'regenerate', replySeq: original.seq }),
    signal: new AbortController().signal,
  }), /模型没有生成可用的角色回复/u)

  assert.deepEqual(session.deriveMessages().map(message => message.content.flatMap(block =>
    block.type === 'text' ? [block.text] : []).join('\n')), ['继续。', '保留这一版。'])
  assert.deepEqual(readTavernHelperState(sessionEvents(session))?.scopes.message, { stat_data: { marker: 'retained-reply' } })
})

test('continues from the selected MVU checkpoint without applying its old patch twice', async () => {
  const { card, session } = mvuCardSession('generation-continue-mvu')
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '提升等级。' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const original = appendAssistant(session, 1,
    '第一段<UpdateVariable><JSONPatch>[{"op":"delta","path":"/角色/等级","value":1}]</JSONPatch></UpdateVariable>')
  const agent = {
    session,
    status: 'idle',
    inbox: { hasPending: false },
    followup(message: ReturnType<typeof createUserMessage>) {
      session.append('user/message', message, { surfaceOp: 'append' })
      appendAssistant(session, 2,
        '第二段<UpdateVariable><JSONPatch>[{"op":"delta","path":"/角色/等级","value":2}]</JSONPatch></UpdateVariable>')
    },
    whenIdle: async () => {},
    cancel: () => {},
  }

  const result = await executeGenerationCommand({
    agent: agent as never,
    rawInput: JSON.stringify({ operation: 'continue', replySeq: original.seq }),
    signal: new AbortController().signal,
  })

  const continued = decodeGenerationState(result.text)
  const continuationReplySeq = continued?.assistantSeqs.at(-1)
  if (continuationReplySeq === undefined) throw new Error('missing continuation reply fixture')
  assert.deepEqual(continued?.mvu, {
    statData: { 角色: { 等级: 4 } }, updateCount: 2,
  })
  assert.deepEqual(continued?.versions.at(-1)?.artifactReplySeqs, [original.seq, continuationReplySeq])
  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 4 } }, updateCount: 2,
  })
})

test('triggers one reply after a Tavern script appends a user message', async () => {
  const session = Session.create(SessionId('tavern-trigger'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '延续当前剧情' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  let triggerText: string | undefined
  const agent = {
    session,
    status: 'idle',
    inbox: { hasPending: false },
    followup(message: ReturnType<typeof createUserMessage>) {
      triggerText = message.content[0]?.type === 'text' ? message.content[0].text : undefined
      appendAssistant(session, 2, '角色继续回应')
    },
    whenIdle: async () => {},
    cancel: () => {},
  }
  const result = await executeTavernTrigger({
    agent: agent as never, rawInput: '', signal: new AbortController().signal,
  })

  assert.equal(triggerText, 'Respond to the latest user-authored roleplay message. Output only the in-character response.')
  assert.deepEqual(JSON.parse(result.text), { format: 0, assistantSeq: 1 })
  assert.deepEqual(session.deriveMessages().map(message => message.content[0]?.type === 'text' ? message.content[0].text : ''), [
    '延续当前剧情', '角色继续回应',
  ])
})

test('retries one reasoning-only Tavern trigger before surfacing an empty reply failure', async () => {
  const session = Session.create(SessionId('tavern-trigger-empty-recovery'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '完成开场' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const prompts: string[] = []
  const agent = {
    session,
    status: 'idle',
    inbox: { hasPending: false },
    followup(message: ReturnType<typeof createUserMessage>) {
      prompts.push(message.content[0]?.type === 'text' ? message.content[0].text : '')
      appendAssistant(session, prompts.length + 1, prompts.length === 1 ? '' : '补全后的角色开场')
    },
    whenIdle: async () => {},
    cancel: () => {},
  }

  const result = await executeTavernTrigger({
    agent: agent as never, rawInput: '', signal: new AbortController().signal,
  })

  assert.equal(prompts.length, 2)
  assert.match(prompts[1]!, /previous attempt ended without a visible answer/u)
  assert.deepEqual(JSON.parse(result.text), { format: 0, assistantSeq: 2 })
})

test('bounds Tavern empty-reply recovery to one retry', async () => {
  const session = Session.create(SessionId('tavern-trigger-empty-bounded'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '完成开场' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  let attempts = 0
  const agent = {
    session,
    status: 'idle',
    inbox: { hasPending: false },
    followup() {
      attempts += 1
      appendAssistant(session, attempts + 1, '')
    },
    whenIdle: async () => {},
    cancel: () => {},
  }

  await assert.rejects(executeTavernTrigger({
    agent: agent as never, rawInput: '', signal: new AbortController().signal,
  }), /连续两次没有生成可见/u)
  assert.equal(attempts, 2)
})

test('refuses a bare Tavern trigger without a latest user message', async () => {
  const session = Session.create(SessionId('tavern-trigger-without-user'))
  appendAssistant(session, 1, '角色上一条回复')
  await assert.rejects(executeTavernTrigger({
    agent: {
      session, status: 'idle', inbox: { hasPending: false }, followup: () => {}, whenIdle: async () => {}, cancel: () => {},
    } as never,
    rawInput: '', signal: new AbortController().signal,
  }), /需要先添加一条用户消息/u)
})
