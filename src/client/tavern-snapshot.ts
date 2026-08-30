/** Shared projection of one Agent RP Session into SillyTavern-compatible page state. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ImportedRegexScript, ImportedTavernHelperScript } from '../import/types.ts'
import type {
  TavernScriptTree,
  TavernScriptTreeScope,
  TavernWorldbookEntry,
} from '../tavern-helper.ts'
import { tavernScriptIdentity } from '../tavern-script-identity.ts'
import type { AgentRpProjection } from '../projection-types.ts'
import {
  tavernReasoningExtra,
  type TavernPageSnapshot,
  type TavernScriptSnapshot,
} from './tavern-runtime.ts'

function tavernWorldbookEntry(
  entry: AgentRpProjection['worldInfo']['books'][number]['entries'][number],
): TavernWorldbookEntry {
  const parsedUid = Number(entry.sourceId)
  return {
    uid: Number.isSafeInteger(parsedUid) && parsedUid >= 0 ? parsedUid : entry.index,
    name: entry.name ?? entry.comment ?? '',
    enabled: entry.enabled && !entry.deleted,
    strategy: {
      type: entry.constant ? 'constant' : 'selective',
      keys: entry.keys,
      keys_secondary: {
        logic: entry.secondaryLogic === 'and-all' ? 'and_all' : entry.secondaryLogic === 'not-all' ? 'not_all'
          : entry.secondaryLogic === 'not-any' ? 'not_any' : 'and_any',
        keys: entry.secondaryKeys,
      },
      scan_depth: entry.scanDepth ?? 'same_as_global',
    },
    position: {
      type: entry.position === 'before_char' ? 'before_character_definition' : 'after_character_definition',
      role: 'system',
      depth: 4,
      order: entry.insertionOrder,
    },
    content: entry.content,
    probability: 100,
    recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
    effect: { sticky: null, cooldown: null, delay: null },
    ...(entry.ignoreBudget ? { ignoreBudget: true } : {}),
  }
}

const tavernPresetSystemPromptIds = new Set(['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'])
const tavernPresetPlaceholderPromptIds = new Set([
  'worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario',
  'worldInfoAfter', 'dialogueExamples', 'chatHistory',
])

function tavernPresetPrompt(
  prompt: NonNullable<AgentRpProjection['preset']>['prompts'][number],
): Record<string, JsonValue> {
  const system = tavernPresetSystemPromptIds.has(prompt.identifier)
  const placeholder = tavernPresetPlaceholderPromptIds.has(prompt.identifier)
  const position = prompt.injectionPosition === 1
    ? { type: 'in_chat', depth: prompt.injectionDepth ?? 4, order: prompt.injectionOrder ?? 100 }
    : { type: 'relative' }
  return {
    id: prompt.identifier,
    identifier: prompt.identifier,
    name: prompt.name,
    enabled: prompt.enabled,
    role: prompt.role,
    ...system ? {} : { position },
    ...placeholder ? {} : { content: prompt.content },
    system_prompt: prompt.systemPrompt,
    marker: prompt.marker,
    forbid_overrides: prompt.forbidOverrides,
  }
}

function tavernRegex(
  script: ImportedRegexScript,
  index: number,
  scope: 'global' | 'preset' | 'character',
): Record<string, JsonValue> {
  return {
    id: script.id ?? `${scope}-regex-${index}`,
    script_name: script.scriptName,
    enabled: !script.disabled,
    find_regex: script.findRegex,
    trim_strings: [...script.trimStrings],
    replace_string: script.replaceString,
    source: {
      user_input: script.placement.includes(1),
      ai_output: script.placement.includes(2),
      slash_command: script.placement.includes(3),
      world_info: script.placement.includes(5),
      reasoning: script.placement.includes(6),
    },
    destination: { display: script.markdownOnly, prompt: script.promptOnly },
    run_on_edit: script.runOnEdit,
    min_depth: script.minDepth,
    max_depth: script.maxDepth,
    ...(scope === 'preset' ? { disabled: script.disabled } : {}),
  }
}

function tavernHelperScript(script: ImportedTavernHelperScript, publicTree = false): Record<string, JsonValue> {
  return {
    type: 'script', id: script.id, name: script.name, content: script.content, info: script.info,
    enabled: script.enabled,
    button: { enabled: script.buttonEnabled, buttons: script.buttons.map(button => ({ ...button })) },
    data: structuredClone(script.data),
    ...(publicTree ? { export_with: { data: true, button: true } } : {}),
  }
}

function tavernScriptTrees(
  projection: AgentRpProjection,
  scope: TavernScriptTreeScope,
): readonly TavernScriptTree[] {
  const replacement = projection.tavern?.scriptTrees?.[scope]
  let normalized: readonly TavernScriptTree[]
  if (replacement !== undefined) {
    normalized = replacement
  } else {
    const scripts = scope === 'preset'
      ? projection.preset?.tavernHelperScripts ?? []
      : scope === 'character' ? projection.frontend?.tavernHelperScripts ?? [] : []
    normalized = scripts.map(script => tavernHelperScript(script, true) as unknown as TavernScriptTree)
  }
  const variables = projection.tavern?.scripts ?? {}
  const withVariables = (script: Extract<TavernScriptTree, { readonly type: 'script' }>) => ({
    ...script,
    data: variables[tavernScriptIdentity(scope, script.id)] ?? variables[script.id] ?? script.data,
  })
  return normalized.map(tree => tree.type === 'folder'
    ? { ...tree, scripts: tree.scripts.map(withVariables) }
    : withVariables(tree))
}

/** Project the active preset into Tavern Helper's public preset representation. */
export function currentTavernPreset(projection: AgentRpProjection): TavernScriptSnapshot['preset'] {
  const preset = projection.preset
  if (preset === undefined) return undefined
  const generation = preset.generation
  const value: Record<string, JsonValue> = {
    settings: {
      max_context: 2_000_000,
      max_completion_tokens: generation.maxTokens ?? 300,
      reply_count: 1,
      should_stream: true,
      temperature: generation.temperature ?? 1,
      frequency_penalty: generation.frequencyPenalty ?? 0,
      presence_penalty: generation.presencePenalty ?? 0,
      repetition_penalty: generation.repetitionPenalty ?? 1,
      top_p: generation.topP ?? 1,
      min_p: generation.minP ?? 0,
      top_k: generation.topK ?? 0,
      top_a: generation.topA ?? 0,
      seed: -1,
      squash_system_messages: false,
      reasoning_effort: generation.reasoningEffort ?? 'auto',
      request_thoughts: false,
      request_images: false,
      enable_function_calling: false,
      enable_web_search: false,
      allow_sending_images: 'auto',
      allow_sending_videos: false,
      character_name_prefix: 'none',
      wrap_user_messages_in_quotes: false,
    },
    prompts: preset.prompts.filter(prompt => prompt.attached).map(tavernPresetPrompt),
    prompts_unused: preset.prompts.filter(prompt => !prompt.attached).map(tavernPresetPrompt),
    extensions: {
      regex_scripts: preset.regexScripts.map((script, index) => tavernRegex(script, index, 'preset')),
      tavern_helper: {
        scripts: preset.tavernHelperScripts.map(script => tavernHelperScript(script)),
        variables: structuredClone(preset.tavernHelperVariables),
      },
    },
  }
  return { name: preset.name, revision: preset.revision, value }
}

/** Build the script-independent SillyTavern page state for one Agent RP Session. */
export function tavernPageSnapshot(
  projection: AgentRpProjection,
  sessionId: SessionId,
  extensionSettings: Readonly<Record<string, JsonValue>> = {},
): TavernPageSnapshot {
  const state = projection.tavern
  const message = {
    ...(state?.scopes.message ?? {}),
    ...(projection.mvu === undefined ? {} : { stat_data: projection.mvu.statData }),
  }
  const projectedWorldbooks = Object.fromEntries(projection.worldInfo.books.map(book => [
    book.name,
    book.entries.filter(entry => !entry.deleted).map(tavernWorldbookEntry),
  ]))
  const worldbooks = { ...projectedWorldbooks, ...state?.worldbooks }
  for (const name of state?.deletedWorldbookNames ?? []) delete worldbooks[name]
  const characterBook = projection.worldInfo.books.find(book => book.source === 'character')
  const importedGlobalBooks = projection.worldInfo.books
    .filter(book => book.source === 'standalone' && !book.id.startsWith('script:')).map(book => book.name)
  const preset = currentTavernPreset(projection)
  return {
    characterName: projection.characterName,
    characterId: projection.tavern?.characterSourceId ?? projection.avatarLibraryId ?? projection.characterName,
    ...(projection.characterCardRaw === undefined ? {} : { characterCard: projection.characterCardRaw }),
    chatId: String(sessionId),
    ...(projection.userName === undefined ? {} : { userName: projection.userName }),
    ...(projection.persona === undefined ? {} : { persona: projection.persona }),
    ...(preset === undefined ? {} : { preset }),
    extensionSettings,
    ...(state?.installedExtensionPrompts === undefined ? {} : {
      installedExtensionPrompts: state.installedExtensionPrompts,
    }),
    scopes: {
      global: state?.scopes.global ?? {},
      preset: state?.scopes.preset ?? {},
      character: state?.scopes.character ?? projection.frontend?.tavernHelperVariables ?? {},
      chat: state?.scopes.chat ?? {},
      message,
    },
    worldbooks,
    worldbookBindings: {
      global: state?.worldbookBindings?.global ?? importedGlobalBooks,
      character: state?.worldbookBindings?.character ?? { primary: characterBook?.name ?? null, additional: [] },
      chat: state?.worldbookBindings?.chat ?? null,
    },
    activeWorldbookEntries: projection.worldInfo.books.flatMap(book => book.entries
      .filter(entry => entry.active && !entry.deleted)
      .map(entry => `${book.name}.${tavernWorldbookEntry(entry).uid}`)),
    messages: (state?.messages ?? []).map((entry, index, entries) => ({
      ...entry,
      data: index === entries.length - 1 ? message : {},
      extra: tavernReasoningExtra(entry.reasoning),
    })),
    characterRegexScripts: (projection.frontend?.regexScripts ?? [])
      .map((entry, index) => tavernRegex(entry, index, 'character')),
    globalRegexScripts: projection.regexPacks.flatMap(pack => pack.scripts)
      .map((entry, index) => tavernRegex(entry, index, 'global')),
    globalScriptTrees: tavernScriptTrees(projection, 'global'),
    presetScriptTrees: tavernScriptTrees(projection, 'preset'),
    characterScriptTrees: tavernScriptTrees(projection, 'character'),
    displayRegexScripts: [
      ...projection.regexPacks.flatMap(pack => pack.scripts),
      ...(projection.preset?.regexScripts ?? []),
      ...(projection.frontend?.regexScripts ?? []),
    ],
  }
}

/** Add one Tavern Helper script's identity, state, and permissions to the shared page snapshot. */
export function tavernScriptSnapshot(
  projection: AgentRpProjection,
  script: ImportedTavernHelperScript,
  scriptScope: TavernScriptTreeScope,
  approvedScriptOrigins: readonly string[],
  sessionId: SessionId,
  approvedImageOrigins: readonly string[] = [],
  approvedStyleOrigins: readonly string[] = [],
  approvedFontOrigins: readonly string[] = [],
  approvedFrameOrigins: readonly string[] = [],
  extensionSettings: Readonly<Record<string, JsonValue>> = {},
): TavernScriptSnapshot {
  const state = projection.tavern
  const page = tavernPageSnapshot(projection, sessionId, extensionSettings)
  const owner = tavernScriptIdentity(scriptScope, script.id)
  const statusPanel = state?.statusPanels?.find(panel => panel.owner.scriptScope === scriptScope
    && panel.owner.scriptId === script.id)
  return {
    ...page,
    scriptScope,
    scriptId: script.id,
    scriptName: script.name,
    scriptInfo: script.info,
    buttons: script.buttons,
    ...(statusPanel === undefined ? {} : { statusPanelHtml: statusPanel.html }),
    approvedScriptOrigins,
    approvedImageOrigins,
    approvedStyleOrigins,
    approvedFontOrigins,
    approvedFrameOrigins,
    scopes: {
      ...page.scopes,
      script: state?.scripts[owner] ?? state?.scripts[script.id] ?? script.data,
    },
    messages: page.messages.map((entry, index) => ({
      ...entry,
      annotations: state?.messages[index]?.annotations?.[owner] ?? {},
    })),
    injectedPrompts: (state?.injectedPrompts ?? []).flatMap(prompt => {
      if (prompt.scriptScope !== scriptScope || prompt.scriptId !== script.id) return []
      const { scriptId: _scriptId, scriptScope: _scriptScope, ...value } = prompt
      return [value]
    }),
  }
}
