import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { EjsTemplateEngine } from '../src/ejs-template.ts'
import { activateLorebook, inspectLorebook, inspectLorebooks } from '../src/import/lorebook.ts'
import { parseWorldInfoJson, parseWorldInfoJsonBytes } from '../src/import/world-info.ts'
import {
  summarizeWorldEngineActivationReasons,
  summarizeWorldEngineFailures,
  summarizeWorldEngineResources,
  worldEngineFailureTotal,
} from '../src/world-engine-diagnostic.ts'
import { createNativeWorldEngine, summarizeWorldEngineResult } from '../src/world-engine.ts'
import { ReplayableRoleplayMacros } from '../src/roleplay-macro.ts'

function world(entries: object): string {
  return JSON.stringify({ name: '海城', entries, extensions: { 'fixture/unknown': true } })
}

test('imports a standalone SillyTavern World Info literal-key subset losslessly', () => {
  const json = world({
    10: {
      uid: 10,
      key: [],
      keysecondary: [],
      content: '海城终年多雾。',
      constant: true,
      selective: false,
      order: 20,
      position: 0,
      disable: false,
    },
    20: {
      uid: 20,
      key: ['钟楼'],
      keysecondary: ['午夜', '停摆'],
      content: '旧钟楼每天午夜停摆一分钟。',
      constant: false,
      selective: true,
      selectiveLogic: 3,
      order: 10,
      position: 1,
      disable: false,
      scanDepth: 2,
      caseSensitive: false,
      matchWholeWords: false,
    },
  })
  const book = parseWorldInfoJson(json)

  assert.equal(book.name, '海城')
  assert.deepEqual(book.degradations, [])
  assert.deepEqual((book.raw as { extensions: object }).extensions, { 'fixture/unknown': true })
  assert.deepEqual(activateLorebook(book.lorebook, ['钟楼在午夜停摆。']), {
    beforeCharacter: ['海城终年多雾。'],
    afterCharacter: ['旧钟楼每天午夜停摆一分钟。'],
  })
})

test('keeps the manual standalone World Info fixture importable', () => {
  const worldInfo = parseWorldInfoJsonBytes(readFileSync('tests/fixtures/manual-world-info.json'))

  assert.equal(worldInfo.name, '海城')
  assert.equal(worldInfo.lorebook.entries.length, 2)
  assert.deepEqual((worldInfo.raw as { extensions: object }).extensions, { 'fixture/book': true })
})

test('preserves but does not execute advanced World Info behavior', () => {
  const book = parseWorldInfoJson(world({
    regex: {
      key: ['/秘密/i'],
      keysecondary: [],
      content: '正则不应执行。',
      order: 1,
      position: 0,
    },
    decorated: {
      key: ['港口'],
      keysecondary: [],
      content: '@@depth 2\n装饰器不应执行。',
      order: 2,
      position: 1,
    },
    probability: {
      key: ['蓝灯'],
      keysecondary: [],
      content: '概率条目不应随机执行。',
      order: 3,
      position: 1,
      useProbability: true,
      probability: 50,
    },
    vector: {
      key: ['潮汐'],
      keysecondary: [],
      content: '向量条目不应执行。',
      order: 4,
      position: 1,
      vectorized: true,
    },
    timed: {
      key: ['船票'],
      keysecondary: [],
      content: '定时状态不应执行。',
      order: 5,
      position: 1,
      sticky: 2,
    },
    depth: {
      key: ['旧港'],
      keysecondary: [],
      content: '高级位置不应执行。',
      order: 6,
      position: 4,
    },
  }))

  assert.deepEqual(book.degradations, [
    'entry-decorators',
    'entry-probability',
    'timed-effects',
    'vector-matching',
  ])
  assert.equal(book.lorebook.entries.every(entry => entry.enabled), true)
  assert.deepEqual(book.lorebook.entries.map(entry => entry.compatibilityBlockers ?? []), [
    [],
    [],
    ['entry-probability'],
    ['vector-matching'],
    ['timed-effects'],
    [],
  ])
  assert.deepEqual(activateLorebook(book.lorebook, ['秘密 港口 蓝灯 潮汐 船票 旧港']), {
    beforeCharacter: [],
    afterCharacter: [],
  })
  assert.deepEqual(inspectLorebook(book.lorebook, ['秘密 港口 蓝灯 潮汐 船票 旧港']).entries.map(entry => entry.reason), [
    'regex-runtime-unavailable',
    'decorator-unsupported',
    'compatibility-unsupported',
    'compatibility-unsupported',
    'compatibility-unsupported',
    'active-keyword',
  ])
  assert.deepEqual(inspectLorebook(book.lorebook, ['秘密 港口 蓝灯 潮汐 船票 旧港']).inChat, [{
    role: 'system', content: '高级位置不应执行。', depth: 4, order: 6,
  }])
})

test('decodes standalone World Info as strict UTF-8 and rejects malformed entries', () => {
  const json = world({ 1: { key: [], content: '常驻', constant: true, order: 1, position: 0 } })

  assert.equal(parseWorldInfoJsonBytes(Buffer.from(`\uFEFF${json}`, 'utf8')).name, '海城')
  assert.throws(() => parseWorldInfoJsonBytes(Uint8Array.from([0xc3, 0x28])), /valid UTF-8/u)
  assert.throws(() => parseWorldInfoJson('{}'), /entries must be an object or array/u)
  assert.throws(() => parseWorldInfoJson(world({ bad: { key: 'not an array' } })), /entries.bad.key/u)
})

test('treats a null World Info uid as an omitted source identifier', () => {
  const book = parseWorldInfoJson(world({
    fallback: { uid: null, key: [], content: '常驻。', constant: true, order: 1, position: 0 },
  }))

  assert.equal(book.lorebook.entries[0]?.sourceId, 'fallback')
})

test('supports negative secondary logic and whole-word matching', () => {
  const book = parseWorldInfoJson(world({
    notAny: {
      key: ['港'],
      keysecondary: ['封航'],
      content: '港口仍然开放。',
      selective: true,
      selectiveLogic: 2,
      order: 1,
      position: 1,
      matchWholeWords: true,
    },
  }))

  assert.deepEqual(activateLorebook(book.lorebook, ['港口没有封航']), { beforeCharacter: [], afterCharacter: [] })
  assert.deepEqual(activateLorebook(book.lorebook, ['港 仍然开放']), { beforeCharacter: [], afterCharacter: ['港口仍然开放。'] })
})

test('keeps phrase keys literal when whole-word matching is enabled', () => {
  const book = parseWorldInfoJson(world({
    phrase: {
      key: ['old clock'],
      keysecondary: [],
      content: 'The old clock is imported.',
      order: 1,
      position: 1,
      matchWholeWords: true,
    },
  }))

  assert.deepEqual(activateLorebook(book.lorebook, ['an old clockmaker']), {
    beforeCharacter: [],
    afterCharacter: ['The old clock is imported.'],
  })
})

test('explains the same active entries used by prompt rendering', () => {
  const book = parseWorldInfoJson(world({
    constant: { key: [], content: '常驻。', constant: true, order: 30, position: 0 },
    matched: { key: ['钟楼'], content: '钟楼。', order: 20, position: 1 },
    absent: { key: ['港口'], content: '港口。', order: 10, position: 1 },
    regex: { key: ['/秘密/i'], content: '正则。', order: 0, position: 1 },
  }))
  const inspected = inspectLorebook(book.lorebook, ['去钟楼。'])

  assert.deepEqual({ beforeCharacter: inspected.beforeCharacter, afterCharacter: inspected.afterCharacter },
    activateLorebook(book.lorebook, ['去钟楼。']))
  assert.deepEqual(inspected.entries.map(entry => ({ active: entry.active, reason: entry.reason, keys: entry.matchedKeys })), [
    { active: true, reason: 'active-constant', keys: [] },
    { active: true, reason: 'active-keyword', keys: ['钟楼'] },
    { active: false, reason: 'primary-unmatched', keys: [] },
    { active: false, reason: 'regex-runtime-unavailable', keys: [] },
  ])
})

test('summarizes only World Info execution failures for content-free diagnostics', () => {
  const counts = summarizeWorldEngineFailures([
    'active-constant', 'active-keyword', 'primary-unmatched', 'secondary-unmatched',
    'budget-excluded', 'session-budget-excluded', 'regex-runtime-unavailable', 'regex-invalid',
    'regex-execution-limit', 'regex-resource-limit', 'decorator-unsupported',
    'template-unsupported', 'template-error',
  ])

  assert.deepEqual(counts, {
    regexRuntimeUnavailable: 1,
    regexInvalid: 1,
    regexExecutionLimit: 1,
    regexResourceLimit: 1,
    decoratorUnsupported: 1,
    templateUnsupported: 1,
    templateError: 1,
  })
  assert.equal(worldEngineFailureTotal(counts), 7)
})

test('summarizes every World Info activation reason without entry identity', () => {
  const counts = summarizeWorldEngineActivationReasons([
    'active-constant', 'active-keyword', 'primary-unmatched', 'primary-unmatched', 'deleted',
  ])
  assert.deepEqual(counts, {
    'active-constant': 1, 'active-keyword': 1, 'primary-unmatched': 2, deleted: 1,
  })
  assert.doesNotMatch(
    JSON.stringify(counts),
    /private|book-name|entry-id|content-text/u,
  )
})

test('counts bound World resources independently from visible non-deleted entry totals', () => {
  const summary = summarizeWorldEngineResources([
    {
      source: 'character',
      entries: [
        { enabled: true, deleted: false, reason: 'active-keyword' },
        { enabled: true, deleted: true, reason: 'deleted' },
      ],
    },
    { source: 'standalone', entries: [] },
  ])

  assert.deepEqual(summary, {
    bindings: { books: 2, character: 1, standalone: 1 },
    entries: 2,
    enabled: 1,
    active: 1,
    reasons: { 'active-keyword': 1, deleted: 1 },
  })
})

test('activates constant entries without evaluating their regex keywords', () => {
  const book = parseWorldInfoJson(world({
    constantRegex: {
      key: ['/unused/i'],
      content: '常驻内容。',
      constant: true,
      order: 1,
      position: 0,
    },
  }))
  const inspected = inspectLorebook(book.lorebook, [])

  assert.deepEqual(inspected.beforeCharacter, ['常驻内容。'])
  assert.equal(inspected.entries[0]?.reason, 'active-constant')
})

test('shares one final token budget across books using entry priority', () => {
  const low = parseWorldInfoJson(world({
    low: { key: [], content: '低优先级', constant: true, order: 1, position: 0 },
  }))
  const high = parseWorldInfoJson(world({
    high: { key: [], content: '高', constant: true, order: 100, position: 0 },
  }))
  const inspected = inspectLorebooks([
    { id: 'low', lorebook: low.lorebook },
    { id: 'high', lorebook: high.lorebook },
  ], [], { tokenBudget: 2 })

  assert.deepEqual(inspected.beforeCharacter, ['高'])
  assert.equal(inspected.approximateTokens, 1)
  assert.equal(inspected.books[0]?.inspected.entries[0]?.reason, 'session-budget-excluded')
  assert.equal(inspected.books[1]?.inspected.entries[0]?.reason, 'active-constant')
})

test('budgets the replay-safe macro result instead of its short source placeholder', () => {
  const source = parseWorldInfoJson(world({
    expanded: { key: [], content: '{{persona}}', constant: true, order: 100, position: 0 },
    compact: { key: [], content: '短', constant: true, order: 10, position: 0 },
  }))
  const macros = new ReplayableRoleplayMacros({
    userPersona: '很长的身份信息',
    entropy: 'world-budget-turn',
    stableEntropy: 'world-budget-session',
  })
  const result = createNativeWorldEngine({ renderMacro: value => macros.expand(value) }).evaluate({
    format: 0,
    books: [{ id: 'macro-world', lorebook: { ...source.lorebook, tokenBudget: 4 } }],
    messages: [],
  })

  assert.deepEqual(result.beforeCharacter, ['短'])
  assert.equal(result.books[0]?.inspected.entries[0]?.reason, 'budget-excluded')
  assert.equal(result.books[0]?.inspected.entries[0]?.approximateTokens, 7)
  assert.equal(result.books[0]?.inspected.entries[1]?.reason, 'active-constant')
})

test('resolves identity macros before compiling EJS World Info', async () => {
  const templateEngine = await EjsTemplateEngine.create()
  const source = parseWorldInfoJson(world({
    conditional: {
      key: [],
      content: '<% if (_.has(getvar("stat_data"), "<user>.trust")) { %><%= getvar("stat_data").<user>.trust %>:<user>/<char><% } %>',
      constant: true,
      order: 1,
      position: 0,
    },
  }))
  const result = createNativeWorldEngine({
    renderMacro: value => value.replaceAll('<user>', '旅人').replaceAll('<char>', '白露'),
    renderTemplate: template => templateEngine.render(template, {
      characterName: '白露', userName: '旅人', messages: [], statData: { 旅人: { trust: 7 } },
    }),
  }).evaluate({
    format: 0,
    books: [{ id: 'identity-template-world', lorebook: source.lorebook }],
    messages: [],
  })

  assert.deepEqual(result.beforeCharacter, ['7:旅人/白露'])
  assert.equal(result.books[0]?.inspected.entries[0]?.template, 'rendered')
})

test('keeps every matched book entry when no player-selected aggregate cap exists', () => {
  const system = parseWorldInfoJson(world({
    mvuSchema: { key: [], content: '变量结构'.repeat(3_000), constant: true, order: 100, position: 0 },
  }))
  const story = parseWorldInfoJson(world({
    opening: { key: [], content: '角色开始'.repeat(1_000), constant: true, order: 10, position: 1 },
  }))
  const inspected = inspectLorebooks([
    { id: 'system', lorebook: system.lorebook },
    { id: 'story', lorebook: story.lorebook },
  ], [])

  assert.equal(inspected.tokenBudget, undefined)
  assert.deepEqual(inspected.books.flatMap(book => book.inspected.entries).map(entry => entry.active), [true, true])
  assert.ok(inspected.approximateTokens > 4_096)
})

test('routes the native engine through a pure request and content-free diagnostic summary', () => {
  const source = parseWorldInfoJson(world({
    active: { key: [], content: 'Private active text.', constant: true, order: 2, position: 0 },
    absent: { key: ['Private keyword'], content: 'Private inactive text.', order: 1, position: 1 },
  }))
  const result = createNativeWorldEngine().evaluate({
    format: 0,
    books: [{ id: 'private-book-id', lorebook: source.lorebook }],
    messages: ['Unrelated private message'],
    tokenBudget: 32,
  })

  assert.deepEqual(result.beforeCharacter, ['Private active text.'])
  assert.deepEqual(summarizeWorldEngineResult(result), {
    engine: 'native-v0',
    books: 1,
    entries: 2,
    activeEntries: 1,
    promptContributions: 1,
    approximateTokens: 5,
    tokenBudget: 32,
    reasons: { 'active-constant': 1, 'primary-unmatched': 1 },
    templateOutcomes: {},
  })
  assert.doesNotMatch(JSON.stringify(summarizeWorldEngineResult(result)), /Private|book-id|message/u)
})
