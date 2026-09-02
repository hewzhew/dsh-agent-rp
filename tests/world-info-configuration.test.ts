import assert from 'node:assert/strict'
import test from 'node:test'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { parseWorldInfoJson } from '../src/import/world-info.ts'
import {
  characterWorldInfoBookName,
  configureWorldInfo,
  configuredLorebook,
  editableWorldInfoEntry,
  encodeWorldInfoConfiguration,
  parseWorldInfoConfigurationRequest,
  readWorldInfoConfiguration,
  worldInfoTokenBudget,
  type SessionLorebookSource,
} from '../src/world-info-configuration-core.ts'
import { sessionEvents } from '../src/session-events.ts'

function source(): SessionLorebookSource {
  const worldInfo = parseWorldInfoJson(JSON.stringify({ name: '海城', entries: {
    1: { uid: 1, key: ['钟楼'], content: '钟楼午夜停摆。', order: 1, position: 1 },
    2: { uid: 2, key: [], content: '海城终年多雾。', constant: true, order: 2, position: 0 },
  } }))
  return { id: 'standalone:fixture', name: '海城', source: 'standalone', lorebook: worldInfo.lorebook, degradations: [] }
}

test('resolves only the primary character World Info identity', () => {
  const standalone = source()
  const character = { ...source(), id: 'character:fixture', name: '角色主书', source: 'character' as const }

  assert.equal(characterWorldInfoBookName([standalone, character], undefined), '角色主书')
  assert.equal(characterWorldInfoBookName([standalone], undefined), undefined)
  assert.equal(characterWorldInfoBookName([character, standalone], {
    worldbookBindings: { character: { primary: '改绑世界书', additional: ['角色主书'] } },
  }), '改绑世界书')
  assert.equal(characterWorldInfoBookName([character, standalone], {
    worldbookBindings: { character: { primary: null, additional: ['角色主书'] } },
  }), undefined)
})

test('persists a complete editable World Info overlay without mutating imported entries', () => {
  const book = source()
  const original = book.lorebook.entries[0]!
  const initial = { format: 0, revision: 0, overrides: [] } as const
  const edited = configureWorldInfo(initial, parseWorldInfoConfigurationRequest(JSON.stringify({
    operation: 'edit', revision: 0, bookId: book.id, entryIndex: 0,
    entry: { ...editableWorldInfoEntry(original), name: '旧钟楼', content: '钟楼只在雨夜停摆。', enabled: false },
  })), [book])
  const removed = configureWorldInfo(edited, {
    operation: 'delete', revision: 1, bookId: book.id, entryIndex: 1, deleted: true,
  }, [book])
  const session = Session.create(SessionId('world-info-configuration'))
  session.append('command/done', {
    commandId: CommandId('world-info-1'), kind: 'success', text: encodeWorldInfoConfiguration(removed),
  })

  const restored = readWorldInfoConfiguration(sessionEvents(session))
  const configured = configuredLorebook(book, restored)
  assert.equal(configured.lorebook.entries[0]?.name, '旧钟楼')
  assert.equal(configured.lorebook.entries[0]?.content, '钟楼只在雨夜停摆。')
  assert.equal(configured.lorebook.entries[0]?.enabled, false)
  assert.equal(configured.lorebook.entries[1]?.enabled, false)
  assert.deepEqual([...configured.deleted], [1])
  assert.equal(original.content, '钟楼午夜停摆。')

  const reset = configureWorldInfo(restored, {
    operation: 'reset-all', revision: 2,
  }, [book])
  assert.deepEqual(configuredLorebook(book, reset).lorebook, book.lorebook)
})

test('keeps depth placement metadata through a session-local edit', () => {
  const worldInfo = parseWorldInfoJson(JSON.stringify({ name: '深度世界', entries: {
    1: {
      uid: 1, key: [], content: '插入最近一层历史。', constant: true,
      order: 88, position: 4, depth: 1, role: 2,
    },
  } }))
  const book: SessionLorebookSource = {
    id: 'standalone:depth', name: '深度世界', source: 'standalone',
    lorebook: worldInfo.lorebook, degradations: worldInfo.degradations,
  }
  const original = book.lorebook.entries[0]!
  const edited = configureWorldInfo({ format: 0, revision: 0, overrides: [] },
    parseWorldInfoConfigurationRequest(JSON.stringify({
      operation: 'edit', revision: 0, bookId: book.id, entryIndex: 0,
      entry: { ...editableWorldInfoEntry(original), content: '当前会话改写。' },
    })), [book])
  const configured = configuredLorebook(book, edited).lorebook.entries[0]

  assert.equal(configured?.position, 'at_depth')
  assert.equal(configured?.injectionDepth, 1)
  assert.equal(configured?.injectionRole, 'assistant')
  assert.equal(configured?.content, '当前会话改写。')
})

test('restoring an otherwise unchanged removed entry leaves no empty override', () => {
  const book = source()
  const removed = configureWorldInfo({ format: 0, revision: 0, overrides: [] }, {
    operation: 'delete', revision: 0, bookId: book.id, entryIndex: 0, deleted: true,
  }, [book])
  const restored = configureWorldInfo(removed, {
    operation: 'delete', revision: 1, bookId: book.id, entryIndex: 0, deleted: false,
  }, [book])

  assert.deepEqual(restored.overrides, [])
  assert.equal(restored.revision, 2)
})

test('normalizes empty overrides already persisted by an earlier build', () => {
  const session = Session.create(SessionId('world-info-empty-override'))
  session.append('command/done', {
    commandId: CommandId('world-info-empty'),
    kind: 'success',
    text: encodeWorldInfoConfiguration({
      format: 0,
      revision: 4,
      overrides: [{ bookId: 'standalone:fixture', entryIndex: 0, deleted: false }],
    }),
  })

  assert.deepEqual(readWorldInfoConfiguration(sessionEvents(session)), { format: 0, revision: 4, overrides: [] })
})

test('persists a bounded Session-wide token budget without resetting entry overlays', () => {
  const book = source()
  const edited = configureWorldInfo({ format: 0, revision: 0, overrides: [] }, {
    operation: 'toggle', revision: 0, bookId: book.id, entryIndex: 0, enabled: false,
  }, [book])
  const budgeted = configureWorldInfo(edited, {
    operation: 'set-budget', revision: 1, tokenBudget: 2_048,
  }, [book])

  assert.equal(worldInfoTokenBudget(budgeted), 2_048)
  assert.equal(budgeted.overrides.length, 1)
  assert.throws(() => parseWorldInfoConfigurationRequest(JSON.stringify({
    operation: 'set-budget', revision: 2, tokenBudget: 100_001,
  })), /过大/u)
})

test('adds no aggregate World Info cap until the player explicitly selects one', () => {
  const initial = { format: 0, revision: 0, overrides: [] } as const
  assert.equal(worldInfoTokenBudget(initial), undefined)

  const bounded = configureWorldInfo(initial, {
    operation: 'set-budget', revision: 0, tokenBudget: 4_096,
  }, [])
  assert.equal(worldInfoTokenBudget(bounded), 4_096)

  const unbounded = configureWorldInfo(bounded, {
    operation: 'set-budget', revision: 1, tokenBudget: 0,
  }, [])
  assert.equal(worldInfoTokenBudget(unbounded), undefined)
  assert.equal(Object.hasOwn(unbounded, 'tokenBudget'), false)
})

test('changes one whole book atomically and restores its imported state', () => {
  const book = source()
  const edited = configureWorldInfo({ format: 0, revision: 0, overrides: [] }, {
    operation: 'edit', revision: 0, bookId: book.id, entryIndex: 0,
    entry: { ...editableWorldInfoEntry(book.lorebook.entries[0]!), content: '保留这次会话的钟楼改写。' },
  }, [book])
  const removed = configureWorldInfo(edited, {
    operation: 'delete', revision: 1, bookId: book.id, entryIndex: 1, deleted: true,
  }, [book])
  const disabled = configureWorldInfo(removed,
    parseWorldInfoConfigurationRequest(JSON.stringify({
      operation: 'set-book-enabled', revision: 2, bookId: book.id, enabled: false,
    })), [book])

  assert.equal(disabled.revision, 3)
  assert.deepEqual(configuredLorebook(book, disabled).lorebook.entries.map(entry => entry.enabled), [false, false])
  assert.equal(configuredLorebook(book, disabled).lorebook.entries[0]?.content, '保留这次会话的钟楼改写。')
  assert.deepEqual([...configuredLorebook(book, disabled).deleted], [1])

  const restored = configureWorldInfo(disabled, parseWorldInfoConfigurationRequest(JSON.stringify({
    operation: 'reset-book', revision: 3, bookId: book.id,
  })), [book])
  assert.equal(restored.revision, 4)
  assert.deepEqual(restored.overrides, [])
  assert.deepEqual(configuredLorebook(book, restored).lorebook.entries.map(entry => entry.enabled), [true, true])
})
