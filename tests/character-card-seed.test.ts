import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { parseCharacterCardJsonBytes } from '../src/import/character-card.ts'
import { createCharacterCardSessionSeed } from '../src/import/character-card-seed.ts'
import { readActiveSessionCharacter } from '../src/import/session-character.ts'
import { substituteCardMacros } from '../src/prompt.ts'
import { readSessionPersona } from '../src/session-persona.ts'
import { sessionEvents } from '../src/session-events.ts'

const attachment = {
  kind: 'file' as const,
  attachmentId: AttachmentId('sha256:direct-card'),
  bytes: 1_000,
  name: '白露.json',
  mediaType: 'application/json',
}

test('seeds a native roleplay Session directly from one Character Card JSON', () => {
  const card = parseCharacterCardJsonBytes(readFileSync('tests/fixtures/manual-character-card.json'))
  const greeting = substituteCardMacros(card.firstMessage, card)
  const seed = createCharacterCardSessionSeed(card, attachment, 0, greeting)
  const session = Session.create(SessionId('direct-card-import'), seed)

  assert.equal(readActiveSessionCharacter(sessionEvents(session))?.result.name, '白露')
  assert.deepEqual(session.deriveMessages().map(message => ({
    role: message.role,
    text: message.content[0]?.type === 'text' ? message.content[0].text : undefined,
  })), [{ role: 'assistant', text: '门还没锁，你进来吧。' }])
  assert.equal(seed[0]?.type, 'agent-rp/character-card-seed')
})

test('keeps an empty greeting as an active blank character Session', () => {
  const source = JSON.parse(readFileSync('tests/fixtures/manual-character-card.json', 'utf8')) as {
    data: { first_mes: string }
  }
  source.data.first_mes = ''
  const card = parseCharacterCardJsonBytes(Buffer.from(JSON.stringify(source)))
  const seed = createCharacterCardSessionSeed(card, attachment, 0, '')

  assert.equal(seed.length, 1)
  assert.equal(readActiveSessionCharacter(seed)?.result.name, '白露')
})

test('snapshots one reusable Persona independently from the Character Card', () => {
  const card = parseCharacterCardJsonBytes(readFileSync('tests/fixtures/manual-character-card.json'))
  const persona = { id: 'persona-12345678-1234-4123-8123-123456789abc', name: '小满', description: '怕冷，喜欢旧书。' }
  const greeting = substituteCardMacros(card.firstMessage, card, persona.name)
  const seed = createCharacterCardSessionSeed(card, attachment, 0, greeting, { transport: 'json' }, persona.name, persona)

  assert.deepEqual(readSessionPersona(seed), persona)
  assert.equal(seed[1]?.type, 'agent-rp/persona-seed')
  assert.equal(seed[4]?.type, 'assistant/message')
})

test('retains a reusable library id for CHARX media projection', () => {
  const card = parseCharacterCardJsonBytes(readFileSync('tests/fixtures/manual-character-card.json'))
  const charxAttachment = { ...attachment, name: '白露.charx', mediaType: 'application/zip' }
  const libraryId = 'card-0123456789abcdef0123456789abcdef'
  const seed = createCharacterCardSessionSeed(
    card, charxAttachment, 0, '', { transport: 'charx' }, undefined, undefined, libraryId,
  )

  assert.equal(readActiveSessionCharacter(seed)?.result.libraryId, libraryId)
})

test('keeps an older import readable after a formerly degraded capability becomes native', () => {
  const card = parseCharacterCardJsonBytes(readFileSync('tests/fixtures/manual-character-card.json'))
  const seed = createCharacterCardSessionSeed(card, attachment, 0, '')
  const first = seed[0]
  if (first?.type !== 'agent-rp/character-card-seed') assert.fail('missing character seed')
  const legacySeed = [{
    ...first,
    data: {
      ...first.data,
      meta: {
        ...first.data.meta,
        result: { ...first.data.meta.result, degradations: ['lorebook-regex' as const] },
      },
    },
  }, ...seed.slice(1)]

  assert.deepEqual(readActiveSessionCharacter(legacySeed)?.result.degradations, ['lorebook-regex'])
})
