import assert from 'node:assert/strict'
import test from 'node:test'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { ToolCallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { parseWorldInfoJson } from '../src/import/world-info.ts'
import {
  prepareWorldInfoImportResult,
  readActiveSessionWorldInfos,
  type WorldInfoImportMeta,
} from '../src/import/session-world-info.ts'
import { sessionEvents } from '../src/session-events.ts'

const raw = {
  name: '海城',
  entries: {
    1: {
      uid: 1,
      key: ['旧钟楼'],
      keysecondary: [],
      content: '旧钟楼每天午夜停摆一分钟。',
      constant: false,
      selective: false,
      order: 10,
      position: 0,
      disable: false,
    },
  },
  extensions: { unknown: true },
} as const

function appendImport(session: Session, callId: string, attachmentId = 'sha256:world-info'): void {
  const file = {
    kind: 'file' as const,
    attachmentId: AttachmentId(attachmentId),
    bytes: Buffer.byteLength(JSON.stringify(raw)),
    name: '海城.json',
    mediaType: 'application/json',
  }
  const source = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '导入这本世界书' }],
    source: { kind: 'user', attachmentConsumer: 'dsh-agent-rp', attachments: [file] } as never,
  }), { surfaceOp: 'append' })
  const call = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId(callId),
    name: 'import_world_info',
    arguments: '{}',
  })
  const value = prepareWorldInfoImportResult(parseWorldInfoJson(JSON.stringify(raw)), source.seq, file)
  const { raw: rawWorldInfo, ...result } = value
  const meta: WorldInfoImportMeta = { format: 0, result, raw: rawWorldInfo }
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId(callId),
      content: [{ type: 'text', text: `已导入世界书 ${value.name}` }],
      isError: false,
    }),
    meta: meta as unknown as JsonValue,
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
}

test('replays standalone World Info from lossless native tool metadata', () => {
  const session = Session.create(SessionId('world-info-import'))
  appendImport(session, 'world-info-1')

  const [active] = readActiveSessionWorldInfos(sessionEvents(session))
  assert.equal(active?.result.name, '海城')
  assert.equal(active?.worldInfo.lorebook.entries[0]?.content, '旧钟楼每天午夜停摆一分钟。')
  assert.deepEqual(active?.worldInfo.raw, raw)
})

test('keeps distinct books active and replaces a repeated source attachment', () => {
  const session = Session.create(SessionId('world-info-many'))
  appendImport(session, 'world-info-1', 'sha256:first')
  appendImport(session, 'world-info-2', 'sha256:second')
  appendImport(session, 'world-info-3', 'sha256:first')

  assert.deepEqual(readActiveSessionWorldInfos(sessionEvents(session)).map(value => value.result.sourceAttachmentId), [
    'sha256:first',
    'sha256:second',
  ])
})

test('keeps an older World Info import readable after compatibility improves', () => {
  const session = Session.create(SessionId('world-info-legacy-degradation'))
  appendImport(session, 'world-info-legacy')
  const seed = structuredClone(sessionEvents(session)) as SessionEvent[]
  const result = seed.find(event => event.type === 'tool/result')!
  if (result.type !== 'tool/result' || typeof result.data.meta !== 'object'
    || result.data.meta === null || Array.isArray(result.data.meta)) assert.fail('fixture did not produce metadata')
  const summary = (result.data.meta as Record<string, JsonValue>).result as Record<string, JsonValue>
  summary.degradations = ['entry-probability']

  assert.deepEqual(readActiveSessionWorldInfos(seed)[0]?.result.degradations, ['entry-probability'])
})

test('rejects World Info replay detached from its source file', () => {
  const session = Session.create(SessionId('world-info-tamper'))
  appendImport(session, 'world-info-1')
  const seed = structuredClone(sessionEvents(session)) as SessionEvent[]
  const result = seed.find(event => event.type === 'tool/result')!
  if (result.type !== 'tool/result' || typeof result.data.meta !== 'object'
    || result.data.meta === null || Array.isArray(result.data.meta)) assert.fail('fixture did not produce metadata')
  const summary = (result.data.meta as Record<string, JsonValue>).result as Record<string, JsonValue>
  summary.sourceAttachmentId = 'sha256:other'

  assert.throws(() => readActiveSessionWorldInfos(sessionEvents(Session.create(SessionId('world-info-tampered'), seed))), /source attachment is absent/u)
})
