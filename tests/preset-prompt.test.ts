import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ToolCallId,
  createAssistantMessage,
  createMessage,
  createToolResultMessage,
  createUserMessage,
  type Message,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ImportedSillyTavernPreset } from '../src/import/sillytavern-preset.ts'
import type { ImportedCharacterCard } from '../src/import/types.ts'
import {
  applySillyTavernContinuation,
  assembleSillyTavernPreset,
  injectSillyTavernInChatPrompts,
  injectSillyTavernPromptPlan,
  prepareSillyTavernProviderMessages,
  splitRoleplaySystemPrompt,
} from '../src/preset-prompt.ts'
import { EjsTemplateEngine } from '../src/ejs-template.ts'

const card: ImportedCharacterCard = {
  format: 0,
  version: 2,
  specVersion: '2.0',
  name: '白露',
  description: '{{char}}在修表。',
  personality: '安静但敏锐。',
  scenario: '{{user}}刚刚推门进来。',
  firstMessage: '门还没锁。',
  messageExample: '<START>\n{{char}}: 坐吧，{{user}}。',
  alternateGreetings: [],
  systemPrompt: '',
  postHistoryInstructions: '',
  frontend: { regexScripts: [], tavernHelperScriptNames: [], tavernHelperScripts: [], tavernHelperVariables: {} },
  degradations: [],
  raw: {},
}

test('assembles markers and nested variables on the correct side of chat history', () => {
  const prompts: ImportedSillyTavernPreset['prompts'] = [
    { identifier: 'variables', name: '变量', role: 'system', content: '{{setvar::tone::轻声}}{{setvar::line::{{getvar::tone}}回答}}', marker: false, systemPrompt: true, forbidOverrides: false },
    { identifier: 'comment', name: '注释', role: 'system', content: '{{// 不进入提示词}}', marker: false, systemPrompt: true, forbidOverrides: false },
    { identifier: 'worldInfoBefore', name: '世界书前', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'charDescription', name: '角色描述', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'charPersonality', name: '性格', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'scenario', name: '场景', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'personaDescription', name: '用户设定', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'dialogueExamples', name: '示例', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'chatHistory', name: '历史', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'after', name: '历史后', role: 'system', content: '{{getvar::line}}：{{lastUserMessage}}', marker: false, systemPrompt: true, forbidOverrides: false },
    { identifier: 'identity-aliases', name: '身份别名', role: 'system', content: '{{user}}/<user>/{{char}}/<char>/<bot>', marker: false, systemPrompt: true, forbidOverrides: false },
    { identifier: 'prefill', name: '回复前缀', role: 'assistant', content: 'OUTPUT', marker: false, systemPrompt: false, forbidOverrides: false },
    { identifier: 'in-chat', name: '聊天内注入', role: 'system', content: '暂不应进入请求', marker: false, systemPrompt: false, forbidOverrides: false, injectionPosition: 1, injectionDepth: 2, injectionOrder: 100 },
    { identifier: 'disabled', name: '关闭项', role: 'system', content: '绝不能出现', marker: false, systemPrompt: true, forbidOverrides: false },
  ]
  const preset: ImportedSillyTavernPreset = {
    format: 0,
    name: '测试预设',
    prompts,
    order: prompts.map(prompt => ({ identifier: prompt.identifier, enabled: prompt.identifier !== 'disabled' })),
    generation: {},
    formats: {
      worldInfo: '<world>{0}</world>',
      scenario: '<scenario>{{scenario}}</scenario>',
      personality: '<personality>{{personality}}</personality>',
    },
    regexScripts: [],
    extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: false },
  }
  const pending = createUserMessage({
    content: [{ type: 'text', text: '表为什么停了？' }],
    source: { kind: 'user' },
  })
  const assembled = assembleSillyTavernPreset(preset, {
    card,
    userName: '宝宝',
    userPersona: '怕冷。',
    worldInfoBefore: ['海城终年多雾。'],
    worldInfoAfter: [],
    session: Session.create(SessionId('preset-prompt')),
    pendingMessages: [pending],
  })
  const beforeText = assembled.beforeHistory.map(prompt => prompt.content).join('\n')
  const afterText = assembled.afterHistory.map(prompt => prompt.content).join('\n')

  assert.doesNotMatch(beforeText, /<world>海城终年多雾。<\/world>/u)
  assert.match(beforeText, /白露在修表/u)
  assert.match(beforeText, /<personality>安静但敏锐。<\/personality>/u)
  assert.match(beforeText, /<scenario>宝宝刚刚推门进来。<\/scenario>/u)
  assert.match(beforeText, /怕冷/u)
  assert.match(beforeText, /白露: 坐吧，宝宝/u)
  assert.match(`${beforeText}\n${afterText}`, /宝宝\/宝宝\/白露\/白露\/白露/u)
  assert.doesNotMatch(beforeText, /历史后|OUTPUT|暂不应进入请求|绝不能出现/u)
  assert.match(afterText, /轻声回答：表为什么停了/u)
  assert.match(afterText, /<world>海城终年多雾。<\/world>/u)
  assert.match(afterText, /OUTPUT/u)
  assert.deepEqual(assembled.afterHistory.map(prompt => prompt.role), ['system', 'system', 'system', 'assistant'])
  assert.doesNotMatch(`${beforeText}\n${afterText}`, /\{\{|不进入提示词|暂不应进入请求|绝不能出现/u)
  assert.deepEqual(assembled.inChat, [{
    role: 'system', content: '暂不应进入请求', depth: 2, order: 100,
  }])
  assert.equal(assembled.enabledPromptCount, 13)
  assert.equal(assembled.unsupportedMacroCount, 0)
  assert.equal(assembled.templateRenderCount, 0)
  assert.equal(assembled.templateFailureCount, 0)
})

test('keeps marker content when a preset intentionally leaves wrapper formats empty', () => {
  const prompts: ImportedSillyTavernPreset['prompts'] = [
    { identifier: 'worldInfoBefore', name: '世界书前', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'charPersonality', name: '性格', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'scenario', name: '场景', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'chatHistory', name: '历史', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
  ]
  const preset: ImportedSillyTavernPreset = {
    format: 0,
    name: '空格式预设',
    prompts,
    order: prompts.map(prompt => ({ identifier: prompt.identifier, enabled: true })),
    generation: {},
    formats: { worldInfo: '', scenario: '', personality: '' },
    regexScripts: [],
    extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: false },
  }

  const assembled = assembleSillyTavernPreset(preset, {
    card,
    userName: '宝宝',
    worldInfoBefore: ['海城终年多雾。'],
    worldInfoAfter: [],
    session: Session.create(SessionId('preset-empty-formats')),
  })
  const beforeText = assembled.beforeHistory.map(prompt => prompt.content).join('\n')
  const afterText = assembled.afterHistory.map(prompt => prompt.content).join('\n')

  assert.doesNotMatch(beforeText, /海城终年多雾。/u)
  assert.match(afterText, /海城终年多雾。/u)
  assert.match(beforeText, /安静但敏锐。/u)
  assert.match(beforeText, /宝宝刚刚推门进来。/u)
})

test('assembles a standalone World Info preset without inventing character-card marker text', () => {
  const prompts: ImportedSillyTavernPreset['prompts'] = [
    { identifier: 'main', name: '主提示', role: 'user', content: '{{char}}回应{{user}}', marker: false, systemPrompt: true, forbidOverrides: false },
    { identifier: 'worldInfoBefore', name: '世界书', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'charDescription', name: '角色描述', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'chatHistory', name: '历史', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
    { identifier: 'prefill', name: '续写', role: 'assistant', content: '继续剧情', marker: false, systemPrompt: false, forbidOverrides: false },
  ]
  const preset: ImportedSillyTavernPreset = {
    format: 0, name: '世界书预设', prompts,
    order: prompts.map(prompt => ({ identifier: prompt.identifier, enabled: true })),
    generation: {}, formats: { worldInfo: '<world>{0}</world>', scenario: '{0}', personality: '{0}' },
    regexScripts: [], extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: false },
  }

  const assembled = assembleSillyTavernPreset(preset, {
    characterName: '天琴座', userName: '旅人', worldInfoBefore: ['星港仍在运转。'], worldInfoAfter: [],
    session: Session.create(SessionId('world-info-preset')),
  })

  assert.deepEqual(assembled.beforeHistory, [
    { role: 'user', content: '天琴座回应旅人' },
  ])
  assert.deepEqual(assembled.afterHistory, [
    { role: 'system', content: '<world>星港仍在运转。</world>' },
    { role: 'assistant', content: '继续剧情' },
  ])
})

test('keeps changing world context behind the reusable dialogue prefix', () => {
  const history = [
    message('user', '第一步'),
    message('assistant', '已经走完'),
    message('user', '第二步'),
  ]
  const earlier = prepareSillyTavernProviderMessages(history, {
    beforeHistory: [{ role: 'system', content: '稳定角色契约' }],
    afterHistory: [{ role: 'system', content: '当前位置：机场' }],
    inChat: [],
    includeHistory: true,
  })
  const later = prepareSillyTavernProviderMessages([
    ...history,
    message('assistant', '棋子起飞'),
    message('user', '第三步'),
  ], {
    beforeHistory: [{ role: 'system', content: '稳定角色契约' }],
    afterHistory: [{ role: 'system', content: '当前位置：航线 3' }],
    inChat: [],
    includeHistory: true,
  })

  const signature = (messages: readonly Message[]) => messages.map(item => ({
    role: item.role,
    content: item.content,
  }))
  const text = (message: Message | undefined): string => {
    const block = message?.content[0]
    return block?.type === 'text' ? block.text : ''
  }
  assert.deepEqual(signature(later.slice(0, earlier.length - 1)), signature(earlier.slice(0, -1)))
  assert.equal(text(earlier.at(-1)), '当前位置：机场')
  assert.equal(text(later.at(-1)), '当前位置：航线 3')
})

test('keeps changing state after stable world context across continuous turns and tool transactions', () => {
  const stableRuntimeSnapshot = message(
    'user',
    'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n【长期记忆】钥匙藏在钟下。',
  )
  const history = [
    message('user', '第一轮'),
    stableRuntimeSnapshot,
    message('assistant', '第一轮完成'),
    message('user', '第二轮'),
  ]
  const longWorld = `【稳定世界书】${'海城终年多雾。'.repeat(2_000)}`
  const plan = (state: string) => ({
    beforeHistory: [{ role: 'system' as const, content: '稳定角色契约' }],
    afterHistory: [
      { role: 'system' as const, content: longWorld },
      { role: 'system' as const, content: `【本轮只读状态】${state}` },
    ],
    inChat: [],
    includeHistory: true,
  })
  const second = prepareSillyTavernProviderMessages(history, plan('回合=2'))
  const thirdHistory = [
    ...history,
    message('assistant', '第二轮完成'),
    message('user', '第三轮'),
  ]
  const thirdUnchanged = prepareSillyTavernProviderMessages(thirdHistory, plan('回合=2'))
  const thirdChanged = prepareSillyTavernProviderMessages(thirdHistory, plan('回合=3'))
  const signature = (value: Message): string => JSON.stringify({ role: value.role, content: value.content })
  const textOf = (value: Message | undefined): string | undefined => {
    const block = value?.content[0]
    return block?.type === 'text' ? block.text : undefined
  }
  const firstDifference = (left: readonly Message[], right: readonly Message[]): number => {
    const through = Math.min(left.length, right.length)
    for (let index = 0; index < through; index += 1) {
      if (signature(left[index]!) !== signature(right[index]!)) return index
    }
    return through
  }

  assert.equal(firstDifference(second, thirdUnchanged), 1 + history.length)
  assert.equal(firstDifference(thirdUnchanged, thirdChanged), thirdChanged.length - 1)
  assert.equal(textOf(thirdChanged.at(-2)), longWorld)

  const callId = ToolCallId('continuous-turn-tool')
  const call = createAssistantMessage({
    source: { provider: 'fixture', model: 'fixture' },
    content: [{ type: 'tool-call', id: callId, name: 'inspect_board', arguments: '{}' }],
  })
  const result = createToolResultMessage({
    callId,
    content: [{ type: 'text', text: '棋子位于航线 3' }],
    isError: false,
  })
  const withTool = prepareSillyTavernProviderMessages([...thirdHistory, call, result], plan('回合=3'))
  assert.deepEqual(withTool.slice(-2), [call, result])
  assert.match(textOf(withTool.at(-3)) ?? '', /【本轮只读状态】回合=3/u)
  assert.equal(textOf(withTool.at(-4)), longWorld)
})

test('moves only the leading system run into the reusable provider system field', () => {
  assert.deepEqual(splitRoleplaySystemPrompt({
    beforeHistory: [
      { role: 'system', content: '身份规则' },
      { role: 'system', content: '写作规则' },
      { role: 'user', content: '作者指令' },
      { role: 'system', content: '不得越过作者指令' },
    ],
    afterHistory: [],
    inChat: [],
    includeHistory: true,
  }), {
    systemPromptText: '身份规则\n\n写作规则',
    beforeHistory: [
      { role: 'user', content: '作者指令' },
      { role: 'system', content: '不得越过作者指令' },
    ],
  })
})

test('retains the authored module order when chat history is disabled', () => {
  const beforeHistory = [
    { role: 'system' as const, content: '系统规则' },
    { role: 'user' as const, content: '作者指令' },
  ]
  assert.deepEqual(splitRoleplaySystemPrompt({
    beforeHistory,
    afterHistory: [],
    inChat: [],
    includeHistory: false,
  }), { systemPromptText: '', beforeHistory })
})

test('preserves extension-owned macros while resolving nested built-ins and additive variables', () => {
  const prompts: ImportedSillyTavernPreset['prompts'] = [
    {
      identifier: 'variables', name: '变量', role: 'system', marker: false, systemPrompt: true, forbidOverrides: false,
      content: '{{setvar::style::自然}}{{addvar::style::流畅}}{{setvar::count::2}}{{addvar::count::3}}{{//扩展注释}}',
    },
    {
      identifier: 'extension-placeholder', name: '扩展占位', role: 'system', marker: false, systemPrompt: true, forbidOverrides: false,
      content: '{{压缩相邻消息::{{getvar::style}}::{{getvar::count}}}}',
    },
  ]
  const preset: ImportedSillyTavernPreset = {
    format: 0, name: '扩展宏预设', prompts,
    order: prompts.map(prompt => ({ identifier: prompt.identifier, enabled: true })),
    generation: {}, formats: { worldInfo: '{0}', scenario: '{0}', personality: '{0}' },
    regexScripts: [], extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: true },
  }

  const assembled = assembleSillyTavernPreset(preset, {
    card, worldInfoBefore: [], worldInfoAfter: [], session: Session.create(SessionId('extension-macro-handoff')),
  })

  assert.deepEqual(assembled.beforeHistory, [
    { role: 'system', content: '{{压缩相邻消息::自然流畅::5}}' },
  ])
  assert.equal(assembled.unsupportedMacroCount, 1)
})

test('replays random macros from the exact Session input boundary', () => {
  const prompts: ImportedSillyTavernPreset['prompts'] = [{
    identifier: 'random', name: '随机', role: 'system',
    content: '{{random::甲::乙::丙::丁}}/{{random::一::二::三::四}}',
    marker: false, systemPrompt: true, forbidOverrides: false,
  }]
  const randomPreset: ImportedSillyTavernPreset = {
    format: 0, name: '可重放随机预设', prompts,
    order: [{ identifier: 'random', enabled: true }],
    generation: {}, formats: { worldInfo: '{0}', scenario: '{0}', personality: '{0}' },
    regexScripts: [], extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: false },
  }
  const session = Session.create(SessionId('replayable-random-macros'))

  const first = assembleSillyTavernPreset(randomPreset, {
    card, worldInfoBefore: [], worldInfoAfter: [], session,
  })
  const replay = assembleSillyTavernPreset(randomPreset, {
    card, worldInfoBefore: [], worldInfoAfter: [], session,
  })

  assert.deepEqual(replay.beforeHistory, first.beforeHistory)
  assert.deepEqual(first.beforeHistory, [{ role: 'system', content: '乙/二' }])
})

test('resolves replay-safe card, persona, dialogue, and utility macros in preset modules', () => {
  const prompts: ImportedSillyTavernPreset['prompts'] = [{
    identifier: 'compat', name: '兼容宏', role: 'system', marker: false,
    systemPrompt: true, forbidOverrides: false,
    content: [
      '{{group}}|{{persona}}|{{charDescription}}|{{charPersonality}}|{{charScenario}}|{{mesExamplesRaw}}',
      '{{charVersion}}|{{charPrompt}}|{{charInstruction}}|{{greeting::1}}',
      '{{input}}|{{lastMessage}}|{{lastUserMessage}}|{{lastCharMessage}}|{{lastMessageId}}',
      '{{pick::甲::乙::丙}}|{{roll::1d6+2}}|甲{{newline::2}}乙|{{noop}}',
    ].join('\n'),
  }]
  const compatPreset: ImportedSillyTavernPreset = {
    format: 0, name: '兼容宏预设', prompts,
    order: [{ identifier: 'compat', enabled: true }],
    generation: {}, formats: { worldInfo: '{0}', scenario: '{0}', personality: '{0}' },
    regexScripts: [], extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: false },
  }
  const session = Session.create(SessionId('replay-safe-context-macros'))
  session.append('assistant/message', {
    turn: 0, step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: '旧回答' }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const pending = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '新问题' }] })

  const assembled = assembleSillyTavernPreset(compatPreset, {
    card: {
      ...card, systemPrompt: '系统 {{char}}', postHistoryInstructions: '结尾 {{user}}',
      alternateGreetings: ['早安，{{user}}。'], raw: { data: { character_version: 'Beta 2.8' } },
    },
    userName: '宝宝', userPersona: '怕冷。', worldInfoBefore: [], worldInfoAfter: [], session,
    pendingMessages: [pending],
  })
  const text = assembled.beforeHistory[0]?.content ?? ''

  assert.match(text, /^白露\|怕冷。\|白露在修表。\|安静但敏锐。\|宝宝刚刚推门进来。/u)
  assert.match(text, /Beta 2\.8\|系统 白露\|结尾 宝宝\|早安，宝宝。/u)
  assert.match(text, /新问题\|新问题\|新问题\|旧回答\|1/u)
  assert.match(text, /[甲乙丙]\|[3-8]\|甲\n\n乙\|$/u)
  assert.equal(assembled.unsupportedMacroCount, 0)
})

test('renders EJS in imported preset modules and drops only a failing module', async () => {
  const engine = await EjsTemplateEngine.create()
  const prompts: ImportedSillyTavernPreset['prompts'] = [
    { identifier: 'main', name: '主提示', role: 'system', content: '<% if (getvar("enabled")) { %><%= char %>回应<%- user %><% } %>', marker: false, systemPrompt: true, forbidOverrides: false },
    { identifier: 'broken', name: '坏模板', role: 'system', content: '<% while (true) {} %>', marker: false, systemPrompt: true, forbidOverrides: false },
  ]
  const preset: ImportedSillyTavernPreset = {
    format: 0,
    name: 'EJS 预设',
    prompts,
    order: prompts.map(prompt => ({ identifier: prompt.identifier, enabled: true })),
    generation: {},
    formats: { worldInfo: '{0}', scenario: '{0}', personality: '{0}' },
    regexScripts: [],
    extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: false },
  }
  const context = {
    characterName: '<白露>', userName: '<宝宝>', messages: [], variables: { enabled: true },
  }
  const assembled = assembleSillyTavernPreset(preset, {
    card,
    userName: '<宝宝>',
    worldInfoBefore: [],
    worldInfoAfter: [],
    session: Session.create(SessionId('preset-ejs')),
    renderTemplate: template => engine.render(template, context),
  })

  assert.deepEqual(assembled.beforeHistory, [{ role: 'system', content: '&lt;白露&gt;回应<宝宝>' }])
  assert.equal(assembled.templateRenderCount, 1)
  assert.equal(assembled.templateFailureCount, 1)
})

function message(role: Message['role'], text: string): Message {
  return createMessage({
    role,
    source: role === 'user' ? { kind: 'user' } : { kind: 'plugin', plugin: 'fixture' },
    content: [{ type: 'text', text }],
  })
}

function continueInstruction(): Message {
  return createUserMessage({
    source: {
      kind: 'plugin', plugin: 'dsh-agent-rp-generation', operation: 'continue', form: 'notice', summary: '正在续写',
    } as never,
    content: [{ type: 'text', text: '通用续写指令' }],
  })
}

test('moves the prior assistant reply to the request tail when continue prefill is enabled', () => {
  const continued = applySillyTavernContinuation([
    message('system', '系统规则'),
    message('user', '请开始'),
    message('assistant', '上一段回复'),
    continueInstruction(),
    message('system', '历史后模块'),
  ], {
    prefill: true, postfix: ' ', nudgePrompt: '不应发送',
  })

  assert.deepEqual(continued.map(item => [item.role, item.content[0]?.type === 'text' ? item.content[0].text : '']), [
    ['system', '系统规则'],
    ['user', '请开始'],
    ['system', '历史后模块'],
    ['assistant', '上一段回复 '],
  ])
})

test('uses the preset continuation nudge when assistant prefill is disabled', () => {
  const continued = applySillyTavernContinuation([
    message('user', '请开始'),
    message('assistant', '上一段回复'),
    continueInstruction(),
  ], {
    prefill: false, postfix: ' ', nudgePrompt: '从“{{lastChatMessage}}”后继续，不要重复。',
  })

  assert.deepEqual(continued.map(item => [item.role, item.content[0]?.type === 'text' ? item.content[0].text : '']), [
    ['user', '请开始'],
    ['assistant', '上一段回复'],
    ['system', '从“上一段回复”后继续，不要重复。'],
  ])
})

test('applies continuation after placing the complete prompt plan for the provider', () => {
  const prepared = prepareSillyTavernProviderMessages([
    message('user', '请开始'),
    message('assistant', '上一段回复'),
    continueInstruction(),
  ], {
    beforeHistory: [{ role: 'system', content: '历史前模块' }],
    afterHistory: [{ role: 'system', content: '历史后模块' }],
    inChat: [],
    includeHistory: true,
    continuation: { prefill: true, postfix: '\n', nudgePrompt: '不应发送' },
  })

  assert.deepEqual(prepared.map(item => [item.role, item.content[0]?.type === 'text' ? item.content[0].text : '']), [
    ['system', '历史前模块'],
    ['user', '请开始'],
    ['system', '历史后模块'],
    ['assistant', '上一段回复\n'],
  ])
})

test('inserts in-chat modules by depth, descending priority, and role', () => {
  const injected = injectSillyTavernInChatPrompts([
    message('user', '旧问题'),
    message('assistant', '旧回答'),
    message('user', '最新问题'),
  ], [
    { role: 'assistant', content: '低优先级助手', depth: 1, order: 100 },
    { role: 'system', content: '低优先级系统', depth: 1, order: 100 },
    { role: 'user', content: '高优先级用户', depth: 1, order: 200 },
    { role: 'system', content: '末尾提醒', depth: 0, order: 100 },
    { role: 'system', content: '更早提醒', depth: 9, order: 100 },
  ])

  assert.deepEqual(injected.map(item => ({
    role: item.role,
    text: item.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(''),
  })), [
    { role: 'system', text: '更早提醒' },
    { role: 'user', text: '旧问题' },
    { role: 'assistant', text: '旧回答' },
    { role: 'user', text: '高优先级用户' },
    { role: 'system', text: '低优先级系统' },
    { role: 'assistant', text: '低优先级助手' },
    { role: 'user', text: '最新问题' },
    { role: 'system', text: '末尾提醒' },
  ])
})

test('keeps a continuous chain of completed tool transactions at the request tail', () => {
  const firstCallId = ToolCallId('failed-image')
  const firstAssistant = createAssistantMessage({
    source: { provider: 'fixture', model: 'fixture' },
    content: [
      { type: 'text', text: '正文' },
      { type: 'tool-call', id: firstCallId, name: 'generate_roleplay_image', arguments: '{}' },
    ],
  })
  const firstResult = createToolResultMessage({
    callId: firstCallId,
    content: [{ type: 'text', text: 'Error: 图片服务没有配置' }],
    isError: true,
  })
  const secondCallId = ToolCallId('repeated-image')
  const secondAssistant = createAssistantMessage({
    source: { provider: 'fixture', model: 'fixture' },
    content: [
      { type: 'text', text: '继续正文' },
      { type: 'tool-call', id: secondCallId, name: 'generate_roleplay_image', arguments: '{}' },
    ],
  })
  const secondResult = createToolResultMessage({
    callId: secondCallId,
    content: [{ type: 'text', text: 'Error: 本回合已经尝试过图片生成' }],
    isError: true,
  })

  const prepared = prepareSillyTavernProviderMessages([
    message('user', '请生成插图'),
    firstAssistant,
    firstResult,
    secondAssistant,
    secondResult,
  ], {
    beforeHistory: [{ role: 'system', content: '历史前模块' }],
    afterHistory: [{ role: 'system', content: '历史后模块' }],
    inChat: [
      { role: 'system', content: '深度一', depth: 1, order: 100 },
      { role: 'system', content: '深度零', depth: 0, order: 100 },
    ],
    includeHistory: true,
  })

  assert.deepEqual(prepared.map(item => [
    item.role,
    item.content[0]?.type === 'text' ? item.content[0].text : item.content[0]?.type,
  ]), [
    ['system', '历史前模块'],
    ['system', '深度一'],
    ['user', '请生成插图'],
    ['system', '深度零'],
    ['system', '历史后模块'],
    ['assistant', '正文'],
    ['user', 'tool-result'],
    ['assistant', '继续正文'],
    ['user', 'tool-result'],
  ])
  assert.deepEqual(prepared.slice(-4), [firstAssistant, firstResult, secondAssistant, secondResult])
})

test('keeps ordinary preset roles on their original side of chat history', () => {
  const injected = injectSillyTavernPromptPlan([
    message('user', '历史问题'),
    message('assistant', '历史回答'),
    message('user', '当前问题'),
  ], {
    beforeHistory: [
      { role: 'system', content: '系统规则' },
      { role: 'user', content: '作者用户提示' },
    ],
    afterHistory: [{ role: 'assistant', content: '回复前缀' }],
    inChat: [{ role: 'system', content: '最近提醒', depth: 1, order: 100 }],
    includeHistory: true,
  })

  assert.deepEqual(injected.map(item => ({
    role: item.role,
    text: item.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(''),
  })), [
    { role: 'system', text: '系统规则' },
    { role: 'user', text: '作者用户提示' },
    { role: 'user', text: '历史问题' },
    { role: 'assistant', text: '历史回答' },
    { role: 'system', text: '最近提醒' },
    { role: 'user', text: '当前问题' },
    { role: 'assistant', text: '回复前缀' },
  ])
})

test('omits dialogue and in-chat injections when the chatHistory marker is disabled', () => {
  const injected = injectSillyTavernPromptPlan([
    message('user', '不应发送的历史'),
  ], {
    beforeHistory: [{ role: 'system', content: '无历史模式' }],
    afterHistory: [],
    inChat: [{ role: 'system', content: '依赖历史的注入', depth: 0, order: 100 }],
    includeHistory: false,
  })

  assert.deepEqual(injected.map(item => ({
    role: item.role,
    text: item.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(''),
  })), [{ role: 'system', text: '无历史模式' }])
})

test('keeps modules after a disabled chatHistory entry on the prompt side', () => {
  const preset: ImportedSillyTavernPreset = {
    format: 0, name: '无历史预设',
    prompts: [
      { identifier: 'main', name: '主提示', role: 'system', content: '主提示', marker: false, systemPrompt: true, forbidOverrides: false },
      { identifier: 'chatHistory', name: '历史', role: 'system', content: '', marker: true, systemPrompt: true, forbidOverrides: false },
      { identifier: 'tail', name: '尾部', role: 'user', content: '仍是预设提示', marker: false, systemPrompt: false, forbidOverrides: false },
    ],
    order: [
      { identifier: 'main', enabled: true },
      { identifier: 'chatHistory', enabled: false },
      { identifier: 'tail', enabled: true },
    ],
    generation: {}, formats: { worldInfo: '{0}', scenario: '{0}', personality: '{0}' },
    regexScripts: [], extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: false },
  }

  const assembled = assembleSillyTavernPreset(preset, {
    card, worldInfoBefore: [], worldInfoAfter: [], session: Session.create(SessionId('disabled-history')),
  })

  assert.equal(assembled.includeHistory, false)
  assert.deepEqual(assembled.beforeHistory, [
    { role: 'system', content: '主提示' },
    { role: 'user', content: '仍是预设提示' },
  ])
  assert.deepEqual(assembled.afterHistory, [])
})
