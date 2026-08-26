import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { readActiveSessionWorldInfos } from '../src/import/session-world-info.ts'
import { EjsTemplateEngine } from '../src/ejs-template.ts'
import { agentRpProjectionDefinition, createAgentRpProjectionDefinition } from '../src/projection.ts'
import { WorldInfoLibrary } from '../src/world-info-library.ts'
import { executeWorldInfoLibraryCommand } from '../src/world-info-library-command.ts'

const source = Buffer.from(JSON.stringify({
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
}), 'utf8')

test('imports Host-owned World Info through a private command without a model turn', context => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-world-info-library-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const library = new WorldInfoLibrary({ root })
  const upload = library.importFile({ data: source, filename: '海城.json' })
  const session = Session.create(SessionId('direct-world-info'))
  const agent = { session } as Agent
  const commandId = CommandId('world-info-library-1')
  const rawInput = JSON.stringify({ format: 0, importId: upload.id })
  session.append('command/run', {
    commandId,
    name: 'rp-world-info-import',
    args: ` ${rawInput}`,
    source: { kind: 'user' },
  })
  const result = executeWorldInfoLibraryCommand(library, { agent, commandId, rawInput })
  session.append('command/done', { commandId, ...result })

  const [active] = readActiveSessionWorldInfos(session.events)
  assert.equal(active?.result.name, '海城')
  assert.equal(active?.worldInfo.lorebook.entries[0]?.content, '旧钟楼每天午夜停摆一分钟。')
  assert.equal(session.events.some(event => event.type === 'turn/start'), false)

  const repeatedCommandId = CommandId('world-info-library-2')
  session.append('command/run', {
    commandId: repeatedCommandId,
    name: 'rp-world-info-import',
    args: ` ${rawInput}`,
    source: { kind: 'user' },
  })
  const repeated = executeWorldInfoLibraryCommand(library, {
    agent,
    commandId: repeatedCommandId,
    rawInput,
  })
  session.append('command/done', { commandId: repeatedCommandId, ...repeated })
  assert.equal(readActiveSessionWorldInfos(session.events).length, 1)

  let state = agentRpProjectionDefinition.init()
  for (const event of session.events) state = agentRpProjectionDefinition.apply(state, event)
  const projected = agentRpProjectionDefinition.wire.view(state)
  assert.equal(projected.worldInfo.books[0]?.name, '海城')
  assert.equal(projected.worldInfoCount, 1)
})

test('projects the isolated EJS runtime error for Debug-gated World Info reports', async context => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-world-info-debug-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const library = new WorldInfoLibrary({ root })
  const upload = library.importFile({
    data: Buffer.from(JSON.stringify({
      name: '控制器世界书',
      entries: {
        104: {
          uid: 104,
          key: [],
          keysecondary: [],
          content: '<%= boundaryState.enabled %>',
          constant: true,
          selective: false,
          order: 10,
          position: 0,
          disable: false,
        },
      },
    }), 'utf8'),
    filename: '控制器世界书.json',
  })
  const session = Session.create(SessionId('world-info-debug-error'))
  const commandId = CommandId('world-info-debug-error-import')
  const rawInput = JSON.stringify({ format: 0, importId: upload.id })
  session.append('command/run', {
    commandId, name: 'rp-world-info-import', args: ` ${rawInput}`, source: { kind: 'user' },
  })
  const result = executeWorldInfoLibraryCommand(library, {
    agent: { session } as Agent,
    commandId,
    rawInput,
  })
  session.append('command/done', { commandId, ...result })

  const definition = createAgentRpProjectionDefinition(await EjsTemplateEngine.create())
  let state = definition.init()
  for (const event of session.events) state = definition.apply(state, event)
  const entry = definition.wire.view(state).worldInfo.books[0]?.entries[0]
  assert.equal(entry?.reason, 'template-error')
  assert.equal(entry?.template, 'runtime-error')
  assert.deepEqual({
    name: entry?.templateError?.name,
    message: entry?.templateError?.message,
  }, {
    name: 'ReferenceError',
    message: "'boundaryState' is not defined",
  })
  assert.match(entry?.templateError?.stack ?? '', /agent-rp:ejs/u)
})

test('deduplicates the same World Info bytes and rejects non-World-Info JSON', context => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-world-info-library-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const library = new WorldInfoLibrary({ root })
  const first = library.importFile({ data: source, filename: '海城.json' })
  const second = library.importFile({ data: source, filename: '副本.json' })
  assert.equal(second.id, first.id)
  assert.deepEqual(library.list(), [first])
  assert.equal(Buffer.from(library.asset(first.id).data).equals(source), true)
  assert.equal(library.asset(first.id).filename, '海城.json')
  assert.equal(first.defaultForNewSessions, false)
  assert.equal(library.setDefault(first.id, true).defaultForNewSessions, true)
  assert.deepEqual(new WorldInfoLibrary({ root }).defaultIds(), [first.id])
  assert.equal(library.setDefault(first.id, false).defaultForNewSessions, false)
  assert.throws(() => library.importFile({ data: Buffer.from('{"name":"not a book"}'), filename: 'wrong.json' }), /entries/u)
})

test('removes a reusable World Info source without invalidating an existing Session snapshot', context => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-world-info-library-remove-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const library = new WorldInfoLibrary({ root })
  const upload = library.importFile({ data: source, filename: '海城.json' })
  library.setDefault(upload.id, true)
  const session = Session.create(SessionId('removed-world-info'))
  const agent = { session } as Agent
  const commandId = CommandId('world-info-library-remove')
  const rawInput = JSON.stringify({ format: 0, importId: upload.id })
  session.append('command/run', {
    commandId, name: 'rp-world-info-import', args: ` ${rawInput}`, source: { kind: 'user' },
  })
  const result = executeWorldInfoLibraryCommand(library, { agent, commandId, rawInput })
  session.append('command/done', { commandId, ...result })

  assert.deepEqual(library.remove(upload.id), { ...upload, defaultForNewSessions: true })
  assert.deepEqual(library.list(), [])
  assert.deepEqual(library.defaultIds(), [])
  assert.throws(() => library.resolve(upload.id), /不可用/u)
  assert.equal(readActiveSessionWorldInfos(session.events)[0]?.result.name, '海城')
})
