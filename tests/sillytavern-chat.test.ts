import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SurfaceOp } from '@deepseek-ai/dsh-session'
import { encodeGenerationState } from '../src/generation.ts'
import {
  MAX_SILLYTAVERN_CHAT_BYTES,
  parseSillyTavernChat,
  parseSillyTavernChatBytes,
} from '../src/import/sillytavern-chat.ts'
import { exportSillyTavernSessionChat } from '../src/sillytavern-chat-export.ts'

function appendAssistant(session: Session, text: string, surfaceOp: SurfaceOp = 'append') {
  return session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'fixture', model: 'fixture' } }),
  }, { surfaceOp, ...(surfaceOp === 'append' ? {} : { sourceEventSeqs: [surfaceOp.start] }) })
}

test('imports a SillyTavern JSONL chat losslessly with swipes and inert system rows', () => {
  const chat = parseSillyTavernChatBytes(readFileSync('tests/fixtures/manual-sillytavern-chat.jsonl'))

  assert.equal(chat.header.userName, '宝宝')
  assert.equal(chat.header.characterName, '白露')
  assert.deepEqual(chat.header.chatMetadata, { integrity: 'fixture', unknown: { keep: true } })
  assert.deepEqual(chat.messages.map(message => message.kind), ['assistant', 'user', 'narrator', 'system'])
  assert.deepEqual(chat.messages[0]?.swipes, ['门还没锁。', '你来得正好。'])
  assert.equal(chat.messages[0]?.swipeId, 0)
  assert.equal(chat.messages[0]?.text, '门还没锁。')
  assert.deepEqual((chat.messages[0]?.raw as { extra: object }).extra, { model: 'fixture', unknown: true })
})

test('accepts a UTF-8 BOM, CRLF, and blank lines without changing source line numbers', () => {
  const chat = parseSillyTavernChatBytes(Buffer.from('\uFEFF{"chat_metadata":{}}\r\n\r\n{"mes":"你好","is_user":true}\r\n'))

  assert.equal(chat.messages[0]?.line, 3)
  assert.equal(chat.messages[0]?.kind, 'user')
})

test('uses mes as the selected history text without discarding alternate swipes', () => {
  const chat = parseSillyTavernChat([
    '{"chat_metadata":{}}',
    '{"mes":"当前文本","swipes":["旧候选","另一个候选"],"swipe_id":1}',
  ].join('\n'))

  assert.equal(chat.messages[0]?.text, '当前文本')
  assert.deepEqual(chat.messages[0]?.swipes, ['旧候选', '另一个候选'])
})

test('rejects malformed structure instead of silently rewriting it', () => {
  assert.throws(() => parseSillyTavernChat(''), /empty/u)
  assert.throws(() => parseSillyTavernChat('{"mes":"not a header"}'), /chat header/u)
  assert.throws(() => parseSillyTavernChat('{"chat_metadata":[]}'), /chat_metadata must be an object/u)
  assert.throws(() => parseSillyTavernChat('{"chat_metadata":{}}\n{'), /line 2 is not valid JSON/u)
  assert.throws(() => parseSillyTavernChat('{"chat_metadata":{}}\n{"mes":3}'), /line 2\.mes/u)
  assert.throws(() => parseSillyTavernChat('{"chat_metadata":{}}\n{"mes":"x","is_user":"yes"}'), /is_user/u)
  assert.throws(() => parseSillyTavernChat('{"chat_metadata":{}}\n{"mes":"x","is_user":true,"is_system":true}'), /both a user and system/u)
  assert.throws(() => parseSillyTavernChat('{"chat_metadata":{}}\n{"mes":"x","swipes":["x"],"swipe_id":1}'), /outside 1 swipe/u)
  assert.throws(() => parseSillyTavernChatBytes(Uint8Array.from([0xc3, 0x28])), /valid UTF-8/u)
})

test('rejects an oversized chat before parsing', () => {
  assert.throws(() => parseSillyTavernChat('x'.repeat(MAX_SILLYTAVERN_CHAT_BYTES + 1)), /exceeds/u)
})

test('exports the active transcript with the current reply and its alternatives', () => {
  const session = Session.create(SessionId('export-chat'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '今晚去哪里？' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const original = appendAssistant(session, '去钟楼。')
  const alternative = appendAssistant(session, '去港口。', { op: 'replace', start: original.seq, end: original.seq })
  const state = {
    format: 0,
    groupId: '00000000-0000-4000-8000-000000000001',
    operation: 'regenerate',
    originSeq: original.seq,
    anchorSeq: original.seq,
    assistantSeqs: [original.seq, alternative.seq],
    versions: [{ seq: original.seq, text: '去钟楼。' }, { seq: alternative.seq, text: '去港口。' }],
    selectedVersionSeq: alternative.seq,
    surfaceSeq: alternative.seq,
  } as const
  session.append('command/done', {
    commandId: CommandId('export-chat-generation'), kind: 'success', text: encodeGenerationState(state),
  })

  const exported = exportSillyTavernSessionChat(session, {
    sessionId: 'export-chat', characterName: '白露', userName: '旅人',
  })
  const parsed = parseSillyTavernChat(exported.source)
  assert.equal(exported.messageCount, 2)
  assert.match(exported.filename, /^白露-\d{4}-\d{4}\.jsonl$/u)
  assert.doesNotMatch(exported.filename, /export-chat/u)
  assert.equal(parsed.header.characterName, '白露')
  assert.equal(parsed.header.userName, '旅人')
  assert.deepEqual(parsed.messages.map(message => message.text), ['今晚去哪里？', '去港口。'])
  assert.deepEqual(parsed.messages[1]?.swipes, ['去钟楼。', '去港口。'])
  assert.equal(parsed.messages[1]?.swipeId, 1)
})
