import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { parseSillyTavernChat, parseSillyTavernChatBytes } from '../src/import/sillytavern-chat.ts'
import {
  createSillyTavernChatSeed,
  readSillyTavernChatIdentity,
} from '../src/import/sillytavern-chat-seed.ts'

const attachment = {
  kind: 'file' as const,
  attachmentId: AttachmentId('sha256:sillytavern-chat-fixture'),
  bytes: 1_000,
  name: '白露 - 2026-08-12.jsonl',
  mediaType: 'application/x-ndjson',
}

test('creates balanced native Session history in SillyTavern display order', () => {
  const chat = parseSillyTavernChatBytes(readFileSync('tests/fixtures/manual-sillytavern-chat.jsonl'))
  const seed = createSillyTavernChatSeed(chat, attachment)
  const session = Session.create(SessionId('imported-chat'), seed)

  assert.deepEqual(session.deriveMessages().map(message => ({
    role: message.role,
    text: message.content[0]?.type === 'text' ? message.content[0].text : undefined,
    source: message.source.kind,
  })), [
    { role: 'assistant', text: '门还没锁。', source: 'model' },
    { role: 'user', text: '那我进来啦。', source: 'user' },
    { role: 'user', text: '窗外响起整点钟声。', source: 'plugin' },
  ])
  assert.equal(seed.filter(event => event.type === 'turn/start').length, 3)
  assert.equal(seed.filter(event => event.type === 'turn/end').length, 3)
  assert.equal(seed.at(-1)?.type, 'turn/end')
})

test('retains swipes and the original attachment in skippable import metadata', () => {
  const chat = parseSillyTavernChatBytes(readFileSync('tests/fixtures/manual-sillytavern-chat.jsonl'))
  const seed = createSillyTavernChatSeed(chat, attachment)
  const imported = seed[0]

  assert.equal(imported?.type, 'agent-rp/sillytavern-chat-import')
  assert.equal(imported === undefined || !('ignorable' in imported), true)
  if (imported?.type !== 'agent-rp/sillytavern-chat-import') assert.fail('missing import metadata')
  assert.equal(imported.data.source.attachments[0].attachmentId, attachment.attachmentId)
  assert.deepEqual(imported.data.messages[0]?.swipes, ['门还没锁。', '你来得正好。'])
  assert.deepEqual((imported.data.header as { chat_metadata: object }).chat_metadata, {
    integrity: 'fixture', unknown: { keep: true },
  })
})

test('recovers the imported chat identity for subsequent roleplay turns', () => {
  const chat = parseSillyTavernChatBytes(readFileSync('tests/fixtures/manual-sillytavern-chat.jsonl'))
  const seed = createSillyTavernChatSeed(chat, attachment)

  assert.deepEqual(readSillyTavernChatIdentity(seed), {
    characterName: '白露',
    userName: '宝宝',
  })
})

test('keeps ordinary system rows and empty messages out of model history', () => {
  const chat = parseSillyTavernChatBytes(Buffer.from([
    '{"chat_metadata":{}}',
    '{"mes":"","is_user":true}',
    '{"mes":"UI only","is_system":true,"extra":{"type":"comment"}}',
  ].join('\n')))
  const seed = createSillyTavernChatSeed(chat, attachment)

  assert.deepEqual(Session.create(SessionId('inert-chat'), seed).deriveMessages(), [])
  const imported = seed[0]
  if (imported?.type !== 'agent-rp/sillytavern-chat-import') assert.fail('missing import metadata')
  assert.deepEqual(imported.data.messages.map(message => message.kind), ['user', 'system'])
})

test('rejects a source that cannot round-trip as a SillyTavern JSONL attachment', () => {
  const chat = parseSillyTavernChat('{"chat_metadata":{}}')
  assert.throws(() => createSillyTavernChatSeed(chat, { ...attachment, name: 'chat.txt' }), /must be a \.jsonl file/u)
})
