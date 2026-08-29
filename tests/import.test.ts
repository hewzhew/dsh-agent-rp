import assert from 'node:assert/strict'
import test from 'node:test'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { encode as encodeTextChunk } from 'png-chunk-text'
import {
  MAX_CHARACTER_CARD_JSON_BYTES,
  parseCharacterCardJson,
  parseCharacterCardJsonBytes,
} from '../src/import/character-card.ts'
import { createEjsWorldInfoBooks, EjsTemplateEngine } from '../src/ejs-template.ts'
import { activateLorebook, inspectLorebook, inspectLorebooks } from '../src/import/lorebook.ts'
import { readCharacterCardPng } from '../src/import/png.ts'

const base = {
  name: '白露',
  description: '住在临海小城的钟表匠。',
  personality: '沉静，偶尔会开一个很轻的玩笑。',
  scenario: '傍晚的修理铺刚刚打烊。',
  first_mes: '门还没锁，你进来吧。',
  mes_example: '<START>\n{{char}}: 表走快了两分钟。',
} as const

function v2Data(extra: object = {}): object {
  return {
    ...base,
    creator_notes: '只供读者查看',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: ['今天来得很早。'],
    tags: ['slow-burn'],
    creator: 'fixture',
    character_version: '1.0',
    extensions: { 'fixture/unknown': { keep: true } },
    ...extra,
  }
}

function pngChunk(name: string, data: Uint8Array): Buffer {
  const type = Buffer.from(name, 'ascii')
  const payload = Buffer.from(data)
  const output = Buffer.alloc(12 + payload.length)
  output.writeUInt32BE(payload.length, 0)
  type.copy(output, 4)
  payload.copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([type, payload])), 8 + payload.length)
  return output
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function cardPng(payloads: ReadonlyArray<readonly [keyword: string, card: object]>): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const scanline = Buffer.from([0, 0, 0, 0])
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    ...payloads.map(([keyword, card]) => {
      const text = Buffer.from(JSON.stringify(card), 'utf8').toString('base64')
      const encoded = encodeTextChunk(keyword, text)
      return pngChunk(encoded.name, encoded.data)
    }),
    pngChunk('IDAT', deflateSync(scanline)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

test('imports V1 and preserves unknown JSON fields', () => {
  const raw = { ...base, custom_future_field: { nested: true } }
  const card = parseCharacterCardJson(JSON.stringify(raw))

  assert.equal(card.version, 1)
  assert.equal(card.name, '白露')
  assert.deepEqual(card.raw, raw)
  assert.deepEqual(card.alternateGreetings, [])
})

test('ignores malformed optional nicknames without rejecting or rewriting the card', () => {
  for (const nickname of [null, 42, { exporter: 'placeholder' }] as const) {
    const raw = { ...base, nickname }
    const card = parseCharacterCardJson(JSON.stringify(raw))

    assert.equal(card.nickname, undefined)
    assert.equal(card.name, '白露')
    assert.deepEqual(card.raw, raw)
  }
})

test('normalizes embedded lorebook depth injection without rewriting the card', () => {
  const raw = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: v2Data({
      character_book: {
        extensions: {},
        entries: [{
          keys: ['钟楼'],
          content: '这条内容使用聊天深度插入。',
          extensions: { position: 4 },
          position: 'after_char',
          enabled: true,
          insertion_order: 1,
        }],
      },
    }),
  }
  const card = parseCharacterCardJson(JSON.stringify(raw))

  assert.equal(card.lorebook?.entries[0]?.position, 'at_depth')
  assert.equal(card.lorebook?.entries[0]?.injectionDepth, 4)
  assert.equal(card.lorebook?.entries[0]?.injectionRole, 'system')
  assert.equal(card.lorebook?.entries[0]?.compatibilityBlockers, undefined)
  assert.equal(card.degradations.includes('lorebook-position'), false)
  assert.deepEqual(activateLorebook(card.lorebook!, ['去钟楼。']), {
    beforeCharacter: [],
    afterCharacter: [],
  })
  assert.deepEqual(inspectLorebook(card.lorebook!, ['去钟楼。']).inChat, [{
    role: 'system', content: '这条内容使用聊天深度插入。', depth: 4, order: 1,
  }])
  assert.deepEqual(card.raw, raw)
})

test('accepts exporter-style numeric positions in the character-book position field', () => {
  const raw = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: v2Data({
      character_book: {
        extensions: {},
        entries: [
          {
            keys: [], content: '角色之前。', extensions: {}, position: 0,
            enabled: true, insertion_order: 2,
          },
          {
            keys: [], content: '角色之后。', extensions: {}, position: 1,
            enabled: true, insertion_order: 1,
          },
          {
            keys: ['深度'], content: '需要指定深度注入。', extensions: {}, position: 4,
            enabled: true, insertion_order: 0,
          },
        ],
      },
    }),
  }
  const card = parseCharacterCardJson(JSON.stringify(raw))

  assert.deepEqual(card.lorebook?.entries.map(entry => entry.position), [
    'before_char', 'after_char', 'at_depth',
  ])
  assert.deepEqual(card.lorebook?.entries.map(entry => entry.compatibilityBlockers ?? []), [
    [], [], [],
  ])
  assert.deepEqual(card.raw, raw)
})

test('imports the complete Tavern Helper script tree and initial variables', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: v2Data({
      extensions: {
        tavern_helper: {
          variables: { theme: 'night' },
          legacy_ui: { theme: 'old' },
          scripts: [{
            type: 'script', id: 'inline', name: '状态同步', enabled: true,
            content: 'insertOrAssignVariables({ ready: true })', info: 'fixture', data: { runs: 1 },
            button: { enabled: true, buttons: [{ name: '刷新', visible: true }] },
          }, {
            type: 'folder', name: '关闭目录', enabled: false, scripts: [{
              type: 'script', id: 'nested', name: '不运行', enabled: true, content: 'throw new Error()',
            }],
          }],
        },
      },
    }),
  }))

  assert.deepEqual(card.frontend.tavernHelperScriptNames, ['状态同步'])
  assert.deepEqual(card.frontend.tavernHelperVariables, { theme: 'night' })
  assert.deepEqual(card.frontend.tavernHelperScripts, [{
    id: 'inline', name: '状态同步', content: 'insertOrAssignVariables({ ready: true })', info: 'fixture',
    enabled: true, buttonEnabled: true, buttons: [{ name: '刷新', visible: true }], data: { runs: 1 },
  }, {
    id: 'nested', name: '不运行', content: 'throw new Error()', info: '', enabled: false,
    buttonEnabled: true, buttons: [], data: {},
  }])
  assert.deepEqual(card.frontend.tavernHelper, {
    format: 'object', scriptCount: 2, enabledScriptCount: 1, variableCount: 1, ignoredFieldCount: 1,
  })
})

test('imports Tavern Helper extensions serialized as key-value entries', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: v2Data({
      extensions: {
        tavern_helper: [
          ['scripts', [{ id: 'entry-script', name: '条目脚本', content: 'eventOn("app_ready", run)', enabled: true }]],
          ['variables', { theme: 'entry-list' }],
          ['legacy_ui', { theme: 'old' }],
        ],
      },
    }),
  }))

  assert.deepEqual(card.frontend.tavernHelperScriptNames, ['条目脚本'])
  assert.deepEqual(card.frontend.tavernHelperVariables, { theme: 'entry-list' })
  assert.equal(card.frontend.tavernHelperScripts[0]?.id, 'entry-script')
  assert.deepEqual(card.frontend.tavernHelper, {
    format: 'entries', scriptCount: 1, enabledScriptCount: 1, variableCount: 1, ignoredFieldCount: 1,
  })
})

test('accepts regex substitution modes serialized with SillyTavern numeric coercion', () => {
  const script = {
    scriptName: '显示规则', findRegex: '/old/gu', replaceString: 'new', trimStrings: [], placement: [2],
    disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: false, minDepth: null, maxDepth: null,
  }
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: v2Data({
      extensions: {
        regex_scripts: [
          { ...script, substituteRegex: '2' },
          { ...script, scriptName: '旧式开关', substituteRegex: false },
          { ...script, scriptName: '空值', substituteRegex: null },
        ],
      },
    }),
  }))

  assert.deepEqual(card.frontend.regexScripts.map(item => item.substituteRegex), [2, 0, 0])
})

test('imports V2 lorebook and activates constant, primary, and selective entries', () => {
  const raw = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: v2Data({
      character_book: {
        name: '海城',
        token_budget: 100,
        recursive_scanning: false,
        extensions: { 'fixture/book': true },
        entries: [{
          id: null,
          keys: [],
          content: '海城终年多雾。',
          extensions: {},
          enabled: true,
          insertion_order: 10,
          constant: true,
          position: 'before_char',
        }, {
          keys: ['钟楼'],
          content: '旧钟楼每天午夜停摆一分钟。',
          extensions: {},
          enabled: true,
          insertion_order: 20,
        }, {
          keys: ['港口'],
          secondary_keys: ['蓝灯'],
          selective: true,
          content: '蓝灯是返航信号。',
          extensions: {},
          enabled: true,
          insertion_order: 30,
        }],
      },
    }),
  }
  const card = parseCharacterCardJson(JSON.stringify(raw))
  const active = activateLorebook(card.lorebook!, ['我们去钟楼看看。', '港口亮起了蓝灯。'])

  assert.deepEqual(active.beforeCharacter, ['海城终年多雾。'])
  assert.deepEqual(active.afterCharacter, ['旧钟楼每天午夜停摆一分钟。', '蓝灯是返航信号。'])
  assert.equal(card.lorebook?.entries[0]?.sourceId, '0')
  assert.deepEqual(card.raw, raw)
})

test('imports V3 while preserving and disabling unsafe optional behavior', () => {
  const raw = {
    spec: 'chara_card_v3',
    spec_version: '3.1',
    data: {
      ...v2Data({
        nickname: '露露',
        assets: [{ type: 'icon', uri: 'https://example.invalid/icon.png', name: 'main', ext: 'png' }],
        group_only_greetings: ['大家好。'],
        character_book: {
          extensions: {},
          recursive_scanning: true,
          entries: [{
            keys: ['^秘密$'],
            content: '正则不应执行。',
            extensions: {},
            enabled: true,
            insertion_order: 1,
            use_regex: true,
          }, {
            keys: ['旧港'],
            content: '@@depth 2\n装饰器不应执行。',
            extensions: {},
            enabled: true,
            insertion_order: 2,
            use_regex: false,
          }],
        },
      }),
      group_only_greetings: ['大家好。'],
    },
  }
  const card = parseCharacterCardJson(JSON.stringify(raw))

  assert.equal(card.version, 3)
  assert.equal(card.nickname, '露露')
  assert.deepEqual(card.degradations, [
    'character-assets',
    'future-card-version',
    'group-greetings',
    'lorebook-decorators',
    'lorebook-recursion',
    'remote-assets',
  ])
  assert.deepEqual(activateLorebook(card.lorebook!, ['秘密', '旧港']), {
    beforeCharacter: [],
    afterCharacter: [],
  })
  assert.deepEqual(card.raw, raw)
})

test('defaults omitted V3 prompt overrides while rejecting present non-string values', () => {
  const data = { ...v2Data(), group_only_greetings: [] } as Record<string, unknown>
  delete data.system_prompt
  delete data.post_history_instructions
  const raw = { spec: 'chara_card_v3', spec_version: '3.0', data }

  const card = parseCharacterCardJson(JSON.stringify(raw))

  assert.equal(card.systemPrompt, '')
  assert.equal(card.postHistoryInstructions, '')
  assert.deepEqual(card.raw, raw)
  assert.throws(() => parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2', spec_version: '2.0', data,
  })), /data\.system_prompt must be a string/u)
  assert.throws(() => parseCharacterCardJson(JSON.stringify({
    ...raw,
    data: { ...data, system_prompt: null },
  })), /data\.system_prompt must be a string/u)
})

test('activates Character Card V3 literal regex patterns without executing complex expressions', () => {
  const raw = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      ...v2Data({
        character_book: {
          extensions: {},
          entries: [{
            keys: ['飞行棋'],
            secondary_keys: [],
            selective: true,
            constant: false,
            content: '棋盘规则。',
            extensions: {},
            enabled: true,
            insertion_order: 1,
            use_regex: true,
          }],
        },
      }),
      group_only_greetings: [],
    },
  }
  const card = parseCharacterCardJson(JSON.stringify(raw))

  assert.equal(card.degradations.includes('lorebook-regex'), false)
  assert.deepEqual(activateLorebook(card.lorebook!, ['开始飞行棋。']), {
    beforeCharacter: [],
    afterCharacter: ['棋盘规则。'],
  })
})

test('prefers ccv3 over chara in a dual-metadata PNG', () => {
  const v2 = { spec: 'chara_card_v2', spec_version: '2.0', data: v2Data() }
  const v3 = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { ...v2Data({ name: 'V3 角色' }), group_only_greetings: [] },
  }
  const payload = readCharacterCardPng(cardPng([['chara', v2], ['ccv3', v3]]))
  const card = parseCharacterCardJson(payload.json)

  assert.equal(payload.keyword, 'ccv3')
  assert.equal(card.name, 'V3 角色')
})

test('renders charLoreBook and UTC Date from a synthetic V3 PNG card', async () => {
  const raw = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      ...v2Data({ name: '合成 EJS 角色' }),
      group_only_greetings: [],
      character_book: {
        name: '合成角色世界书',
        extensions: {},
        entries: [
          {
            id: 1,
            keys: [],
            secondary_keys: [],
            content: [
              '<% const day = new Date(Date.UTC(2024, 1, 29)); %>',
              '<%= charLoreBook %>|<%= await getwi(charLoreBook, "日期资料") %>|',
              '<%= [day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()].join("-") %>',
            ].join(''),
            enabled: true,
            insertion_order: 1,
            constant: true,
            selective: false,
            position: 'before_char',
            name: '日期控制器',
            use_regex: false,
            extensions: {},
          },
          {
            id: 2,
            keys: [],
            secondary_keys: [],
            content: '闰日有效',
            enabled: false,
            insertion_order: 2,
            constant: false,
            selective: false,
            position: 'before_char',
            name: '日期资料',
            use_regex: false,
            extensions: {},
          },
        ],
      },
    },
  }
  const payload = readCharacterCardPng(cardPng([['ccv3', raw]]))
  const card = parseCharacterCardJson(payload.json)
  const lorebook = card.lorebook
  if (lorebook?.name === undefined) assert.fail('synthetic V3 card lost its named lorebook')
  const engine = await EjsTemplateEngine.create()
  const books = [{ id: 'synthetic-card-book', name: lorebook.name, lorebook }]
  const inspected = inspectLorebooks(books, [], {
    renderTemplate: engine.createRenderer({
      characterName: card.name,
      userName: '测试用户',
      messages: [],
      characterWorldInfoBookName: lorebook.name,
      worldInfoBooks: createEjsWorldInfoBooks(books),
    }),
  })

  assert.equal(payload.keyword, 'ccv3')
  assert.deepEqual(inspected.beforeCharacter, ['合成角色世界书|闰日有效|2024-1-29'])
})

test('decodes large PNG character metadata without truncation', () => {
  const raw = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      ...v2Data({ creator_notes: 'x'.repeat(512 * 1024) }),
      group_only_greetings: [],
    },
  }
  const payload = readCharacterCardPng(cardPng([['ccv3', raw]]))

  assert.ok(payload.json.length > 512 * 1024)
  assert.equal(parseCharacterCardJson(payload.json).name, '白露')
})

test('rejects malformed transport and schema without partial fallback', () => {
  assert.throws(() => readCharacterCardPng(Buffer.from('not png')), /not a PNG/u)
  assert.throws(() => parseCharacterCardJson('{'), /not valid JSON/u)
  assert.throws(() => parseCharacterCardJson(JSON.stringify({ ...base, name: 3 })), /data.name must be a string/u)
  assert.throws(() => parseCharacterCardJson(JSON.stringify({ ...base, spec: 'unknown' })), /unsupported character card spec/u)
})

test('imports standalone UTF-8 JSON bytes and rejects invalid encoding', () => {
  const json = JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: v2Data(),
  })

  assert.equal(parseCharacterCardJsonBytes(Buffer.from(`\uFEFF${json}`, 'utf8')).name, '白露')
  assert.throws(() => parseCharacterCardJsonBytes(Uint8Array.from([0xc3, 0x28])), /valid UTF-8/u)
  assert.throws(
    () => parseCharacterCardJsonBytes(new Uint8Array(MAX_CHARACTER_CARD_JSON_BYTES + 1)),
    /角色卡定义内容过大.*8 MiB/u,
  )
})

test('keeps the manual standalone JSON card fixture importable', () => {
  const data = readFileSync('tests/fixtures/manual-character-card.json')
  const card = parseCharacterCardJsonBytes(data)

  assert.equal(card.name, '白露')
  assert.deepEqual((card.raw as { data: { extensions: object } }).data.extensions, {
    'fixture/unknown': { keep: true },
  })
})

test('honors zero lorebook scan depth and token budget', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: v2Data({
      character_book: {
        scan_depth: 0,
        token_budget: 0,
        extensions: {},
        entries: [{
          keys: [],
          content: '不应进入上下文',
          extensions: {},
          enabled: true,
          insertion_order: 1,
          constant: true,
        }],
      },
    }),
  }))

  assert.deepEqual(activateLorebook(card.lorebook!, ['任何对话']), { beforeCharacter: [], afterCharacter: [] })
})
