import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { constants, zstdCompressSync, type ZstdOptions } from 'node:zlib'
import {
  locateAgentRpSessionFile,
  repairAgentRpSessionById,
  repairAgentRpSessionFile,
} from '../src/session-repair.ts'

const options: ZstdOptions = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

function frame(value: unknown): Buffer {
  const lines = (Array.isArray(value) ? value : [value]).map(item => JSON.stringify(item)).join('\n') + '\n'
  return zstdCompressSync(Buffer.from(lines), options)
}

test('repairs only known legacy events in a chosen multi-frame session and keeps a byte backup', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-rp-session-repair-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'session.jsonl.zstd')
  const header = { type: 'session', version: 0, id: 'fixture', createdAt: 1, delegationDepth: 0 }
  const events = [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'agent-rp/turn-settlement', seq: 1, time: 2, data: { format: 0 } },
    { type: 'agent-rp/state', seq: 2, time: 3, data: { format: 0 }, ignorable: true },
  ]
  const original = Buffer.concat([
    frame(header),
    frame(events),
  ])
  await writeFile(path, original)

  const inspected = await repairAgentRpSessionFile(path)
  assert.equal(inspected.applied, false)
  assert.equal(inspected.repairedEvents, 1)
  assert.equal(inspected.alreadySafeEvents, 1)
  assert.deepEqual(await readFile(path), original)

  const repaired = await repairAgentRpSessionFile(path, { apply: true })
  assert.equal(repaired.applied, true)
  assert.equal(repaired.repairedEvents, 1)
  assert.ok(repaired.backupPath)
  assert.deepEqual(await readFile(repaired.backupPath), original)
  assert.deepEqual(await readFile(path), Buffer.concat([
    frame(header),
    frame(events.map(event => event.type === 'agent-rp/turn-settlement'
      ? { ...event, ignorable: true }
      : event)),
  ]))
  const verified = await repairAgentRpSessionFile(path)
  assert.equal(verified.repairedEvents, 0)
  assert.equal(verified.alreadySafeEvents, 2)
})

test('adds only the replay-safe marker to plaintext Agent RP records', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-rp-session-repair-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'session.jsonl')
  const header = { type: 'session', version: 0, id: 'plain-fixture', createdAt: 1, delegationDepth: 0 }
  const legacy = {
    type: 'agent-rp/turn-mode', seq: 0, time: 2,
    data: { format: 0, mode: 'agent', source: 'default' },
  }
  await writeFile(path, `${JSON.stringify(header)}\n${JSON.stringify(legacy)}\n`)

  const repaired = await repairAgentRpSessionFile(path, { apply: true })

  assert.equal(repaired.repairedEvents, 1)
  const [storedHeader, storedEvent] = (await readFile(path, 'utf8')).trimEnd().split('\n')
    .map(line => JSON.parse(line) as unknown)
  assert.deepEqual(storedHeader, header)
  assert.deepEqual(storedEvent, {
    type: legacy.type, seq: legacy.seq, time: legacy.time, data: legacy.data, ignorable: true,
  })
})

test('refuses unknown Agent RP events without changing the file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-rp-session-repair-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'session.jsonl')
  const original = Buffer.from([
    JSON.stringify({ type: 'session', version: 0, id: 'fixture', createdAt: 1, delegationDepth: 0 }),
    JSON.stringify({ type: 'agent-rp/future-required-state', seq: 0, time: 1, data: {}, ignorable: true }),
    '',
  ].join('\n'))
  await writeFile(path, original)

  await assert.rejects(repairAgentRpSessionFile(path, { apply: true }), /不认识的 Agent RP 事件/u)
  assert.deepEqual(await readFile(path), original)
})

test('locates one encoded Session id and refuses ambiguous or misplaced artifacts', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-rp-session-locator-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sessionId = 'session/lookup'
  const encoded = 'session~002Flookup'
  const firstDirectory = join(root, '--project-a--', encoded)
  await mkdir(firstDirectory, { recursive: true })
  const firstPath = join(firstDirectory, 'session.jsonl.zstd')
  const original = Buffer.concat([
    frame({ type: 'session', version: 0, id: sessionId, createdAt: 1, delegationDepth: 0 }),
    frame({ type: 'agent-rp/turn-settlement', seq: 0, time: 2, data: { format: 0 } }),
  ])
  await writeFile(firstPath, original)

  assert.equal(await locateAgentRpSessionFile(root, sessionId), firstPath)
  const inspected = await repairAgentRpSessionById(root, sessionId)
  assert.equal(inspected.sessionId, sessionId)
  assert.equal(inspected.repairedEvents, 1)
  assert.deepEqual(await readFile(firstPath), original)

  const misplacedId = 'session-misplaced'
  const misplacedDirectory = join(root, '--project-a--', misplacedId)
  await mkdir(misplacedDirectory, { recursive: true })
  const misplacedPath = join(misplacedDirectory, 'session.jsonl')
  const misplaced = Buffer.from([
    JSON.stringify({ type: 'session', version: 0, id: 'another-session', createdAt: 1, delegationDepth: 0 }),
    JSON.stringify({ type: 'agent-rp/state', seq: 0, time: 2, data: { format: 0 } }),
    '',
  ].join('\n'))
  await writeFile(misplacedPath, misplaced)
  await assert.rejects(
    repairAgentRpSessionById(root, misplacedId, { apply: true }),
    /header ID .* 与请求的 .* 不一致/u,
  )
  assert.deepEqual(await readFile(misplacedPath), misplaced)

  const duplicateDirectory = join(root, '--project-b--', encoded)
  await mkdir(duplicateDirectory, { recursive: true })
  await writeFile(join(duplicateDirectory, 'session.jsonl.zstd'), original)
  await assert.rejects(locateAgentRpSessionFile(root, sessionId), /存在多个候选文件/u)
  assert.deepEqual(await readFile(firstPath), original)
})
