/** Pure message-display planning shared by the current DOM adapter and future renderers. */

import type { ImportedCharacterFrontend, ImportedRegexScript } from './import/types.ts'
import {
  AI_OUTPUT_PLACEMENT,
  compileCharacterDisplay,
  renderCharacterDisplay,
  USER_INPUT_PLACEMENT,
  type CompiledCharacterDisplay,
} from './frontend-regex.ts'

/** Placeholder emitted by imported status-bar rules before their visible replacement is resolved. */
export const ROLEPLAY_STATUS_PLACEHOLDER = '<StatusPlaceHolderImpl/>'

const EMPTY_FRONTEND: ImportedCharacterFrontend = {
  regexScripts: [],
  tavernHelperScriptNames: [],
  tavernHelperScripts: [],
  tavernHelperVariables: {},
}

/** Tavern transcript item needed to resolve display-regex depth and overrides. */
export interface RoleplayDisplayMessage {
  readonly messageId: number
  readonly seq: number
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly isHidden: boolean
}

/** Projection fields that can affect one visible message. */
export interface RoleplayDisplayProjection {
  readonly characterName: string
  readonly userName?: string
  readonly regexPacks?: readonly {
    readonly scripts: readonly ImportedRegexScript[]
  }[]
  readonly preset?: {
    readonly regexScripts: readonly ImportedRegexScript[]
  }
  readonly tavern?: {
    readonly messages: readonly RoleplayDisplayMessage[]
  }
  readonly generations: readonly {
    readonly anchorSeq: number
    readonly selectedVersionSeq: number
    readonly assistantSeqs: readonly number[]
    readonly versions: readonly {
      readonly seq: number
      readonly text: string
    }[]
  }[]
}

/** Result of deciding how one DSH message row should be presented. */
export type RoleplayDisplayPlan =
  | { readonly kind: 'host' }
  | { readonly kind: 'hidden'; readonly reason: 'unselected-generation' }
  | {
    readonly kind: 'render'
    readonly source: 'override' | 'selected-generation' | 'display-regex'
    readonly compilation: CompiledCharacterDisplay
    /** Tavern message represented by this rendered row, when the projection can identify it. */
    readonly messageId?: number
  }

/** Input facts owned by the native user-message Chat Node. */
export interface RoleplayUserDisplayInput {
  readonly seq: number
  readonly alignedMessage?: RoleplayDisplayMessage
}

/** Input facts owned by the native Assistant-step Chat Node. */
export interface RoleplayAssistantDisplayInput {
  readonly finalSeq?: number
  readonly blockText: string
  readonly alignedMessage?: RoleplayDisplayMessage
}

/** Pure planner for all message rows in one projection revision. */
export interface RoleplayDisplayPlanner {
  /** Decide whether and how to replace one user row. */
  user(input: RoleplayUserDisplayInput): RoleplayDisplayPlan
  /** Decide whether and how to replace one Assistant row. */
  assistant(input: RoleplayAssistantDisplayInput): RoleplayDisplayPlan
}

function messageDepth(messages: readonly RoleplayDisplayMessage[] | undefined, messageId: number | undefined): number | undefined {
  if (messages === undefined || messageId === undefined) return undefined
  const index = messages.findIndex(message => message.messageId === messageId)
  return index < 0 ? undefined : messages.length - index - 1
}

function overridePlan(value: string, messageId: number): RoleplayDisplayPlan {
  return {
    kind: 'render',
    source: 'override',
    messageId,
    compilation: { segments: [{ kind: 'html', source: value }], diagnostics: [] },
  }
}

/**
 * Build one immutable display planner without reading the DOM or browser state.
 *
 * @param input - current projection, already-resolved character frontend, view mode, and script overrides.
 * @returns row planners that preserve the Host renderer unless Roleplay presentation has work to do.
 */
export function createRoleplayDisplayPlanner(input: {
  readonly projection: RoleplayDisplayProjection
  readonly frontend?: ImportedCharacterFrontend
  readonly immersive: boolean
  readonly overrides: ReadonlyMap<number, string>
}): RoleplayDisplayPlanner {
  const { projection, frontend, immersive, overrides } = input
  const activeFrontend = frontend ?? EMPTY_FRONTEND
  const messages = projection.tavern?.messages
  const messageBySeq = new Map(messages?.map(message => [message.seq, message]))
  const messageIdBySeq = new Map(messages?.map(message => [message.seq, message.messageId]))
  const sharedRegexScripts = [
    ...(projection.regexPacks ?? []).flatMap(pack => pack.scripts),
    ...(projection.preset?.regexScripts ?? []),
  ]
  const hasDisplayRules = immersive && activeFrontend.regexScripts.length + sharedRegexScripts.length > 0

  return {
    user: ({ seq, alignedMessage }) => {
      const message = alignedMessage ?? messageBySeq.get(seq)
      const messageId = message?.messageId ?? messageIdBySeq.get(seq)
      const override = messageId === undefined ? undefined : overrides.get(messageId)
      if (override !== undefined) return overridePlan(override, messageId!)
      if (!hasDisplayRules || message?.role !== 'user' || message.text === '') {
        return { kind: 'host' }
      }
      const rendered = renderCharacterDisplay(message.text, {
        name: projection.characterName,
        frontend: activeFrontend,
      }, USER_INPUT_PLACEMENT, messageDepth(messages, message.messageId), projection.userName, sharedRegexScripts)
      return rendered === message.text
        ? { kind: 'host' }
        : { kind: 'render', source: 'display-regex', compilation: compileCharacterDisplay(rendered), messageId: message.messageId }
    },
    assistant: ({ finalSeq, blockText, alignedMessage }) => {
      const generation = finalSeq === undefined
        ? undefined
        : projection.generations.find(group => group.assistantSeqs.includes(finalSeq))
      const selected = generation?.versions.find(version => version.seq === generation.selectedVersionSeq)
      const messageId = (selected === undefined ? undefined : messageIdBySeq.get(selected.seq))
        ?? alignedMessage?.messageId
        ?? (finalSeq === undefined ? undefined : messageIdBySeq.get(finalSeq))
      const override = messageId === undefined ? undefined : overrides.get(messageId)
      if (override !== undefined) return overridePlan(override, messageId!)
      if (immersive && generation !== undefined) {
        if (finalSeq !== generation.anchorSeq) return { kind: 'hidden', reason: 'unselected-generation' }
        if (selected !== undefined) {
          const rendered = renderCharacterDisplay(selected.text.replaceAll(ROLEPLAY_STATUS_PLACEHOLDER, ''), {
            name: projection.characterName,
            frontend: activeFrontend,
          }, AI_OUTPUT_PLACEMENT, messageDepth(messages, messageId), projection.userName, sharedRegexScripts)
          return {
            kind: 'render', source: 'selected-generation', compilation: compileCharacterDisplay(rendered),
            ...(messageId === undefined ? {} : { messageId }),
          }
        }
      }
      if (!hasDisplayRules) return { kind: 'host' }
      const raw = alignedMessage?.role === 'assistant' ? alignedMessage.text : blockText
      if (raw === '') return { kind: 'host' }
      const rendered = renderCharacterDisplay(raw.replaceAll(ROLEPLAY_STATUS_PLACEHOLDER, ''), {
        name: projection.characterName,
        frontend: activeFrontend,
      }, AI_OUTPUT_PLACEMENT, messageDepth(messages, messageId), projection.userName, sharedRegexScripts)
      return rendered === raw
        ? { kind: 'host' }
        : {
            kind: 'render', source: 'display-regex', compilation: compileCharacterDisplay(rendered),
            ...(messageId === undefined ? {} : { messageId }),
          }
    },
  }
}
