/** Shared SillyTavern macro resolution for model-visible roleplay text. */

import type { ImportedCharacterCard } from './import/types.ts'

/** One role-preserving message used by chat-state macros. */
export interface MacroMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/** Context available to SillyTavern-style macros during one resolution pass. */
export interface MacroEnv {
  readonly card?: ImportedCharacterCard
  readonly userName?: string
  readonly persona?: string
  readonly original?: string
  readonly pendingInput?: string
  readonly messages?: readonly MacroMessage[]
  readonly now?: Date
  readonly variables?: Map<string, string>
}

/** Resolution options for one macro pass. */
export interface ResolveMacrosOptions {
  /** Drop unknown macros instead of keeping their literal syntax. */
  readonly dropUnknown?: boolean
}

/** Result of one macro resolution pass. */
export interface ResolveMacrosResult {
  readonly text: string
  readonly unsupported: number
}

const MAX_MACRO_DEPTH = 100

interface ResolutionState {
  readonly variables: Map<string, string>
  unsupported: number
}

function characterName(card?: ImportedCharacterCard): string {
  return card === undefined ? '' : card.nickname?.trim() || card.name
}

function macroClose(value: string, open: number): number | undefined {
  let depth = 0
  for (let index = open; index < value.length - 1; index += 1) {
    const pair = value.slice(index, index + 2)
    if (pair === '{{') {
      depth += 1
      index += 1
      continue
    }
    if (pair !== '}}') continue
    depth -= 1
    index += 1
    if (depth === 0) return index + 1
  }
  return undefined
}

function macroParts(source: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < source.length - 1; index += 1) {
    const pair = source.slice(index, index + 2)
    if (pair === '{{') {
      depth += 1
      index += 1
      continue
    }
    if (pair === '}}') {
      depth = Math.max(0, depth - 1)
      index += 1
      continue
    }
    if (pair !== '::' || depth !== 0) continue
    parts.push(source.slice(start, index))
    start = index + 2
    index += 1
  }
  parts.push(source.slice(start))
  return parts
}

function applyUtcOffset(date: Date, source: string): Date | undefined {
  const match = /^UTC([+-]\d+)$/iu.exec(source)
  if (match === null) return undefined
  const offset = Number(match[1])
  if (!Number.isFinite(offset)) return undefined
  return new Date(date.getTime() + offset * 3_600_000)
}

function formatDate(date: Date, format: string): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = date.getHours()
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  const tokens: Readonly<Record<string, string>> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: date.toLocaleString('en-US', { month: 'long' }),
    MMM: date.toLocaleString('en-US', { month: 'short' }),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    dddd: date.toLocaleString('en-US', { weekday: 'long' }),
    ddd: date.toLocaleString('en-US', { weekday: 'short' }),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    HH: pad(hours),
    H: String(hours),
    hh: pad(hour12),
    h: String(hour12),
    mm: pad(date.getMinutes()),
    m: String(date.getMinutes()),
    ss: pad(date.getSeconds()),
    s: String(date.getSeconds()),
    A: hours < 12 ? 'AM' : 'PM',
    a: hours < 12 ? 'am' : 'pm',
  }
  const longestFirst = Object.keys(tokens).sort((left, right) => right.length - left.length)
  const pattern = new RegExp(longestFirst.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  return format.replace(pattern, token => tokens[token] ?? token)
}

function resolveTime(name: string, parts: readonly string[], env: MacroEnv): string {
  const now = env.now ?? new Date()
  const argument = parts.join('::').trim()
  if (name === 'time') {
    const shifted = applyUtcOffset(now, argument)
    return formatDate(shifted ?? now, 'HH:mm')
  }
  if (name === 'date') return formatDate(now, 'YYYY-MM-DD')
  if (name === 'weekday') return formatDate(now, 'dddd')
  if (name === 'isotime') return formatDate(now, 'HH:mm')
  if (name === 'isodate') return formatDate(now, 'YYYY-MM-DD')
  if (name === 'datetimeformat') {
    if (argument === '') return formatDate(now, 'HH:mm')
    const prefix = parts[0]?.trim() ?? ''
    const shifted = applyUtcOffset(now, prefix)
    if (shifted !== undefined && parts.length >= 2) {
      return formatDate(shifted, parts.slice(1).join('::'))
    }
    return formatDate(now, argument)
  }
  return ''
}

function rollDice(source: string): string | undefined {
  if (/^\d+$/u.test(source)) {
    const sides = Number(source)
    if (!Number.isSafeInteger(sides) || sides < 1) return undefined
    return String(Math.floor(Math.random() * sides) + 1)
  }
  const expression = /^(\d*)d(\d+)((?:[+-]\d+)*)$/iu.exec(source)
  if (expression === null) return undefined
  const countText = expression[1] ?? ''
  const count = countText === '' ? 1 : Number(countText)
  const sides = Number(expression[2])
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(sides) || sides < 1) return undefined
  let total = 0
  for (let index = 0; index < count; index += 1) total += Math.floor(Math.random() * sides) + 1
  const modifiers = expression[3] ?? ''
  const modifierPattern = /([+-])(\d+)/gu
  let modifier: RegExpExecArray | null
  while ((modifier = modifierPattern.exec(modifiers)) !== null) {
    const value = Number(modifier[2])
    total += modifier[1] === '+' ? value : -value
  }
  return String(total)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function lastMessage(messages: readonly MacroMessage[] | undefined): string {
  if (messages === undefined || messages.length === 0) return ''
  return messages[messages.length - 1]?.content ?? ''
}

function lastRoleMessage(messages: readonly MacroMessage[] | undefined, role: 'user' | 'assistant'): string {
  if (messages === undefined) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === role) return message.content
  }
  return ''
}

function resolveText(
  value: string,
  env: MacroEnv,
  state: ResolutionState,
  options: ResolveMacrosOptions,
  depth: number,
): string {
  if (depth > MAX_MACRO_DEPTH) return value
  let result = ''
  let cursor = 0
  while (cursor < value.length) {
    const open = value.indexOf('{{', cursor)
    if (open < 0) {
      result += value.slice(cursor)
      break
    }
    result += value.slice(cursor, open)
    const close = macroClose(value, open)
    if (close === undefined) {
      result += value.slice(open)
      break
    }
    const whole = value.slice(open, close)
    const source = value.slice(open + 2, close - 2)
    result += evaluateMacro(source, whole, open, env, state, options, depth)
    cursor = close
  }
  return result
}

function evaluateMacro(
  source: string,
  whole: string,
  open: number,
  env: MacroEnv,
  state: ResolutionState,
  options: ResolveMacrosOptions,
  depth: number,
): string {
  const parts = macroParts(source)
  const name = parts.shift()?.trim().toLowerCase() ?? ''
  const card = env.card
  if (name === '//' || name.startsWith('// ')) return ''
  if (name === 'setvar') {
    const variable = parts.shift()?.trim() ?? ''
    if (variable !== '') {
      state.variables.set(variable, resolveText(parts.join('::'), env, state, options, depth + 1))
    }
    return ''
  }
  if (name === 'getvar') return state.variables.get(parts.join('::').trim()) ?? ''
  if (name === 'char' || name === 'group') return characterName(card)
  if (name === 'user') return env.userName || '用户'
  if (name === 'persona') return env.persona ?? ''
  if (name === 'description') return card?.description ?? ''
  if (name === 'personality') return card?.personality ?? ''
  if (name === 'scenario') return card?.scenario ?? ''
  if (name === 'mesexamples') return card?.messageExample ?? ''
  if (name === 'version' || name === 'charversion' || name === 'char_version') {
    return card === undefined ? '' : String(card.version)
  }
  if (name === 'charprompt') return card?.systemPrompt ?? ''
  if (name === 'charinstruction') return card?.postHistoryInstructions ?? ''
  if (name === 'original') return env.original ?? ''
  if (name === 'input') return env.pendingInput ?? ''
  if (name === 'lastmessage') return lastMessage(env.messages)
  if (name === 'lastmessageid') {
    return env.messages === undefined || env.messages.length === 0 ? '' : String(env.messages.length - 1)
  }
  if (name === 'lastusermessage') return lastRoleMessage(env.messages, 'user')
  if (name === 'lastcharmessage') return lastRoleMessage(env.messages, 'assistant')
  if (name === 'time' || name === 'date' || name === 'weekday'
    || name === 'isotime' || name === 'isodate' || name === 'datetimeformat') {
    return resolveTime(name, parts, env)
  }
  if (name === 'newline') {
    const argument = parts.join('::').trim()
    const count = argument === '' ? 1 : Number(argument)
    return '\n'.repeat(Number.isSafeInteger(count) && count > 0 ? Math.min(count, 100) : 1)
  }
  if (name === 'noop') return ''
  if (name === 'trim') return ''
  if (name === 'random') {
    const choices = parts
      .map(part => resolveText(part, env, state, options, depth + 1).trim())
      .filter(part => part !== '')
    if (choices.length === 0) return ''
    return choices[Math.floor(Math.random() * choices.length)] ?? ''
  }
  if (name === 'roll') return rollDice(parts.join('::').trim()) ?? ''
  if (name === 'pick') {
    const choices = parts
      .map(part => resolveText(part, env, state, options, depth + 1).trim())
      .filter(part => part !== '')
    if (choices.length === 0) return ''
    const seed = hashString(`${whole}|${open}|${source}`)
    return choices[seed % choices.length] ?? ''
  }
  state.unsupported += 1
  return options.dropUnknown === true ? '' : whole
}

/**
 * Resolve SillyTavern-style macros in model-visible roleplay text.
 * @param text - prose containing optional {{macro}} placeholders.
 * @param env - identity, chat, and clock context available to macros.
 * @param options - unknown-macro policy for this pass.
 * @returns resolved text plus a count of macros left unsupported.
 */
export function resolveMacros(
  text: string,
  env: MacroEnv = {},
  options: ResolveMacrosOptions = {},
): ResolveMacrosResult {
  const state: ResolutionState = {
    variables: env.variables ?? new Map(),
    unsupported: 0,
  }
  let value = text
  if (env.card !== undefined) {
    const name = characterName(env.card)
    const userName = env.userName || '用户'
    value = value.replace(/<char>|<bot>/giu, name).replace(/<user>/giu, userName)
  }
  return {
    text: resolveText(value, env, state, options, 0),
    unsupported: state.unsupported,
  }
}
