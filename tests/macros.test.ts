import assert from 'node:assert/strict'
import test from 'node:test'
import type { ImportedCharacterCard } from '../src/import/types.ts'
import { resolveMacros, type MacroMessage } from '../src/macros.ts'

const card: ImportedCharacterCard = {
  format: 0,
  version: 2,
  specVersion: '2.0',
  name: '白露',
  nickname: '露露',
  description: '钟表匠。',
  personality: '沉静。',
  scenario: '打烊前。',
  firstMessage: '门还没锁。',
  messageExample: '<START>\n{{char}}: 坐吧，{{user}}。',
  alternateGreetings: [],
  systemPrompt: '你是{{char}}。',
  postHistoryInstructions: '{{char}}不要替{{user}}行动。',
  frontend: { regexScripts: [], tavernHelperScriptNames: [], tavernHelperScripts: [], tavernHelperVariables: {} },
  degradations: [],
  raw: {},
}

test('resolves identity macros from the character card', () => {
  const result = resolveMacros(
    '{{char}} {{user}} {{group}} {{description}} {{personality}} {{scenario}} {{mesExamples}} {{version}} {{charPrompt}} {{charInstruction}}',
    { card, userName: '宝宝' },
  )
  assert.equal(
    result.text,
    '露露 宝宝 露露 钟表匠。 沉静。 打烊前。 <START>\n{{char}}: 坐吧，{{user}}。 2 你是{{char}}。 {{char}}不要替{{user}}行动。',
  )
  assert.equal(result.unsupported, 0)
})

test('resolves the persona macro from the user persona', () => {
  const result = resolveMacros('{{persona}}', { card, userName: '宝宝', persona: '怕冷。' })
  assert.equal(result.text, '怕冷。')
})

test('resolves clock macros with an injected point in time', () => {
  const now = new Date('2026-08-16T14:05:09')
  const result = resolveMacros(
    '{{time}} {{date}} {{weekday}} {{isotime}} {{isodate}} {{datetimeformat::YYYY年MM月DD日}} {{time::UTC+2}}',
    { card, userName: '宝宝', now },
  )
  assert.equal(result.text, '14:05 2026-08-16 Sunday 14:05 2026-08-16 2026年08月16日 16:05')
  assert.equal(result.unsupported, 0)
})

test('resolves chat-state macros from messages and pending input', () => {
  const messages: readonly MacroMessage[] = [
    { role: 'user', content: '旧问题' },
    { role: 'assistant', content: '旧回答' },
    { role: 'user', content: '最新问题' },
  ]
  const result = resolveMacros(
    '{{lastMessage}}|{{lastMessageId}}|{{lastUserMessage}}|{{lastCharMessage}}|{{input}}',
    { card, userName: '宝宝', messages, pendingInput: '正在输入' },
  )
  assert.equal(result.text, '最新问题|2|最新问题|旧回答|正在输入')
  assert.equal(result.unsupported, 0)
})

test('resolves random and utility macros', () => {
  const random = resolveMacros('{{random::苹果::香蕉::梨}}', { card, userName: '宝宝' })
  assert.match(random.text, /^苹果|香蕉|梨$/u)

  const roll = resolveMacros('{{roll::20}}', { card, userName: '宝宝' })
  assert.match(roll.text, /^\d+$/u)

  const dice = resolveMacros('{{roll::1d6}}', { card, userName: '宝宝' })
  assert.match(dice.text, /^[1-6]$/u)

  const newline = resolveMacros('甲{{newline}}乙', { card, userName: '宝宝' })
  assert.equal(newline.text, '甲\n乙')

  const repeated = resolveMacros('甲{{newline::3}}乙', { card, userName: '宝宝' })
  assert.equal(repeated.text, '甲\n\n\n乙')

  const noop = resolveMacros('甲{{noop}}乙', { card, userName: '宝宝' })
  assert.equal(noop.text, '甲乙')

  const trim = resolveMacros('甲{{trim}}乙', { card, userName: '宝宝' })
  assert.equal(trim.text, '甲乙')

  const comment = resolveMacros('甲{{// 注释}}乙', { card, userName: '宝宝' })
  assert.equal(comment.text, '甲乙')
})

test('picks deterministically from the same position in the same text', () => {
  const text = '甲{{pick::A::B::C}}乙'
  const first = resolveMacros(text, { card, userName: '宝宝' })
  const second = resolveMacros(text, { card, userName: '宝宝' })
  assert.match(first.text.slice(1, 2), /^A|B|C$/u)
  assert.equal(first.text, second.text)
})

test('resolves nested setvar and getvar macros', () => {
  const result = resolveMacros(
    '{{setvar::tone::轻声}}{{setvar::line::{{getvar::tone}}回答}}{{getvar::line}}',
    { card, userName: '宝宝' },
  )
  assert.equal(result.text, '轻声回答')
})

test('keeps unknown macros by default and drops them when requested', () => {
  const kept = resolveMacros('{{unknown_macro}}', { card, userName: '宝宝' })
  assert.equal(kept.text, '{{unknown_macro}}')
  assert.equal(kept.unsupported, 1)

  const dropped = resolveMacros('a{{unknown_macro}}b', { card, userName: '宝宝' }, { dropUnknown: true })
  assert.equal(dropped.text, 'ab')
  assert.equal(dropped.unsupported, 1)
})

test('resolves legacy angle-bracket identity forms', () => {
  const result = resolveMacros('<char> <bot> <user>', { card, userName: '宝宝' })
  assert.equal(result.text, '露露 露露 宝宝')
})

test('resolves the original macro', () => {
  const result = resolveMacros('{{original}}', { card, userName: '宝宝', original: '你是露露。' })
  assert.equal(result.text, '你是露露。')
})
