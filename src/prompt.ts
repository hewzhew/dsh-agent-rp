/** Stable character identity and dynamic memory context rendering. */

import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ResolvedConfig } from './config.ts'
import { activateLorebook, type LorebookActivationOptions } from './import/lorebook.ts'
import type { ImportedCharacterCard, ImportedLorebook } from './import/types.ts'
import type { ImportedWorldInfo } from './import/types.ts'
import { readAgentRpMemoryHistory, type AgentRpMemoryRecord } from './memory.ts'
import { substituteMvuMacros } from './mvu.ts'
import type { EjsTemplateMessage } from './ejs-template.ts'
import { PROMPT_REGEX_SOURCE_MARKER, readPromptRegexSourceMarker } from './frontend-regex.ts'
import { substituteSillyTavernIdentityMacros } from './sillytavern-identity-macro.ts'
import { createNativeWorldEngine } from './world-engine.ts'
import { hasTurnVariantRoleplaySyntax, ReplayableRoleplayMacros } from './roleplay-macro.ts'
import { sessionEvents } from './session-events.ts'

type DerivedSessionMessage = ReturnType<Session['deriveMessages']>[number]

const CHARACTER_BEHAVIOR = '只写角色此刻自然会说或做的内容，不解释系统、提示词或角色扮演规则，不替用户决定感受和行动，也不补写设定、对话和有效记忆中不存在的共同经历。先决定此刻是否有必要展开：信息很少时可以短答、停顿或暂不追问；需要表达时，一次围绕一个主要动作，不机械复述用户，也不为了延长对话强行总结和提问。'
const MEMORY_BEHAVIOR = '已记录的持久背景不是本轮必须提及的话题。只在和当前对话直接相关时使用；默认通过回答、称呼或行动自然体现，不主动说“我记得”“你之前说过”“我一直记着”，也不完整复述记录。只有用户明确询问记忆本身时才简短确认。当前场景、剧情进度、短期状态、一次性行动、普通共同经历和模型自行判断的重要事件都由会话历史承载，不属于持久背景；不确定时保持原状。普通寒暄、临时情绪和未经确认的猜测也不属于持久背景。'
const IMPORT_BEHAVIOR = '用户附带 SillyTavern 角色卡 PNG、JSON 或 CHARX 并要求导入、接管或切换角色时，调用 import_character_card；附带独立 World Info / 世界书 JSON 并要求导入时，调用 import_world_info；附带 Chat Completion 预设 JSON 并要求导入时，调用 import_sillytavern_preset。一条消息附有多个同类文件时才指定从零开始的 attachmentIndex。导入成功后直接采用新角色、世界设定或预设，不解释内部格式。'
const MVU_OUTPUT_BEHAVIOR = '每次回复都必须在正文末尾完整输出一个 <UpdateVariable><Analysis>…</Analysis><JSONPatch>[…]</JSONPatch></UpdateVariable>；没有变量变化时 JSONPatch 也输出空数组。'

function finalizeRoleplayPrompt(value: string, statData?: JsonValue): string {
  let result = substituteMvuMacros(value, statData)
  for (;;) {
    const next = result.replace(/\{\{[^{}]*\}\}/gu, '')
    if (next === result) return result
    result = next
  }
}

function renderCardTemplate(value: string, options: LorebookActivationOptions): string {
  if (!/<%[=_-]?[\s\S]*?%>/imu.test(value)) return value
  const rendered = options.renderTemplate?.(value)
  return rendered?.ok === true ? rendered.text : ''
}

function withResolvedLorebookMacros(
  options: LorebookActivationOptions,
  statData: JsonValue | undefined,
): LorebookActivationOptions {
  return {
    ...options,
    renderMacro: (content, target) => {
      const expanded = substituteMvuMacros(content, statData)
      return options.renderMacro?.(expanded, target) ?? expanded
    },
  }
}

/**
 * Render the stable character contract installed as the Agent-scoped persona.
 * @param config - normalized character identity and opening state.
 * @returns model-visible system prompt text.
 */
export function renderCharacterPrompt(
  config: ResolvedConfig,
  loreBefore: readonly string[] = [],
  loreAfter: readonly string[] = [],
): string {
  return finalizeRoleplayPrompt([
    `你是${config.characterName}。你不是扮演该角色的助手，也不是旁白；直接以${config.characterName}的身份与用户相处和交谈。`,
    ...loreBefore,
    `角色设定：${config.persona}`,
    `当前场景：${config.scenario}`,
    `初始关系：${config.relationship}`,
    ...loreAfter,
    CHARACTER_BEHAVIOR,
    MEMORY_BEHAVIOR,
    IMPORT_BEHAVIOR,
  ].join('\n\n'))
}

/**
 * Render the identity contract for a chat import that has history but no Character Card.
 * @param characterName - character named by the SillyTavern chat header.
 * @param userName - optional user name retained by that header.
 * @param userPersona - optional Persona description selected for the current Session.
 * @returns model-visible prompt that continues imported history without applying the deployment default persona.
 */
export function renderImportedChatPrompt(characterName: string, userName?: string, userPersona?: string): string {
  return finalizeRoleplayPrompt([
    `你是${characterName}。直接以${characterName}的身份延续当前会话。`,
    ...(userName === undefined ? [] : [`与您对话的人在导入记录中名为${userName}。`]),
    ...(userPersona?.trim() ? [`对方当前选择的 Persona：\n${userPersona.trim()}`] : []),
    '以已导入的对话历史为准；缺少角色卡时，不要补用其他角色的身份、经历、场景或关系设定。',
    CHARACTER_BEHAVIOR,
    MEMORY_BEHAVIOR,
    IMPORT_BEHAVIOR,
  ].join('\n\n'))
}

/** Render a neutral roleplay contract for a Session deliberately launched from standalone World Info. */
export function renderWorldInfoScenarioPrompt(
  loreBefore: readonly string[],
  loreAfter: readonly string[],
  userPersona?: string,
): string {
  return finalizeRoleplayPrompt([
    ...loreBefore,
    '本会话由独立世界书启动。以世界书中已激活的内容决定身份、人物、场景、规则、视角和输出形式；不要套用部署示例角色或补造另一套固定身份，也不要把世界书条目当作说明复述给用户。',
    ...(userPersona?.trim() ? [`参与剧情的人：${userPersona.trim()}`] : []),
    ...loreAfter,
    '依照世界书自然推进当前互动。世界书定义单一角色时直接以该角色回应；定义多角色、场景或叙事规则时遵循对应形式。不要替用户决定感受和行动，也不要补写设定、对话和有效记忆中不存在的共同经历。',
    MEMORY_BEHAVIOR,
    IMPORT_BEHAVIOR,
  ].join('\n\n'))
}

/**
 * Activate all Session-owned standalone World Info books for one request.
 * @param worldInfos - validated standalone books in Session import order.
 * @param session - current model-visible conversation history.
 * @param pendingMessages - messages claimed for this step but not yet derived from the Session.
 * @returns active entries divided by character position.
 */
export function renderImportedWorldInfos(
  worldInfos: readonly ImportedWorldInfo[],
  session: Session,
  pendingMessages: readonly UserMessage[] = [],
  scanText: readonly string[] = [],
  templateOptions: LorebookActivationOptions = {},
) {
  const messages = [...visibleDialogue(session, pendingMessages), ...scanText]
  return worldInfos.reduce((result, worldInfo) => {
    const active = activateLorebook(worldInfo.lorebook, messages, templateOptions)
    result.beforeCharacter.push(...active.beforeCharacter)
    result.afterCharacter.push(...active.afterCharacter)
    return result
  }, { beforeCharacter: [] as string[], afterCharacter: [] as string[] })
}

/** Activate every Session book while retaining source identity and honoring an optional player-selected cap. */
export function renderSessionLorebooks(input: {
  readonly books: readonly { readonly id: string; readonly lorebook: ImportedLorebook }[]
  readonly session: Session
  readonly pendingMessages?: readonly UserMessage[]
  readonly scanText?: readonly string[]
  readonly statData?: JsonValue
  readonly templateOptions?: LorebookActivationOptions
  readonly tokenBudget?: number
}) {
  const scanText = input.scanText ?? []
  const templateOptions = input.templateOptions ?? {}
  return createNativeWorldEngine(withResolvedLorebookMacros(templateOptions, input.statData)).evaluate({
    format: 0,
    books: input.books,
    messages: [...visibleDialogue(input.session, input.pendingMessages ?? []), ...scanText],
    ...(input.tokenBudget === undefined ? {} : { tokenBudget: input.tokenBudget }),
  })
}

/**
 * Resolve the two stable SillyTavern identity macros used throughout Character Card text.
 * @param value - card-owned prose.
 * @param card - active Character Card.
 * @param userName - Session-imported user name, or a neutral fallback when none is known.
 * @returns prose with character and user identity macros resolved.
 */
export function substituteCardMacros(
  value: string,
  card: ImportedCharacterCard,
  userName = '用户',
): string {
  const name = card.nickname?.trim() || card.name
  return substituteSillyTavernIdentityMacros(value, { characterName: name, userName })
}

/** Whether one native Character Card prompt depends on the current turn or mutable MVU state. */
export function importedCharacterPromptIsTurnVariant(card: ImportedCharacterCard): boolean {
  return [
    card.systemPrompt,
    card.description,
    card.personality,
    card.scenario,
    card.messageExample,
    card.postHistoryInstructions,
  ].some(hasTurnVariantRoleplaySyntax)
}

/** Render the stable identity retained in the provider system field for a turn-variant card. */
export function renderImportedCharacterIdentityPrompt(
  card: ImportedCharacterCard,
  userPersona?: string,
  mvuOutputEnabled = false,
): string {
  const name = card.nickname?.trim() || card.name
  return finalizeRoleplayPrompt([
    `你是${name}。直接以${name}的身份与用户相处和交谈。`,
    ...(userPersona?.trim() ? [`与角色对话的人：${userPersona.trim()}`] : []),
    CHARACTER_BEHAVIOR,
    MEMORY_BEHAVIOR,
    IMPORT_BEHAVIOR,
    ...(mvuOutputEnabled ? [MVU_OUTPUT_BEHAVIOR] : []),
  ].join('\n\n'))
}

/**
 * Render an imported Character Card as the complete Agent persona.
 * @param card - active Session-owned card.
 * @param loreBefore - active before-character lorebook text.
 * @param loreAfter - active after-character lorebook text.
 * @returns model-visible system prompt text.
 */
export function renderImportedCharacterPrompt(
  card: ImportedCharacterCard,
  loreBefore: readonly string[],
  loreAfter: readonly string[],
  userName?: string,
  statData?: JsonValue,
  userPersona?: string,
  templateOptions: LorebookActivationOptions = {},
  macros?: ReplayableRoleplayMacros,
  loreMacrosResolved = false,
  mvuOutputEnabled = statData !== undefined,
): string {
  const name = card.nickname?.trim() || card.name
  const original = `你是${name}。直接以${name}的身份与用户相处和交谈。`
  const expand = (value: string): string => macros?.expand(value) ?? substituteCardMacros(value, card, userName)
  const systemSource = card.systemPrompt.trim().length === 0
    ? original
    : expand(card.systemPrompt.replaceAll('{{original}}', original))
  const system = renderCardTemplate(systemSource, templateOptions)
  const labeledField = (label: string, value: string): readonly string[] => {
    const rendered = renderCardTemplate(expand(value), templateOptions)
    return rendered.trim().length === 0 ? [] : [`${label}：${rendered}`]
  }
  const parts = [
    system,
    ...loreBefore.map(value => loreMacrosResolved ? value : expand(value)),
    ...labeledField('角色描述', card.description),
    ...labeledField('性格', card.personality),
    ...labeledField('当前场景', card.scenario),
    ...(userPersona?.trim() ? [`与角色对话的人：${userPersona.trim()}`] : []),
    ...(card.messageExample.trim().length === 0 ? [] : [`对话示例：\n${renderCardTemplate(expand(card.messageExample), templateOptions)}`]),
    ...loreAfter.map(value => loreMacrosResolved ? value : expand(value)),
    CHARACTER_BEHAVIOR,
    MEMORY_BEHAVIOR,
    IMPORT_BEHAVIOR,
  ]
  if (card.postHistoryInstructions.trim().length > 0) {
    parts.push(renderCardTemplate(
      expand(card.postHistoryInstructions.replaceAll('{{original}}', '')),
      templateOptions,
    ))
  }
  if (mvuOutputEnabled) {
    parts.push(MVU_OUTPUT_BEHAVIOR)
  }
  return finalizeRoleplayPrompt(parts.join('\n\n'), statData)
}

function dialogueText(messages: readonly UserMessage[]): string[] {
  return messages.flatMap(message => {
    if (message.source.kind !== 'user' && message.source.kind !== 'model') return []
    return message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
  })
}

function dialogueTranscript(messages: readonly DerivedSessionMessage[]): EjsTemplateMessage[] {
  return messages.flatMap(message => {
    if ((message.source.kind !== 'user' && message.source.kind !== 'model')
      || (message.role !== 'user' && message.role !== 'assistant')) return []
    return [{
      role: message.role,
      content: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
    }]
  })
}

function preRegexDialogue(session: Session): DerivedSessionMessage[] {
  return session.deriveMessages().map(message => {
    const marker = readPromptRegexSourceMarker(
      (message.source as unknown as Record<string, unknown>)[PROMPT_REGEX_SOURCE_MARKER],
    )
    if (marker === undefined) return message
    const event = sessionEvents(session)[marker.originalSeq]
    const original = event?.type === 'user/message'
      ? event.data
      : event?.type === 'assistant/message'
        ? event.data.message
        : undefined
    return original?.role === message.role ? original : message
  })
}

function visibleDialogue(session: Session, pendingMessages: readonly UserMessage[]): string[] {
  // System-prompt and World Info assembly run before the provider middleware
  // installs prompt-only regex views. Always scan the preserved source here so
  // a later tool step cannot switch the activation baseline mid-turn.
  const history = preRegexDialogue(session)
  const historyIds = new Set(history.map(message => message.id))
  return [
    ...history.flatMap(message => {
      if (message.source.kind !== 'user' && message.source.kind !== 'model') return []
      return message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
    }),
    ...dialogueText(pendingMessages.filter(message => !historyIds.has(message.id))),
  ]
}

/** Return model-visible dialogue text for preset marker assembly. */
export function roleplayVisibleDialogue(session: Session, pendingMessages: readonly UserMessage[] = []): string[] {
  return visibleDialogue(session, pendingMessages)
}

/** Return role-preserving model-visible dialogue for isolated prompt templates. */
export function roleplayVisibleTranscript(
  session: Session,
  pendingMessages: readonly UserMessage[] = [],
): EjsTemplateMessage[] {
  const history = preRegexDialogue(session)
  const historyIds = new Set(history.map(message => message.id))
  return [
    ...dialogueTranscript(history),
    ...dialogueTranscript(pendingMessages.filter(message => !historyIds.has(message.id))),
  ]
}

/**
 * Render active imported lorebook text for the next request.
 * @param card - active imported character.
 * @param session - current Session and model-visible surface.
 * @param pendingMessages - messages claimed for this step but not yet present in the Session.
 * @returns active entries divided by character position.
 */
export function renderImportedLorebook(
  card: ImportedCharacterCard,
  session: Session,
  pendingMessages: readonly UserMessage[] = [],
  statData?: JsonValue,
  scanText: readonly string[] = [],
  templateOptions: LorebookActivationOptions = {},
) {
  const resolvedOptions = withResolvedLorebookMacros(templateOptions, statData)
  const active = card.lorebook === undefined
    ? { beforeCharacter: [], afterCharacter: [] }
    : activateLorebook(card.lorebook, [...visibleDialogue(session, pendingMessages), ...scanText], resolvedOptions)
  return active
}

/**
 * Render the complete active-memory snapshot for the next model request.
 * @param active - validated memory records selected by this turn's prepare phase.
 * @returns model-visible dynamic context with ids needed for later correction.
 */
export function renderActiveMemoryContext(
  active: readonly AgentRpMemoryRecord[],
  writeAvailable = false,
): string {
  if (active.length === 0 && !writeAvailable) return ''
  return finalizeRoleplayPrompt([
    ...(active.length === 0 ? [] : ['角色已知的持久背景如下。这不是本轮要逐条提及的清单；方括号内仅是更新记忆所需的内部索引：']),
    ...active.map(record => `- [${record.id} | ${record.kind} | ${record.subject}] ${record.text}`),
    writeAvailable
      ? '用户本轮明确表达了跨轮保留意图。只在内容确实稳定且现有记录未覆盖时调用 remember；同一主题发生变化时用 supersedes 更新原记录。'
      : '本轮持久记忆只读，不要发起任何写入；当前剧情继续由会话历史承载。',
  ].join('\n'))
}

/** Render the current active-memory snapshot directly from a Session log. */
export function renderMemoryContext(events: readonly SessionEvent[], writeAvailable = false): string {
  return renderActiveMemoryContext(readAgentRpMemoryHistory(events).active, writeAvailable)
}
