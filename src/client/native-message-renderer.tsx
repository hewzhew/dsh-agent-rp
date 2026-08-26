/** Host-native message text contribution with an iframe-compatible legacy fallback. */

import type { Context } from '@deepseek-ai/cordis'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import DOMPurify from 'dompurify'
import { useLayoutEffect, useMemo } from 'react'
import type {
  NativeAssistantMessageOwner,
  NativeMessageActivation,
  NativeMessageActivationTable,
  NativeMessageSelectorScope,
  NativeUserMessageOwner,
} from '../native-message-routes.ts'
import {
  NATIVE_MESSAGE_INLINE_ATTRIBUTES,
  NATIVE_MESSAGE_INLINE_TAGS,
  renderNativeMessageInlineHtml,
} from '../native-message-display.ts'
import { selectNativeAssistantMessage, selectNativeUserMessage } from '../native-message-routes.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  /** Compatibility declaration for Hosts that predate the exported text-chain owner. */
  interface UserMessageTextOwnerProps extends NativeUserMessageOwner {}
  /** Compatibility declaration for Hosts that predate the exported text-chain owner. */
  interface AssistantMessageTextOwnerProps extends NativeAssistantMessageOwner {}
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.chat.userText': {
      kind: 'chain'
      scope: 'session'
      owner: import('@deepseek-ai/dsh-client-ui-conversation/client').UserMessageTextOwnerProps
    }
    'conversation.chat.assistantText': {
      kind: 'chain'
      scope: 'session'
      owner: import('@deepseek-ai/dsh-client-ui-conversation/client').AssistantMessageTextOwnerProps
    }
  }
}

function NativeInlineMessage({ source }: { readonly source: string }) {
  const html = useMemo(() => String(DOMPurify.sanitize(
    renderNativeMessageInlineHtml(source),
    {
      ALLOWED_ATTR: [...NATIVE_MESSAGE_INLINE_ATTRIBUTES],
      ALLOWED_TAGS: [...NATIVE_MESSAGE_INLINE_TAGS],
      FORBID_ATTR: ['srcdoc'],
    },
  )), [source])
  return <div data-agent-rp-native-inline-html style={{ minWidth: 0, overflowWrap: 'anywhere' }}
    dangerouslySetInnerHTML={{ __html: html }} />
}

function NativeMessageText({ matched }: { readonly matched: NativeMessageActivation }) {
  return <div data-agent-rp-native-message="true" style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
    {matched.display.segments.map((segment, index) => segment.kind === 'markdown'
      ? <MarkdownText key={index} text={segment.text} />
      : <NativeInlineMessage key={index} source={segment.source} />)}
  </div>
}

type UserRendererProps = PropsRuntime<'conversation.chat.userText'> & { readonly matched: NativeMessageActivation }
type AssistantRendererProps = PropsRuntime<'conversation.chat.assistantText'> & { readonly matched: NativeMessageActivation }

function NativeUserMessageText({ matched }: UserRendererProps) {
  return <NativeMessageText matched={matched} />
}

function NativeAssistantMessageText({ matched }: AssistantRendererProps) {
  return <NativeMessageText matched={matched} />
}

/**
 * Register selectors that close over one immutable Session revision.
 *
 * @param ctx - Agent RP client context.
 * @param table - exact Session routing table, or undefined while Roleplay projection is unavailable.
 */
export function useNativeMessageRenderers(
  ctx: Context,
  table: NativeMessageActivationTable | undefined,
): void {
  useLayoutEffect(() => {
    if (table === undefined) return
    const selectUser = (owner: NativeUserMessageOwner, scope?: NativeMessageSelectorScope) =>
      selectNativeUserMessage(table, owner, scope)
    const selectAssistant = (owner: NativeAssistantMessageOwner, scope?: NativeMessageSelectorScope) =>
      selectNativeAssistantMessage(table, owner, scope)
    const disposeUser = ctx.slots.inject('conversation.chat.userText', () => ctx.slots.register({
      name: 'conversation.chat.userText', priority: -100, select: selectUser,
    }, NativeUserMessageText))
    const disposeAssistant = ctx.slots.inject('conversation.chat.assistantText', () => ctx.slots.register({
      name: 'conversation.chat.assistantText', priority: -100, select: selectAssistant,
    }, NativeAssistantMessageText))
    return () => {
      disposeAssistant()
      disposeUser()
    }
  }, [ctx, table])
}
