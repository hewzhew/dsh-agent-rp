import assert from 'node:assert/strict'
import test from 'node:test'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { createEjsWorldInfoBooks, EjsTemplateEngine } from '../src/ejs-template.ts'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import { createCharacterCardSessionSeed } from '../src/import/character-card-seed.ts'
import { createPresetSessionSeed } from '../src/import/session-preset.ts'
import { parseSillyTavernChat } from '../src/import/sillytavern-chat.ts'
import { createSillyTavernChatSeed } from '../src/import/sillytavern-chat-seed.ts'
import type { ImportedSillyTavernPreset } from '../src/import/sillytavern-preset.ts'
import type { ImportedRegexScript } from '../src/import/types.ts'
import { parseWorldInfoJson } from '../src/import/world-info.ts'
import {
  appendWorldInfoLibrarySessionSeed,
  createWorldInfoLibrarySessionSeed,
} from '../src/import/world-info-seed.ts'
import { appendMvuState } from '../src/mvu.ts'
import {
  renderCharacterPrompt,
  renderImportedChatPrompt,
  renderImportedCharacterPrompt,
  renderMemoryContext,
  roleplayVisibleDialogue,
  roleplayVisibleTranscript,
} from '../src/prompt.ts'
import { assembleSillyTavernPreset, prepareSillyTavernProviderMessages } from '../src/preset-prompt.ts'
import { renderRoleplayTurnStateContext } from '../src/roleplay-runtime-context.ts'
import {
  prepareRoleplayTurn,
  resolveRoleplayPrepareModuleOutcomes,
  resolveRoleplayRecallModuleOutcomes,
} from '../src/roleplay-turn-plan.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import {
  appendTavernHelperState,
  applyTavernHelperMutation,
  initializeTavernHelperState,
  tavernInjectedScanText,
} from '../src/tavern-helper.ts'

const deployment = resolveConfig({ characterName: '岚' })

function attachment(id: string, name: string) {
  return {
    kind: 'file' as const,
    attachmentId: AttachmentId(`sha256:${id}`),
    bytes: 100,
    name,
    mediaType: 'application/json',
  }
}

function worldAsset(id: string, name: string, content: string) {
  const source = JSON.stringify({
    name,
    entries: {
      0: {
        uid: 0,
        key: [],
        keysecondary: [],
        content,
        constant: true,
        selective: false,
        order: 1,
        position: 0,
        disable: false,
      },
    },
  })
  return {
    upload: {
      id,
      name,
      entryCount: 1,
      degradations: [],
      defaultForNewSessions: false,
    },
    worldInfo: parseWorldInfoJson(source),
    filename: `${name}.json`,
    data: new TextEncoder().encode(source),
  }
}

function cardFixture(regexScripts: readonly ImportedRegexScript[] = [], includeMvuRules = false) {
  return parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '白露',
      description: '钟表匠',
      personality: '沉静',
      scenario: '修理铺打烊前',
      first_mes: '门还没锁。',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: 'fixture',
      character_version: '1',
      extensions: regexScripts.length === 0 ? {} : { regex_scripts: regexScripts },
      character_book: {
        name: '海城',
        recursive_scanning: false,
        extensions: {},
        entries: [
          {
            id: 1,
            keys: [],
            secondary_keys: [],
            content: '<%= getchatvar("weather") %>中的钟楼。',
            enabled: true,
            insertion_order: 1,
            constant: true,
            selective: false,
            position: 'before_char',
            name: '钟楼',
            use_regex: false,
            extensions: {},
          },
          {
            id: 2,
            comment: '[initvar]',
            keys: [],
            secondary_keys: [],
            content: '关系:\n  信任: 2',
            enabled: false,
            insertion_order: 2,
            constant: false,
            selective: false,
            position: 'after_char',
            use_regex: false,
            extensions: {},
          },
          ...(includeMvuRules ? [{
            id: 3,
            keys: ['__mvu_rules__'],
            secondary_keys: [],
            content: '变量更新规则：回复末尾输出 <UpdateVariable>。',
            enabled: true,
            insertion_order: 3,
            constant: false,
            selective: false,
            position: 'after_char',
            name: '变量更新规则',
            use_regex: false,
            extensions: {},
          }] : []),
        ],
      },
    },
  }))
}

function modularPreset(): ImportedSillyTavernPreset {
  const prompts: ImportedSillyTavernPreset['prompts'] = [
    {
      identifier: 'stable', name: '稳定前缀', role: 'system',
      content: '稳定系统前缀', marker: false,
      systemPrompt: true, forbidOverrides: false,
    },
    {
      identifier: 'main', name: '主提示', role: 'system',
      content: '主提示：<%= char %>/<%= getchatvar("weather") %>', marker: false,
      systemPrompt: true, forbidOverrides: false,
    },
    {
      identifier: 'worldInfoBefore', name: '世界前', role: 'system', content: '', marker: true,
      systemPrompt: true, forbidOverrides: false,
    },
    {
      identifier: 'in-chat', name: '深度提示', role: 'user', content: '预设深度注入', marker: false,
      systemPrompt: false, forbidOverrides: false, injectionPosition: 1, injectionDepth: 1, injectionOrder: 90,
    },
    {
      identifier: 'chatHistory', name: '历史', role: 'system', content: '', marker: true,
      systemPrompt: true, forbidOverrides: false,
    },
    {
      identifier: 'after', name: '历史后', role: 'assistant', content: '保持节奏', marker: false,
      systemPrompt: false, forbidOverrides: false,
    },
  ]
  return {
    format: 0,
    name: '潮汐预设',
    prompts,
    order: prompts.map(prompt => ({ identifier: prompt.identifier, enabled: true })),
    generation: { temperature: 0.72, maxTokens: 4096, reasoningEffort: 'medium', topP: 0.9 },
    continuation: { prefill: false, postfix: '\n', nudgePrompt: '请从 {{lastChatMessage}} 之后继续' },
    formats: { worldInfo: '<world>{0}</world>', scenario: '{0}', personality: '{0}' },
    regexScripts: [],
    extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: false },
  }
}

test('plans the minimal deployment character without changing its native prompt', () => {
  const session = Session.create(SessionId('turn-plan-native'))
  const resolved = resolveSessionRoleplayRuntime({
    session,
    deployment,
    memoryWriteAvailable: true,
  })
  const plan = prepareRoleplayTurn({ session, deployment, resolved })

  assert.equal(plan.format, 0)
  assert.deepEqual(plan.input, { sessionId: 'turn-plan-native', sessionSeq: 0, pendingMessageIds: [] })
  assert.equal(plan.prompt.systemPromptText, renderCharacterPrompt(deployment))
  assert.deepEqual(plan.prompt.beforeHistory, [])
  assert.deepEqual(plan.prompt.afterHistory, [])
  assert.deepEqual(plan.prompt.inChat, [])
  assert.equal(plan.prompt.includeHistory, true)
  assert.deepEqual(plan.world.resources, [])
  assert.deepEqual(plan.memory, {
    read: true,
    write: true,
    reads: [],
    contextText: renderMemoryContext(session.events, true),
  })
  assert.deepEqual(plan.recall.modules.find(module => module.moduleId === 'roleplay:memory'), {
    moduleId: 'roleplay:memory', outcome: 'idle', contributions: 0,
  })
  assert.deepEqual(plan.runtime.modules.find(module => module.id === 'roleplay:memory')?.phases,
    ['recall', 'act', 'settle'])
  assert.deepEqual(plan.runtime.modules.find(module => module.id === 'roleplay:agent')?.phases, ['act'])
})

test('requires one explicit outcome from every active prepare and recall module', () => {
  const session = Session.create(SessionId('turn-plan-module-contract'))
  const runtime = resolveSessionRoleplayRuntime({ session, deployment }).snapshot
  const prompt = { moduleId: 'roleplay:prompt', outcome: 'applied', contributions: 1 } as const
  const memory = { moduleId: 'roleplay:memory', outcome: 'idle', contributions: 0 } as const

  assert.deepEqual(resolveRoleplayPrepareModuleOutcomes(runtime, [prompt]), [prompt])
  assert.deepEqual(resolveRoleplayRecallModuleOutcomes(runtime, [memory]), [memory])
  assert.throws(
    () => resolveRoleplayRecallModuleOutcomes(runtime, []),
    /roleplay:memory did not declare/u,
  )
  assert.throws(
    () => resolveRoleplayRecallModuleOutcomes(runtime, [memory, memory]),
    /declared more than once/u,
  )
  assert.throws(
    () => resolveRoleplayRecallModuleOutcomes(runtime, [memory, {
      moduleId: 'adapter:missing', outcome: 'idle', contributions: 0,
    }]),
    /inactive module adapter:missing/u,
  )
  assert.throws(
    () => resolveRoleplayRecallModuleOutcomes(runtime, [{
      moduleId: 'roleplay:memory', outcome: 'idle', contributions: -1,
    }]),
    /invalid contribution count/u,
  )
})

test('freezes exact durable memory reads and context into recall', () => {
  const session = Session.create(SessionId('turn-plan-memory'), [{
    type: 'agent-rp/memory-seed',
    seq: 0,
    time: 1,
    data: {
      format: 0,
      sourceSessionId: 'older-roleplay-session',
      memories: [{ kind: 'preference', subject: '饮品', text: '用户喝咖啡时不加糖' }],
    },
  }])
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, deployment, resolved })

  assert.deepEqual(plan.memory.reads, [{ id: 'memory-seed-0-0', sourceEventSeq: 0 }])
  assert.equal(plan.memory.contextText, renderMemoryContext(session.events))
  assert.match(plan.memory.contextText, /用户喝咖啡时不加糖/u)
  assert.ok(plan.recall.modules.some(module => module.moduleId === 'roleplay:memory'
    && module.outcome === 'applied' && module.contributions === 1))

  session.append('agent-rp/memory-seed', {
    format: 0,
    sourceSessionId: 'later-roleplay-session',
    memories: [{ kind: 'fact', subject: '住处', text: '用户暂住海城' }],
  })
  assert.match(renderMemoryContext(session.events), /用户暂住海城/u)
  assert.doesNotMatch(plan.memory.contextText, /用户暂住海城/u)
})

test('keeps a standalone World Info launch actor-free and explains its activation', () => {
  const seed = createWorldInfoLibrarySessionSeed(worldAsset(
    'world-info-00000000000000000000000000000001',
    '天琴座',
    '星港仍在运转。守望者：{{group}}；路线：{{pick::东港::西港}}。',
  ))
  const session = Session.create(SessionId('turn-plan-scene'), seed)
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, deployment, resolved })

  assert.equal(plan.runtime.experience.mode, 'scene')
  assert.equal(plan.runtime.actor, undefined)
  assert.match(plan.world.experienceBeforeActor[0] ?? '', /^星港仍在运转。守望者：天琴座；路线：(东港|西港)。$/u)
  assert.deepEqual(plan.world.actorBefore, [])
  assert.equal(plan.world.resources[0]?.entries[0]?.entryId, '0')
  assert.equal(plan.world.resources[0]?.entries[0]?.reason, 'active-constant')
  assert.match(plan.prompt.systemPromptText, /本会话由独立世界书启动/u)
  assert.doesNotMatch(plan.prompt.systemPromptText, /星港仍在运转/u)
  assert.match(plan.prompt.afterHistory.map(item => item.content).join('\n'), /星港仍在运转/u)
  assert.doesNotMatch(plan.prompt.systemPromptText, /\{\{/u)
})

test('distinguishes idle prompt preparation from degraded EJS world recall', async () => {
  const engine = await EjsTemplateEngine.create()
  const plainSession = Session.create(SessionId('turn-plan-ejs-idle'))
  const plainResolved = resolveSessionRoleplayRuntime({
    session: plainSession,
    deployment,
    templateEngineAvailable: true,
  })
  const idle = prepareRoleplayTurn({
    session: plainSession,
    deployment,
    resolved: plainResolved,
    templateEngine: engine,
  })
  assert.deepEqual(idle.prepare.modules.find(module => module.moduleId === 'adapter:ejs'), {
    moduleId: 'adapter:ejs', outcome: 'idle', contributions: 0,
  })

  const seed = createWorldInfoLibrarySessionSeed(worldAsset(
    'world-info-00000000000000000000000000000004',
    '故障模板',
    '<%= missingRuntimeFunction() %>',
  ))
  const session = Session.create(SessionId('turn-plan-world-template-failure'), seed)
  const resolved = resolveSessionRoleplayRuntime({
    session,
    deployment,
    templateEngineAvailable: true,
  })
  const plan = prepareRoleplayTurn({ session, deployment, resolved, templateEngine: engine })

  assert.equal(plan.world.resources[0]?.entries[0]?.reason, 'template-error')
  assert.deepEqual(plan.recall.modules.find(module => module.moduleId === 'roleplay:world'), {
    moduleId: 'roleplay:world', outcome: 'idle', contributions: 0,
  })
  assert.deepEqual(plan.recall.modules.find(module => module.moduleId === 'adapter:ejs'), {
    moduleId: 'adapter:ejs', outcome: 'degraded', contributions: 1,
  })
})

test('continues an imported chat identity without falling back to the deployment actor', () => {
  const chat = parseSillyTavernChat([
    '{"user_name":"宝宝","character_name":"白露","chat_metadata":{}}',
    '{"name":"白露","mes":"门还没锁。","is_user":false,"is_system":false}',
    '{"name":"宝宝","mes":"那我进来啦。","is_user":true,"is_system":false}',
  ].join('\n'))
  let seed = createSillyTavernChatSeed(chat, {
    ...attachment('turn-plan-chat', '白露.jsonl'),
    mediaType: 'application/x-ndjson',
  })
  seed = appendWorldInfoLibrarySessionSeed(seed, worldAsset(
    'world-info-00000000000000000000000000000005',
    '导入聊天背景',
    '海城的潮汐正在上涨。',
  ))
  const session = Session.create(SessionId('turn-plan-chat'), seed)
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, deployment, resolved })

  assert.equal(plan.runtime.actor?.name, '白露')
  assert.equal(plan.runtime.actor?.adapter, 'sillytavern:chat')
  assert.equal(plan.prompt.systemPromptText, renderImportedChatPrompt('白露', '宝宝'))
  assert.doesNotMatch(plan.prompt.systemPromptText, /潮汐正在上涨/u)
  assert.match(plan.prompt.afterHistory.map(message => message.content).join('\n'), /潮汐正在上涨/u)
  assert.doesNotMatch(plan.prompt.systemPromptText, /你是岚/u)
})

test('preserves native card prompt ordering across experience and actor worlds', async () => {
  const card = cardFixture()
  let seed = createCharacterCardSessionSeed(
    card,
    attachment('turn-plan-native-card', '白露.json'),
    0,
    card.firstMessage,
    { transport: 'json' },
    '小满',
    { id: 'persona-00000000-0000-4000-8000-000000000010', name: '小满', description: '刚到海城的旅人。' },
  )
  seed = appendWorldInfoLibrarySessionSeed(seed, worldAsset(
    'world-info-00000000000000000000000000000002',
    '海城天气',
    '海城今晚有雾。',
  ))
  const session = Session.create(SessionId('turn-plan-native-card'), seed)
  const state = applyTavernHelperMutation(initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: [], tavernHelperScripts: [], tavernHelperVariables: {},
  }, 'turn-plan-native-card'), {
    format: 0, scope: 'chat', variables: { weather: '浓雾' },
  })
  appendTavernHelperState(session, state)
  appendMvuState(session, { statData: { 关系: { 信任: 3 } }, updateCount: 1 })
  const engine = await EjsTemplateEngine.create()
  const resolved = resolveSessionRoleplayRuntime({ session, deployment, templateEngineAvailable: true })
  const plan = prepareRoleplayTurn({ session, deployment, resolved, templateEngine: engine })
  const expected = renderImportedCharacterPrompt(
    resolved.card!,
    [],
    [],
    '小满',
    undefined,
    '刚到海城的旅人。',
    {
      regexEngine: engine,
      renderTemplate: engine.createRenderer({
        characterName: '白露', userName: '小满', messages: roleplayVisibleDialogue(session),
        transcript: roleplayVisibleTranscript(session), variableScopes: state.scopes,
        statData: resolved.mvu!.statData,
        worldInfoBooks: createEjsWorldInfoBooks(resolved.lorebooks.map(({ source, configured }) => ({
          id: source.id, name: source.name, lorebook: configured,
        }))),
      }),
    },
    undefined,
    true,
    true,
  )

  assert.deepEqual(plan.world.experienceBeforeActor, ['海城今晚有雾。'])
  assert.deepEqual(plan.world.actorBefore, ['浓雾中的钟楼。'])
  assert.equal(plan.prompt.systemPromptText, expected)
  assert.match(plan.prompt.systemPromptText, /角色描述：钟表匠/u)
  assert.doesNotMatch(plan.prompt.systemPromptText, /海城今晚有雾。|浓雾中的钟楼。/u)
  assert.match(plan.prompt.afterHistory.map(item => item.content).join('\n'), /海城今晚有雾。[\s\S]*浓雾中的钟楼。/u)
  assert.deepEqual(plan.stateReads.map(stateRead => [stateRead.id, stateRead.revision]), [
    ['state:mvu', 1], ['state:tavern-helper', state.revision],
  ])
})

test('keeps charLoreBook on the character source when standalone World Info is also active', async () => {
  const source = cardFixture()
  const raw = structuredClone(source.raw) as {
    data: { character_book: { entries: Array<Record<string, unknown>> } }
  }
  raw.data.character_book.entries[0]!.content = [
    '<%= charLoreBook %>|',
    '<%= await getwi(charLoreBook, "绑定资料") %>|',
    '<%= Date.now() %>',
  ].join('')
  raw.data.character_book.entries.push({
    id: 9,
    keys: [],
    secondary_keys: [],
    content: '角色绑定命中',
    enabled: false,
    insertion_order: 9,
    constant: false,
    selective: false,
    position: 'before_char',
    name: '绑定资料',
    use_regex: false,
    extensions: {},
  })
  const card = parseCharacterCardJson(JSON.stringify(raw))
  let seed = createCharacterCardSessionSeed(
    card,
    attachment('turn-plan-char-lorebook', '白露.json'),
    0,
    card.firstMessage,
    { transport: 'json' },
  )
  seed = appendWorldInfoLibrarySessionSeed(seed, worldAsset(
    'world-info-00000000000000000000000000000009',
    '独立规则书',
    '独立世界书内容。',
  ))
  const session = Session.create(SessionId('turn-plan-char-lorebook'), seed)
  const engine = await EjsTemplateEngine.create()
  const resolved = resolveSessionRoleplayRuntime({ session, deployment, templateEngineAvailable: true })
  const plan = prepareRoleplayTurn({ session, deployment, resolved, templateEngine: engine })
  const replayTime = session.events.at(-1)?.time ?? 0

  assert.deepEqual(plan.world.actorBefore, [`海城|角色绑定命中|${replayTime}`])
  assert.deepEqual(plan.world.experienceBeforeActor, ['独立世界书内容。'])
})

test('routes active world depth entries through the shared provider-message plan', () => {
  const source = cardFixture()
  const raw = structuredClone(source.raw) as {
    data: { character_book: { entries: Array<Record<string, unknown>> } }
  }
  raw.data.character_book.entries.push({
    id: 3,
    keys: [],
    secondary_keys: [],
    content: '深度一的玩家侧世界提示。',
    enabled: true,
    insertion_order: 77,
    constant: true,
    selective: false,
    position: 'after_char',
    use_regex: false,
    extensions: { position: 4, depth: 1, role: 1 },
  })
  const card = parseCharacterCardJson(JSON.stringify(raw))
  const seed = createCharacterCardSessionSeed(
    card,
    attachment('turn-plan-world-depth', '白露.json'),
    0,
    card.firstMessage,
    { transport: 'json' },
  )
  const session = Session.create(SessionId('turn-plan-world-depth'), seed)
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, deployment, resolved })

  assert.deepEqual(plan.world.inChat, [{
    role: 'user', content: '深度一的玩家侧世界提示。', depth: 1, order: 77,
  }])
  assert.deepEqual(plan.prompt.inChat, plan.world.inChat)
  const messages = prepareSillyTavernProviderMessages([
    createMessage({
      role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '较早消息' }],
    }),
    createMessage({
      role: 'assistant', source: { kind: 'plugin', plugin: 'fixture' },
      content: [{ type: 'text', text: '最近消息' }],
    }),
  ], plan.prompt)
  assert.deepEqual(messages.map(message => [message.role, message.content[0]?.type === 'text'
    ? message.content[0].text : '']), [
    ['user', '较早消息'],
    ['user', '深度一的玩家侧世界提示。'],
    ['assistant', '最近消息'],
    ['system', renderRoleplayTurnStateContext(plan)],
  ])
  assert.deepEqual(plan.recall.modules.find(module => module.moduleId === 'roleplay:world'), {
    moduleId: 'roleplay:world', outcome: 'applied', contributions: 1,
  })
})

test('uses the shared replay-safe macro boundary for a native card turn', () => {
  const source = cardFixture()
  const raw = structuredClone(source.raw) as { data: Record<string, unknown> }
  Object.assign(raw.data, {
    description: '同行者：{{persona}}',
    scenario: '路线：{{pick::钟楼::港口::旧街}}',
    system_prompt: '{{char}}听见{{user}}说：{{input}} / {{lastUserMessage}}',
    post_history_instructions: '角色版本：{{charVersion}}；骰点：{{roll::1d6}}；{{extension-owned}}',
  })
  const card = parseCharacterCardJson(JSON.stringify(raw))
  const persona = {
    id: 'persona-00000000-0000-4000-8000-000000000030',
    name: '小满',
    description: '刚到海城的旅人。',
  }
  const seed = createCharacterCardSessionSeed(
    card,
    attachment('turn-plan-native-macros', '白露.json'),
    0,
    card.firstMessage,
    { transport: 'json' },
    persona.name,
    persona,
  )
  const session = Session.create(SessionId('turn-plan-native-macros'), seed)
  const pending = createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: '今晚去哪里？' }],
  })
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })

  const first = prepareRoleplayTurn({ session, pendingMessages: [pending], deployment, resolved })
  const replay = prepareRoleplayTurn({ session, pendingMessages: [pending], deployment, resolved })
  const later = prepareRoleplayTurn({
    session,
    pendingMessages: [createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: '明晚去哪里？' }],
    })],
    deployment,
    resolved,
  })
  const turnText = first.prompt.afterHistory.map(message => message.content).join('\n')
  const laterTurnText = later.prompt.afterHistory.map(message => message.content).join('\n')

  assert.equal(replay.prompt.systemPromptText, first.prompt.systemPromptText)
  assert.equal(later.prompt.systemPromptText, first.prompt.systemPromptText)
  assert.doesNotMatch(first.prompt.systemPromptText, /今晚去哪里|明晚去哪里|骰点/u)
  assert.match(turnText, /白露听见小满说：今晚去哪里？ \/ 今晚去哪里？/u)
  assert.match(turnText, /同行者：刚到海城的旅人。/u)
  assert.match(turnText, /路线：(钟楼|港口|旧街)/u)
  assert.match(turnText, /角色版本：1；骰点：[1-6]/u)
  assert.doesNotMatch(turnText, /\{\{/u)
  assert.match(laterTurnText, /明晚去哪里/u)
  assert.notEqual(laterTurnText, turnText)
  assert.equal(first.prompt.diagnostics.unsupportedMacros, 1)
})

test('compiles modular prompts, EJS, MVU, generation, and script injections into one plan', async () => {
  const card = cardFixture([{
    scriptName: '角色输出净化', findRegex: '/raw/gu', replaceString: 'clean', trimStrings: [],
    placement: [2], disabled: false, markdownOnly: false, promptOnly: false,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: 4,
  }], true)
  const persona = {
    id: 'persona-00000000-0000-4000-8000-000000000020',
    name: '小满',
    description: '刚到海城的旅人。',
  }
  let seed = createCharacterCardSessionSeed(
    card,
    attachment('turn-plan-modular-card', '白露.json'),
    0,
    card.firstMessage,
    { transport: 'json' },
    persona.name,
    persona,
  )
  seed = appendWorldInfoLibrarySessionSeed(seed, worldAsset(
    'world-info-00000000000000000000000000000003',
    '海城天气',
    '海城今晚有雾。',
  ))
  const basePreset = modularPreset()
  const preset: ImportedSillyTavernPreset = {
    ...basePreset,
    regexScripts: [{
      scriptName: '策略输入净化', findRegex: '/secret/gu', replaceString: '{{user}}', trimStrings: ['x'],
      placement: [1, 9], disabled: false, markdownOnly: false, promptOnly: true,
      runOnEdit: false, substituteRegex: 2, minDepth: 1, maxDepth: null,
    }],
    extensionSummary: { ...basePreset.extensionSummary, regexScriptCount: 1 },
  }
  seed = createPresetSessionSeed(seed, preset, attachment('turn-plan-preset', '潮汐预设.json'))
  const session = Session.create(SessionId('turn-plan-modular'), seed)
  const frontend = {
    regexScripts: [],
    tavernHelperScriptNames: ['状态同步'],
    tavernHelperVariables: {},
    tavernHelperScripts: [{
      id: 'state', name: '状态同步', content: '', info: '', enabled: true,
      buttonEnabled: false, buttons: [], data: {},
    }],
  }
  let state = initializeTavernHelperState(frontend, 'turn-plan-modular-card')
  state = applyTavernHelperMutation(state, {
    format: 0, scope: 'chat', variables: { weather: '浓雾' },
  })
  state = applyTavernHelperMutation(state, {
    format: 0,
    operation: 'replace-script-injections',
    scriptScope: 'character',
    scriptId: 'state',
    prompts: [
      {
        id: 'before-story', position: 'before', depth: 0, role: 'system',
        content: '脚本前置注入', shouldScan: false, once: false,
      },
      {
        id: 'next-request', position: 'in_chat', depth: 0, role: 'system',
        content: '脚本本轮注入', shouldScan: true, once: false,
      },
      {
        id: 'after-story', position: 'after', depth: 0, role: 'system',
        content: '脚本后置注入', shouldScan: false, once: false,
      },
    ],
  })
  appendTavernHelperState(session, state)
  appendMvuState(session, { statData: { 关系: { 信任: 4 } }, updateCount: 2 })
  const pending = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '钟楼怎么了？' }],
  })
  const engine = await EjsTemplateEngine.create()
  const resolved = resolveSessionRoleplayRuntime({
    session,
    deployment,
    memoryWriteAvailable: true,
    templateEngineAvailable: true,
  })
  const plan = prepareRoleplayTurn({
    session,
    pendingMessages: [pending],
    deployment,
    resolved,
    templateEngine: engine,
  })
  const books = resolved.lorebooks.map(({ source, configured }) => ({
    id: source.id, name: source.name, lorebook: configured,
  }))
  const direct = assembleSillyTavernPreset(preset, {
    card: resolved.card!,
    userName: persona.name,
    userPersona: persona.description,
    worldInfoBefore: [...plan.world.experienceBeforeActor, ...plan.world.actorBefore],
    worldInfoAfter: [...plan.world.actorAfter, ...plan.world.experienceAfterActor],
    session,
    pendingMessages: [pending],
    mvuEnabled: true,
    renderTemplate: engine.createRenderer({
      characterName: '白露',
      userName: persona.name,
      messages: [...roleplayVisibleDialogue(session, [pending]), ...tavernInjectedScanText(state)],
      transcript: roleplayVisibleTranscript(session, [pending]),
      variableScopes: state.scopes,
      statData: resolved.mvu!.statData,
      worldInfoBooks: createEjsWorldInfoBooks(books),
    }),
  })

  assert.equal(plan.prompt.systemPromptText, '稳定系统前缀')
  assert.deepEqual(direct.beforeHistory, [{ role: 'system', content: '稳定系统前缀' }])
  assert.deepEqual(plan.prompt.beforeHistory, [])
  assert.deepEqual(plan.prompt.afterHistory, [
    { role: 'system', content: '脚本前置注入' },
    ...direct.afterHistory,
    { role: 'system', content: '脚本后置注入' },
    { role: 'system', content: renderRoleplayTurnStateContext(plan) },
  ])
  assert.deepEqual(plan.prompt.continuation, direct.continuation)
  assert.deepEqual(plan.prompt.inChat.slice(0, direct.inChat.length), direct.inChat)
  assert.deepEqual(plan.prompt.inChat.at(-1), {
    role: 'system', content: '脚本本轮注入', depth: 0, order: 100,
  })
  assert.deepEqual(plan.prompt.transforms, {
    actorName: '白露',
    participantName: '小满',
    operations: [
      {
        engine: 'regex-v0', owner: 'prompt-policy', ownerIndex: 0, name: '策略输入净化',
        pattern: '/secret/gu', replacement: '{{user}}', trim: ['x'], placements: ['user-input'],
        enabled: true, phase: 'prompt-only', identitySubstitution: 'escaped', minDepth: 1,
      },
      {
        engine: 'regex-v0', owner: 'actor', ownerIndex: 0, name: '角色输出净化', pattern: '/raw/gu',
        replacement: 'clean', trim: [], placements: ['assistant-output'], enabled: true, phase: 'shared',
        identitySubstitution: 'none', maxDepth: 4,
      },
    ],
  })
  assert.deepEqual(plan.act, {
    strategy: 'conversation',
    responseRepairs: [{
      engine: 'mvu-v0', moduleId: 'adapter:mvu', stateId: 'state:mvu',
      updateInstructions: '变量更新规则：回复末尾输出 <UpdateVariable>。',
    }],
    stateActions: [],
  })
  assert.deepEqual(plan.stateReads.find(read => read.id === 'state:mvu'), {
    id: 'state:mvu', owner: 'session', adapter: 'sillytavern:mvu', revision: 2,
    writerModuleId: 'adapter:mvu', value: { 关系: { 信任: 4 } },
  })
  assert.match(plan.prompt.afterHistory.map(item => item.content).join('\n'), /主提示：白露\/浓雾/u)
  assert.match(plan.prompt.afterHistory.map(item => item.content).join('\n'), /海城今晚有雾。[\s\S]*浓雾中的钟楼/u)
  assert.match(plan.prompt.afterHistory.map(item => item.content).join('\n'), /UpdateVariable/u)
  assert.deepEqual(plan.generation, preset.generation)
  assert.deepEqual(plan.input.pendingMessageIds, [String(pending.id)])
  assert.equal(plan.runtime.participant?.id, persona.id)
  assert.equal(plan.runtime.memory.write, true)
  assert.deepEqual(plan.prepare.modules.find(module => module.moduleId === 'adapter:prompt-modules'), {
    moduleId: 'adapter:prompt-modules', outcome: 'applied', contributions: direct.enabledPromptCount + 1,
  })
  assert.deepEqual(plan.prepare.modules.find(module => module.moduleId === 'adapter:mvu'), {
    moduleId: 'adapter:mvu', outcome: 'applied', contributions: 1,
  })
  assert.deepEqual(plan.prepare.modules.find(module => module.moduleId === 'adapter:tavern-helper'), {
    moduleId: 'adapter:tavern-helper', outcome: 'applied', contributions: 3,
  })
  assert.deepEqual(plan.recall.modules.find(module => module.moduleId === 'adapter:tavern-helper'), {
    moduleId: 'adapter:tavern-helper', outcome: 'applied', contributions: 1,
  })
  assert.deepEqual(plan.prepare.modules.find(module => module.moduleId === 'adapter:ejs'), {
    moduleId: 'adapter:ejs', outcome: 'applied',
    contributions: direct.templateRenderCount + direct.templateFailureCount,
  })
  assert.deepEqual(plan.recall.modules.find(module => module.moduleId === 'adapter:ejs'), {
    moduleId: 'adapter:ejs', outcome: 'applied',
    contributions: plan.world.resources.flatMap(resource => resource.entries)
      .filter(entry => entry.template !== undefined).length,
  })
})
