/** Prompt Manager assembly for imported SillyTavern Chat Completion presets. */

import { createMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type { ImportedCharacterCard } from './import/types.ts'
import type {
  ImportedSillyTavernPreset,
  SillyTavernPresetPrompt,
  SillyTavernPresetRole,
} from './import/sillytavern-preset.ts'
import { resolveMacros, type MacroMessage } from './macros.ts'
import type { EjsTemplateResult } from './ejs-template.ts'

/** Runtime values substituted into marker prompts and macros. */
export interface PresetPromptInputs {
  readonly card: ImportedCharacterCard
  readonly userName?: string
  readonly userPersona?: string
  readonly worldInfoBefore: readonly string[]
  readonly worldInfoAfter: readonly string[]
  readonly session: Session
  readonly pendingMessages?: readonly UserMessage[]
  readonly mvuEnabled?: boolean
  readonly renderTemplate?: (template: string) => EjsTemplateResult
}

/** Host-compatible prompt split around SillyTavern's chatHistory marker. */
export interface AssembledSillyTavernPreset {
  readonly system: string
  readonly afterHistory: string
  readonly inChat: readonly SillyTavernInChatPrompt[]
  readonly enabledPromptCount: number
  readonly degradedRoleCount: number
  readonly unsupportedMacroCount: number
  readonly templateFailureCount: number
}

/** One expanded Prompt Manager module placed relative to recent chat messages. */
export interface SillyTavernInChatPrompt {
  readonly role: SillyTavernPresetRole
  readonly content: string
  readonly depth: number
  readonly order: number
}

interface MacroState {
  readonly card: ImportedCharacterCard
  readonly variables: Map<string, string>
  readonly userName: string
  readonly messages: readonly MacroMessage[]
  unsupported: number
  templateFailures: number
}

function macroMessages(session: Session, pending: readonly UserMessage[]): MacroMessage[] {
  return [...session.deriveMessages(), ...pending].flatMap(message => {
    if ((message.source.kind !== 'user' && message.source.kind !== 'model')
      || (message.role !== 'user' && message.role !== 'assistant')) return []
    return [{
      role: message.role,
      content: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
    }]
  })
}

function expandMacros(value: string, state: MacroState): string {
  const result = resolveMacros(value, {
    card: state.card,
    userName: state.userName,
    messages: state.messages,
    variables: state.variables,
  }, { dropUnknown: true })
  state.unsupported += result.unsupported
  return result.text.trim()
}

function applyFormat(format: string, variable: string, value: string, state: MacroState): string {
  if (value.trim() === '') return ''
  return expandMacros(format.replaceAll(`{{${variable}}}`, value).replaceAll('{0}', value), state)
}

function markerText(
  prompt: SillyTavernPresetPrompt,
  preset: ImportedSillyTavernPreset,
  inputs: PresetPromptInputs,
  state: MacroState,
): string | undefined {
  const card = inputs.card
  switch (prompt.identifier) {
    case 'worldInfoBefore':
      return inputs.worldInfoBefore.map(value => applyFormat(preset.formats.worldInfo, 'worldInfo', value, state)).filter(Boolean).join('\n\n')
    case 'worldInfoAfter':
      return inputs.worldInfoAfter.map(value => applyFormat(preset.formats.worldInfo, 'worldInfo', value, state)).filter(Boolean).join('\n\n')
    case 'charDescription': return card.description
    case 'charPersonality':
      return applyFormat(preset.formats.personality, 'personality', card.personality, state)
    case 'scenario':
      return applyFormat(preset.formats.scenario, 'scenario', card.scenario, state)
    case 'personaDescription': return inputs.userPersona ?? ''
    case 'dialogueExamples': return card.messageExample
    case 'chatHistory': return undefined
    default: return prompt.content
  }
}

function promptText(
  prompt: SillyTavernPresetPrompt,
  preset: ImportedSillyTavernPreset,
  inputs: PresetPromptInputs,
  state: MacroState,
): string | undefined {
  const marker = prompt.marker ? markerText(prompt, preset, inputs, state) : prompt.content
  if (marker === undefined) return undefined
  const card = inputs.card
  let value = marker
  if (prompt.identifier === 'main' && card.systemPrompt.trim() !== '' && !prompt.forbidOverrides) {
    value = card.systemPrompt.replaceAll('{{original}}', marker)
  }
  if (prompt.identifier === 'jailbreak' && card.postHistoryInstructions.trim() !== '' && !prompt.forbidOverrides) {
    value = card.postHistoryInstructions.replaceAll('{{original}}', marker)
  }
  const expanded = expandMacros(value, state)
  if (!/<%[=_-]?[\s\S]*?%>/imu.test(expanded)) return expanded
  if (inputs.renderTemplate === undefined) {
    state.templateFailures += 1
    return undefined
  }
  const rendered = inputs.renderTemplate(expanded)
  if (!rendered.ok) {
    state.templateFailures += 1
    return undefined
  }
  return rendered.text
}

function roleBoundary(role: SillyTavernPresetRole, name: string, text: string): string {
  if (role === 'system') return text
  return `[SillyTavern ${role} prompt · ${name}]\n${text}`
}

/** Insert expanded in-chat modules using SillyTavern's depth, priority, and role ordering. */
export function injectSillyTavernInChatPrompts(
  messages: readonly Message[],
  prompts: readonly SillyTavernInChatPrompt[],
): Message[] {
  if (prompts.length === 0) return [...messages]
  const result = [...messages]
  const baseLength = messages.length
  const depths = [...new Set(prompts.map(prompt => prompt.depth))].sort((left, right) => left - right)
  for (const depth of depths) {
    const atDepth = prompts.filter(prompt => prompt.depth === depth)
    const orders = [...new Set(atDepth.map(prompt => prompt.order))].sort((left, right) => right - left)
    const injected: Message[] = []
    for (const order of orders) {
      for (const role of ['system', 'user', 'assistant'] as const) {
        const content = atDepth
          .filter(prompt => prompt.order === order && prompt.role === role)
          .map(prompt => prompt.content.trim())
          .filter(Boolean)
          .join('\n')
        if (content === '') continue
        injected.push(createMessage({
          role,
          source: { kind: 'plugin', plugin: 'dsh-agent-rp-preset-in-chat' },
          content: [{ type: 'text', text: content }],
        }))
      }
    }
    result.splice(Math.max(0, baseLength - depth), 0, ...injected)
  }
  return result
}

/** Assemble every ordered module, splitting post-history instructions into a runtime context. */
export function assembleSillyTavernPreset(
  preset: ImportedSillyTavernPreset,
  inputs: PresetPromptInputs,
): AssembledSillyTavernPreset {
  const byId = new Map(preset.prompts.map(prompt => [prompt.identifier, prompt]))
  const state: MacroState = {
    card: inputs.card,
    variables: new Map(),
    userName: inputs.userName?.trim() || '用户',
    messages: macroMessages(inputs.session, inputs.pendingMessages ?? []),
    unsupported: 0,
    templateFailures: 0,
  }
  const before: string[] = []
  const after: string[] = []
  const inChat: SillyTavernInChatPrompt[] = []
  let pastHistory = false
  let enabledPromptCount = 0
  let degradedRoleCount = 0
  for (const entry of preset.order) {
    if (!entry.enabled) continue
    const prompt = byId.get(entry.identifier)
    if (prompt === undefined) continue
    enabledPromptCount += 1
    if (prompt.identifier === 'chatHistory' && prompt.marker) {
      pastHistory = true
      continue
    }
    const value = promptText(prompt, preset, inputs, state)
    if (value === undefined || value.trim() === '') continue
    if (prompt.injectionPosition === 1) {
      inChat.push({
        role: prompt.role,
        content: value,
        depth: Number.isSafeInteger(prompt.injectionDepth) && (prompt.injectionDepth ?? -1) >= 0
          ? prompt.injectionDepth! : 4,
        order: typeof prompt.injectionOrder === 'number' && Number.isFinite(prompt.injectionOrder)
          ? prompt.injectionOrder : 100,
      })
      continue
    }
    if (prompt.role !== 'system') degradedRoleCount += 1
    ;(pastHistory ? after : before).push(roleBoundary(prompt.role, prompt.name, value))
  }
  if (inputs.mvuEnabled === true) {
    after.push('每次回复都必须在正文末尾完整输出一个 <UpdateVariable><Analysis>…</Analysis><JSONPatch>[…]</JSONPatch></UpdateVariable>；没有变量变化时 JSONPatch 也输出空数组。')
  }
  return {
    system: before.join('\n\n'),
    afterHistory: after.join('\n\n'),
    inChat,
    enabledPromptCount,
    degradedRoleCount,
    unsupportedMacroCount: state.unsupported,
    templateFailureCount: state.templateFailures,
  }
}
