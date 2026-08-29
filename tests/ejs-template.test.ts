import assert from 'node:assert/strict'
import test from 'node:test'
import { createEjsWorldInfoBooks, EjsTemplateEngine } from '../src/ejs-template.ts'
import { inspectLorebook, inspectLorebooks } from '../src/import/lorebook.ts'
import type { ImportedLorebook } from '../src/import/types.ts'

const engine = await EjsTemplateEngine.create()

test('renders standard escaped, raw, statement, comment, and print tags', () => {
  const result = engine.render([
    '<%# hidden %><% if (getvar("mood") === "calm") { %>',
    '<%= char %> / <%- user %> / <% print(messages.length) %>',
    '<% } %>',
  ].join(''), {
    characterName: '<角色>',
    userName: '<用户>',
    messages: ['一', '二'],
    variables: { mood: 'calm' },
  })

  assert.deepEqual(result, { ok: true, text: '&lt;角色&gt; / <用户> / 2' })
})

test('settles self-contained async EJS without exposing Host callbacks', () => {
  const result = engine.render('<% const value = await Promise.resolve(6 * 7); %><%= value %>', {
    characterName: '角色', userName: '用户', messages: [],
  })

  assert.deepEqual(result, { ok: true, text: '42' })
})

test('bounds pending EJS and preserves rejected runtime errors for Debug reports', () => {
  assert.deepEqual(engine.render('<% await new Promise(() => {}); %>private pending text', {
    characterName: '角色', userName: '用户', messages: [],
  }), { ok: false, kind: 'execution-limit' })
  const rejected = engine.render('<% await Promise.reject(new Error("private rejection text")); %>', {
    characterName: '角色', userName: '用户', messages: [],
  })
  assert.equal(rejected.ok, false)
  if (rejected.ok) return
  assert.equal(rejected.kind, 'runtime-error')
  assert.deepEqual({ name: rejected.error?.name, message: rejected.error?.message }, {
    name: 'Error', message: 'private rejection text',
  })
  assert.match(rejected.error?.stack ?? '', /agent-rp:ejs/u)
})

test('bounds runtime-provided EJS error fields before projecting Debug details', () => {
  const result = engine.render('<% throw new Error("x".repeat(10_000)) %>', {
    characterName: '角色', userName: '用户', messages: [],
  })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.kind, 'runtime-error')
  assert.equal(result.error?.truncated, true)
  assert.ok((result.error?.message.length ?? Infinity) <= 2_001)
  assert.ok((result.error?.stack?.length ?? Infinity) <= 4_001)
})

test('bounds all templates rendered through one prompt context', () => {
  const render = engine.createRenderer({ characterName: '角色', userName: '用户', messages: [] })
  for (let index = 0; index < 256; index += 1) {
    assert.deepEqual(render('<%= char %>'), { ok: true, text: '角色' })
  }
  assert.deepEqual(render('<%= char %>'), { ok: false, kind: 'execution-limit' })
})

test('supports EJS whitespace slurping without changing ordinary text', () => {
  const result = engine.render('甲  <%_ const value = 2; _%>\n  乙<%= value %>\n丙<% -%>\n丁', {
    characterName: '角色', userName: '用户', messages: [],
  })

  assert.deepEqual(result, { ok: true, text: '甲乙2\n丙丁' })
})

test('emits escaped EJS delimiters as literal text', () => {
  assert.deepEqual(engine.render('<%%= user %%>', {
    characterName: '角色', userName: '用户', messages: [],
  }), { ok: true, text: '<%= user %>' })
})

test('does not expose Node, network, or module globals', () => {
  const result = engine.render('<%= [typeof process, typeof require, typeof fetch].join(",") %>', {
    characterName: '角色', userName: '用户', messages: [],
  })

  assert.deepEqual(result, { ok: true, text: 'undefined,undefined,undefined' })
})

test('reads nested merged variables and explicit scopes without allowing writes', () => {
  const result = engine.render('<%= getvar("stats.trust") %>/<%= getvar("stats.mood") %>/<%= getvar("stats.hp") %>/<%= getglobalvar("tone") %>/<%= getchatvar("tone") %>/<%= getvar("stat_data.hp") %>', {
    characterName: '角色',
    userName: '用户',
    messages: [],
    variableScopes: {
      global: { tone: 'global', stats: { trust: 1, mood: 'calm' } },
      chat: { tone: 'chat', stats: { trust: 3 } },
      message: { stats: { hp: 7 } },
    },
    statData: { hp: 9 },
  })

  assert.deepEqual(result, { ok: true, text: '3/calm/7/global/chat/9' })
})

test('exposes deterministic generation metadata and role-aware chat readers', () => {
  const result = engine.render([
    '<%= [charName, userName, runType, lastMessageId, lastUserMessageId, lastCharMessageId].join("|") %>\n',
    '<%= [lastUserMessage, lastCharMessage, getChatMessage(-1), getChatMessage(1, "assistant")].join("|") %>\n',
    '<%= getChatMessages(2).join(",") %>\n',
    '<%= getChatMessages(3, "user").join(",") %>\n',
    '<%= getChatMessages(1, 2).join(",") %>',
  ].join(''), {
    characterName: '角色',
    userName: '用户',
    messages: ['问一', '答一', '问二'],
    transcript: [
      { role: 'user', content: '问一' },
      { role: 'assistant', content: '答一' },
      { role: 'user', content: '问二' },
    ],
  })

  assert.deepEqual(result, {
    ok: true,
    text: '角色|用户|generate|2|2|1\n问二|答一|问二|答一\n答一,问二\n问一,问二\n答一,问二',
  })
})

test('supports EJS variable options and camel-case scope aliases as read-only snapshots', () => {
  const result = engine.render('<%= getvar("missing", { defaults: 5 }) %>/<%= typeof getvar("missing", { scope: "global" }) %>/<%= getvar("tone", { scope: "global" }) %>/<%= getLocalVar("tone") %>/<%= getCharacterVar("tone") %>', {
    characterName: '角色', userName: '用户', messages: [],
    variableScopes: { global: { tone: 'global' }, chat: { tone: 'chat' }, character: { tone: 'character' } },
  })

  assert.deepEqual(result, { ok: true, text: '5/undefined/global/chat/character' })
})

test('provides deterministic JSON-safe utility and YAML helpers', () => {
  const result = engine.render([
    '<% const value = { stats: { hp: 7, mood: "calm" }, items: ["a", "b"], empty: {} };',
    'const clone = _.cloneDeep(value); clone.stats.hp = 9;',
    'const mapped = _.mapValues({ a: 2, b: 3 }, number => number * 2);',
    'const transformed = _.transform({ a: 2, b: 3 }, (target, number, key) => { target[key] = number + 1; }, {}); %>',
    '<%- [_.get(value, "stats.hp"), _.get(value, "missing", 5), _.has(value, "stats.hp"), _.has(value, "missing"), clone.stats.hp, value.stats.hp,',
    '_.isEmpty(value.empty), JSON.stringify(_.pick(value, ["stats.hp", "items[1]"])),',
    'JSON.stringify(_.omit(value, "stats.mood")), JSON.stringify(mapped), JSON.stringify(transformed)].join("|") %>\n',
    '<%- YAML.stringify({ hp: 7, nested: { mood: "calm" }, items: ["a", "b"] }) %>',
  ].join(''), { characterName: '角色', userName: '用户', messages: [] })

  assert.deepEqual(result, {
    ok: true,
    text: [
      '7|5|true|false|9|7|true|{"stats":{"hp":7},"items":[null,"b"]}|{"stats":{"hp":7},"items":["a","b"],"empty":{}}|{"a":4,"b":6}|{"a":3,"b":4}',
      '"hp": 7',
      '"nested":',
      '  "mood": "calm"',
      '"items":',
      '  - "a"',
      '  - "b"',
      '',
    ].join('\n'),
  })
})

test('reads plain Session World Info by current or explicit book identity', () => {
  const context = {
    characterName: '角色', userName: '用户', messages: [],
    worldInfoBooks: [
      { id: 'book-one', name: '第一本', entries: [{ sourceId: '1', comment: '共享条目', content: '第一段' }] },
      { id: 'book-two', name: '第二本', entries: [{ sourceId: '2', comment: '共享条目', content: '第二段' }] },
    ],
  }
  const result = engine.render([
    '<%= await getWorldInfo("共享条目") %>|',
    '<%= await getWorldInfo("第二本", "共享条目") %>|',
    '<%= await getwi("不存在") %>',
  ].join(''), context, { worldInfoBookId: 'book-one' })

  assert.deepEqual(result, { ok: true, text: '第一段|第二段|' })
})

test('exposes only the primary character World Info name through charLoreBook', () => {
  const books = [
    { id: 'character-book', name: '角色内置书', entries: [{ sourceId: '1', name: '角色资料', content: '角色命中' }] },
    { id: 'global-book', name: '全局书', entries: [{ sourceId: '2', name: '角色资料', content: '全局命中' }] },
  ]
  const context = {
    characterName: '角色', userName: '用户', messages: [],
    characterWorldInfoBookName: '角色内置书',
    worldInfoBooks: books,
  }

  assert.deepEqual(engine.render([
    '<%= charLoreBook %>|',
    '<%= await getwi(charLoreBook, "角色资料") %>',
  ].join(''), context, { worldInfoBookId: 'global-book' }), {
    ok: true,
    text: '角色内置书|角色命中',
  })
  assert.deepEqual(engine.render('<%= typeof charLoreBook %>', {
    characterName: '角色', userName: '用户', messages: [], worldInfoBooks: books,
  }), { ok: true, text: 'undefined' })
})

test('provides a replayable Date without consulting the Host clock', () => {
  const replayTime = Date.UTC(2026, 0, 2, 3, 4, 5, 6)
  const template = [
    '<% const explicit = new Date(Date.UTC(2024, 1, 29, 12)); %>',
    '<%= [Date.now(), new Date().getTime(), Date(),',
    'explicit.getUTCFullYear(), explicit.getUTCMonth(), explicit.getUTCDate(), explicit.getUTCHours(),',
    'new Date("2025-06-07T08:09:10.011Z").toISOString(), new Date().constructor === Date,',
    'typeof Object.getPrototypeOf(Date).now].join("|") %>',
  ].join('')
  const context = { characterName: '角色', userName: '用户', messages: [], replayTime }
  const first = engine.render(template, context)

  assert.deepEqual(first, {
    ok: true,
    text: `${replayTime}|${replayTime}|Fri, 02 Jan 2026 03:04:05 GMT|2024|1|29|12|2025-06-07T08:09:10.011Z|true|undefined`,
  })
  assert.deepEqual(engine.render(template, context), first)
  assert.deepEqual(engine.render('<%= [Date.now(), new Date().toISOString(), Date()].join("|") %>', {
    characterName: '角色', userName: '用户', messages: [],
  }), { ok: true, text: '0|1970-01-01T00:00:00.000Z|Thu, 01 Jan 1970 00:00:00 GMT' })
})

test('rejects an unrendered nested World Info template with a Debug error', () => {
  const result = engine.render('<%= await getWorldInfo("嵌套") %>', {
    characterName: '角色', userName: '用户', messages: [],
    worldInfoBooks: [{
      id: 'book',
      entries: [{ sourceId: '1', comment: '嵌套', content: '<%= char %>的私密模板' }],
    }],
  }, { worldInfoBookId: 'book' })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.kind, 'resource-unsupported')
  assert.equal(result.error?.message, '__AGENT_RP_EJS_RESOURCE_UNSUPPORTED__')
})

test('keeps large resource reads separate from the final output limit', () => {
  const result = engine.render('<%= (await getWorldInfo("数据表")).length %>', {
    characterName: '角色', userName: '用户', messages: [],
    worldInfoBooks: [{
      id: 'book',
      entries: [{ sourceId: '1', comment: '数据表', content: 'x'.repeat(300 * 1024) }],
    }],
  }, { worldInfoBookId: 'book' })

  assert.deepEqual(result, { ok: true, text: String(300 * 1024) })
})

test('bounds cumulative World Info reads inside one isolated render', () => {
  const result = engine.render([
    '<% for (let index = 0; index < 129; index += 1) await getWorldInfo("数据表"); %>',
    'unreachable',
  ].join(''), {
    characterName: '角色', userName: '用户', messages: [],
    worldInfoBooks: [{
      id: 'book',
      entries: [{ sourceId: '1', comment: '数据表', content: 'x' }],
    }],
  }, { worldInfoBookId: 'book' })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.kind, 'resource-limit')
  assert.equal(result.error?.message, '__AGENT_RP_EJS_RESOURCE_LIMIT__')
})

test('retains current-book identity while inspecting several lorebooks', () => {
  const entry = (sourceId: string, content: string, enabled: boolean, comment?: string) => ({
    sourceId, ...(comment === undefined ? {} : { comment }), keys: [], secondaryKeys: [], content, enabled,
    insertionOrder: Number(sourceId), selective: false, constant: true, caseSensitive: false,
    matchWholeWords: false, secondaryLogic: 'and-any' as const, position: 'before_char' as const,
    ignoreBudget: false, useRegex: false, hasDecorators: false,
  })
  const books = [
    { id: 'one', lorebook: { recursiveScanning: false, entries: [
      entry('1', '<%= await getWorldInfo("共享") %>', true), entry('2', '第一本', false, '共享'),
    ] } },
    { id: 'two', lorebook: { recursiveScanning: false, entries: [
      entry('1', '<%= await getWorldInfo("共享") %>', true), entry('2', '第二本', false, '共享'),
    ] } },
  ] satisfies { id: string; lorebook: ImportedLorebook }[]
  const inspected = inspectLorebooks(books, [], {
    renderTemplate: engine.createRenderer({
      characterName: '角色', userName: '用户', messages: [],
      worldInfoBooks: createEjsWorldInfoBooks(books),
    }),
  })

  assert.deepEqual(inspected.beforeCharacter, ['第一本', '第二本'])
})

test('parses JSON context without treating special object keys as source syntax', () => {
  const variables = JSON.parse('{"__proto__":{"visible":"own value"}}') as Record<string, never>
  const result = engine.render('<%= getvar("__proto__.visible", "missing") %>', {
    characterName: '角色', userName: '用户', messages: [], variables,
  })

  assert.deepEqual(result, { ok: true, text: 'own value' })
})

test('interrupts non-terminating templates with a Debug error and classifies source errors', () => {
  const interrupted = engine.render('<% while (true) {} %>', {
    characterName: '角色', userName: '用户', messages: [],
  })
  assert.equal(interrupted.ok, false)
  if (!interrupted.ok) {
    assert.equal(interrupted.kind, 'execution-limit')
    assert.deepEqual({ name: interrupted.error?.name, message: interrupted.error?.message }, {
      name: 'InternalError', message: 'interrupted',
    })
  }
  const syntax = engine.render('<% if ( %>private fixture', {
    characterName: '角色', userName: '用户', messages: [],
  })
  assert.equal(syntax.ok, false)
  if (syntax.ok) return
  assert.equal(syntax.kind, 'syntax-error')
  assert.deepEqual({ name: syntax.error?.name, message: syntax.error?.message }, {
    name: 'SyntaxError', message: "expecting ')'",
  })
})

test('uses replayable turn entropy for EJS randomness and keeps unseeded renders deterministic', () => {
  const template = '<%= [Math.random(), Math.random()].join(",") %>'
  const context = { characterName: '角色', userName: '用户', messages: [], entropy: 'session:1:turn:2' }
  const first = engine.render(template, context)
  const replay = engine.render(template, context)
  const anotherTurn = engine.render(template, { ...context, entropy: 'session:1:turn:3' })

  assert.equal(first.ok, true)
  assert.deepEqual(replay, first)
  assert.notDeepEqual(anotherTurn, first)
  const unseeded = engine.render(template, {
    characterName: '角色', userName: '用户', messages: [],
  })
  assert.equal(unseeded.ok, false)
  if (unseeded.ok) return
  assert.equal(unseeded.kind, 'runtime-error')
  assert.equal(unseeded.error?.message, '__AGENT_RP_EJS_NONDETERMINISTIC__')
})

test('matches World Info regex in one isolated bounded runtime', () => {
  const matcher = engine.createRegexMatcher()
  try {
    assert.deepEqual(matcher.match(['/secret/iu', '^clock\\s+tower$', 'missing'], 'Secret\nclock tower', true), {
      ok: true,
      matchedKeys: ['/secret/iu'],
    })
    assert.deepEqual(matcher.match(['CLOCK'], 'clock tower', false), {
      ok: true,
      matchedKeys: ['CLOCK'],
    })
    assert.deepEqual(matcher.match(['/unterminated[/u'], 'text', true), { ok: false, kind: 'invalid' })
  } finally {
    matcher.dispose()
  }
})

test('interrupts catastrophic World Info regex without using the Host RegExp engine', () => {
  const matcher = engine.createRegexMatcher()
  try {
    assert.deepEqual(matcher.match(['/(a+)+$/'], `${'a'.repeat(20_000)}!`, true), {
      ok: false,
      kind: 'execution-limit',
    })
  } finally {
    matcher.dispose()
  }
})

test('activates regex World Info through the isolated matcher', () => {
  const book: ImportedLorebook = {
    recursiveScanning: false,
    entries: [{
      sourceId: 'regex', keys: ['/clock\\s+tower/iu'], secondaryKeys: [], content: '钟楼。', enabled: true,
      insertionOrder: 1, selective: false, constant: false, caseSensitive: true,
      matchWholeWords: false, secondaryLogic: 'and-any', position: 'before_char',
      ignoreBudget: false, useRegex: true, hasDecorators: false,
    }],
  }

  const inspected = inspectLorebook(book, ['去 Clock Tower。'], { regexEngine: engine })
  assert.deepEqual(inspected.beforeCharacter, ['钟楼。'])
  assert.equal(inspected.entries[0]?.reason, 'active-keyword')
})

test('activates rendered EJS lore and keeps failures out of the prompt', () => {
  const entry = (content: string, insertionOrder: number) => ({
    sourceId: String(insertionOrder), keys: [], secondaryKeys: [], content, enabled: true,
    insertionOrder, selective: false, constant: true, caseSensitive: false,
    matchWholeWords: false, secondaryLogic: 'and-any' as const, position: 'before_char' as const,
    ignoreBudget: false, useRegex: false, hasDecorators: false,
  })
  const book: ImportedLorebook = {
    recursiveScanning: false,
    entries: [
      entry('<% if (getvar("open")) { %><%= char %>看见了<%- user %>。<% } %>', 1),
      entry('<% while (true) {} %>', 2),
    ],
  }
  const inspected = inspectLorebook(book, ['开门。'], {
    renderTemplate: template => engine.render(template, {
      characterName: '<角色>', userName: '<用户>', messages: ['开门。'], variables: { open: true },
    }),
  })

  assert.deepEqual(inspected.beforeCharacter, ['&lt;角色&gt;看见了<用户>。'])
  assert.equal(inspected.entries[0]?.template, 'rendered')
  assert.equal(inspected.entries[1]?.reason, 'template-error')
  assert.equal(inspected.entries[1]?.template, 'execution-limit')
  assert.deepEqual({
    name: inspected.entries[1]?.templateError?.name,
    message: inspected.entries[1]?.templateError?.message,
  }, { name: 'InternalError', message: 'interrupted' })
})
