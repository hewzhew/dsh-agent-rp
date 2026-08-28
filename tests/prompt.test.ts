import assert from 'node:assert/strict'
import test from 'node:test'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import {
  renderCharacterPrompt,
  renderImportedChatPrompt,
  renderImportedLorebook,
  renderImportedWorldInfos,
  renderWorldInfoScenarioPrompt,
  renderMemoryContext,
  renderImportedCharacterPrompt,
  substituteCardMacros,
} from '../src/prompt.ts'
import { parseWorldInfoJson } from '../src/import/world-info.ts'

test('makes the top-level Agent the character and permits concise silence', () => {
  const prompt = renderCharacterPrompt(resolveConfig({ characterName: '小满' }))

  assert.match(prompt, /你是小满/u)
  assert.match(prompt, /不是旁白/u)
  assert.match(prompt, /短答、停顿或暂不追问/u)
  assert.match(prompt, /普通寒暄/u)
  assert.match(prompt, /当前场景、剧情进度、短期状态/u)
  assert.match(prompt, /不确定时保持原状/u)
  assert.doesNotMatch(prompt, /remember|supersedes/u)
  assert.match(prompt, /不存在的共同经历/u)
  assert.match(prompt, /不主动说“我记得”/u)
  assert.match(prompt, /默认通过回答、称呼或行动自然体现/u)
  assert.doesNotMatch(prompt, /狼人|主持人|子代理/u)
})

test('omits memory context when no durable memory exists', () => {
  assert.equal(renderMemoryContext([]), '')
})

test('continues an imported chat identity without the deployment default persona', () => {
  const prompt = renderImportedChatPrompt('白露', '宝宝')

  assert.match(prompt, /你是白露/u)
  assert.match(prompt, /名为宝宝/u)
  assert.match(prompt, /已导入的对话历史为准/u)
  assert.doesNotMatch(prompt, /岚|旧书修复铺/u)
})

test('adds a selected Persona to an imported chat without a Character Card', () => {
  const prompt = renderImportedChatPrompt('白露', '小满', '怕冷，喜欢旧书。')

  assert.match(prompt, /名为小满/u)
  assert.match(prompt, /怕冷，喜欢旧书/u)
})

test('lets standalone World Info own the roleplay identity without the deployment example character', () => {
  const prompt = renderWorldInfoScenarioPrompt(
    ['海城终年多雾。'],
    ['守钟人负责回应来访者。'],
    '旅人刚刚抵达海城。',
  )

  assert.match(prompt, /独立世界书启动/u)
  assert.match(prompt, /海城终年多雾/u)
  assert.match(prompt, /守钟人负责回应/u)
  assert.match(prompt, /旅人刚刚抵达海城/u)
  assert.match(prompt, /定义多角色、场景或叙事规则/u)
  assert.doesNotMatch(prompt, /岚|旧书修复铺/u)
})

test('resolves stable SillyTavern identity macros across imported card prose', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '白露',
      description: '{{char}}替{{user}}修表',
      personality: '<char>很安静',
      scenario: '<user>刚进门',
      first_mes: '{{user}}，门还没锁。',
      mes_example: '<START>\n<bot>: 坐吧，<user>。',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '{{char}}不要替{{user}}行动。',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '',
      extensions: {},
    },
  }))

  assert.equal(substituteCardMacros(card.firstMessage, card, '宝宝'), '宝宝，门还没锁。')
  const prompt = renderImportedCharacterPrompt(card, ['{{char}}知道钟楼。'], [], '宝宝')
  assert.match(prompt, /白露替宝宝修表/u)
  assert.match(prompt, /宝宝刚进门/u)
  assert.match(prompt, /白露: 坐吧，宝宝/u)
  assert.match(prompt, /白露不要替宝宝行动/u)
  assert.doesNotMatch(prompt, /\{\{(?:char|user)\}\}|<(?:char|bot|user)>/iu)
})

test('lets a text-only V3 card keep its identity entirely in embedded World Info', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '守钟人',
      description: '',
      personality: '  ',
      scenario: '',
      first_mes: '旅人终于抵达钟楼。',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: 'fixture',
      character_version: '1',
      extensions: {},
      character_book: {
        name: '钟楼剧情',
        recursive_scanning: false,
        extensions: {},
        entries: [
          {
            keys: [], secondary_keys: [], content: '海城终年多雾。', enabled: true,
            insertion_order: 1, constant: true, selective: true, position: 'after_char',
            name: '世界观', use_regex: true, extensions: {},
          },
          {
            keys: [], secondary_keys: [], content: '{{char}}负责守护钟楼。', enabled: true,
            insertion_order: 100, constant: true, selective: true, position: 'before_char',
            name: '角色设定', use_regex: true, extensions: {},
          },
          {
            keys: [], secondary_keys: [], content: '{{user}}是刚刚抵达的旅人。', enabled: true,
            insertion_order: 101, constant: true, selective: true, position: 'before_char',
            name: 'User设定', use_regex: true, extensions: {},
          },
          {
            keys: [], secondary_keys: [], content: '不要把设定条目复述给用户。', enabled: true,
            insertion_order: 2, constant: true, selective: true, position: 'after_char',
            name: '二次解释', use_regex: true, extensions: {},
          },
        ],
      },
    },
  }))
  const lore = renderImportedLorebook(card, Session.create(SessionId('text-only-card')))
  const prompt = renderImportedCharacterPrompt(card, lore.beforeCharacter, lore.afterCharacter, '旅人')

  assert.deepEqual(lore, {
    beforeCharacter: ['{{char}}负责守护钟楼。', '{{user}}是刚刚抵达的旅人。'],
    afterCharacter: ['海城终年多雾。', '不要把设定条目复述给用户。'],
  })
  assert.match(prompt, /你是守钟人/u)
  assert.match(prompt, /守钟人负责守护钟楼/u)
  assert.match(prompt, /旅人是刚刚抵达的旅人/u)
  assert.match(prompt, /海城终年多雾/u)
  assert.match(prompt, /不要把设定条目复述给用户/u)
  assert.doesNotMatch(prompt, /角色描述：|性格：|当前场景：/u)
})

test('resolves MVU state and removes unsupported Tavern macros before DSH interpolation', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '白露',
      description: '状态：{{format_message_variable::stat_data}}',
      personality: '未知：{{format_message_variable::stat/data}}',
      scenario: '',
      first_mes: '你好。',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '',
      extensions: {},
    },
  }))

  const withState = renderImportedCharacterPrompt(card, [], [], '宝宝', { trust: 3 })
  assert.match(withState, /trust: 3/u)
  assert.doesNotMatch(withState, /\{\{/u)
  assert.doesNotMatch(renderImportedCharacterPrompt(card, [], [], '宝宝'), /\{\{/u)
})

test('activates lorebook entries from the current message before it enters Session history', () => {
  const card = parseCharacterCardJson(JSON.stringify({
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
      character_book: {
        name: '钟楼',
        scan_depth: 10,
        token_budget: 100,
        recursive_scanning: false,
        extensions: {},
        entries: [{
          keys: ['旧钟楼'],
          secondary_keys: [],
          content: '旧钟楼每天午夜停摆一分钟。',
          enabled: true,
          insertion_order: 1,
          case_sensitive: false,
          priority: 1,
          id: 1,
          name: '旧钟楼',
          comment: '',
          selective: false,
          constant: false,
          position: 'before_char',
          extensions: {},
        }],
      },
      extensions: {},
    },
  }))
  const current = createUserMessage({
    content: [{ type: 'text', text: '旧钟楼怎么了？' }],
    source: { kind: 'user' },
  })

  assert.deepEqual(renderImportedLorebook(card, Session.create(SessionId('lore-current')), [current]), {
    beforeCharacter: ['旧钟楼每天午夜停摆一分钟。'],
    afterCharacter: [],
  })
})

test('budgets resolved MVU content in the legacy embedded-lore renderer', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '白露',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '你好。',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: 'fixture',
      character_version: '1',
      extensions: {},
      character_book: {
        name: '状态预算',
        token_budget: 12,
        recursive_scanning: false,
        extensions: {},
        entries: [
          {
            keys: [], secondary_keys: [], content: '{{format_message_variable::stat_data}}', enabled: true,
            insertion_order: 100, constant: true, selective: false, position: 'before_char',
            name: '完整状态', use_regex: false, extensions: {},
          },
          {
            keys: [], secondary_keys: [], content: '短', enabled: true,
            insertion_order: 10, constant: true, selective: false, position: 'before_char',
            name: '保底', use_regex: false, extensions: {},
          },
        ],
      },
    },
  }))

  assert.deepEqual(renderImportedLorebook(
    card,
    Session.create(SessionId('legacy-lore-resolved-budget')),
    [],
    { description: '这是一段展开后明显超过预算的状态文本' },
  ), {
    beforeCharacter: ['短'],
    afterCharacter: [],
  })
})

test('combines active entries from independent World Info books', () => {
  const first = parseWorldInfoJson(JSON.stringify({ entries: { 1: {
    key: [], keysecondary: [], content: '海城终年多雾。', constant: true, order: 1, position: 0,
  } } }))
  const second = parseWorldInfoJson(JSON.stringify({ entries: { 2: {
    key: ['钟楼'], keysecondary: [], content: '钟楼午夜停摆。', order: 1, position: 1,
  } } }))
  const current = createUserMessage({ content: [{ type: 'text', text: '去钟楼。' }], source: { kind: 'user' } })

  assert.deepEqual(renderImportedWorldInfos(
    [first, second], Session.create(SessionId('standalone-lore')), [current],
  ), {
    beforeCharacter: ['海城终年多雾。'],
    afterCharacter: ['钟楼午夜停摆。'],
  })
})
