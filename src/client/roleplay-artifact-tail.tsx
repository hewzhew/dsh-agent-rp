/** Per-turn browser projection and player-facing rendering for staged RP artifacts. */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { useEffect, useState } from 'react'
import {
  normalizeRoleplayTurnPresentation,
} from '../roleplay-turn-presentation-state.ts'
import type {
  RoleplayPresentedArtifact,
  RoleplayTurnPresentation,
} from '../roleplay-turn-presentation-types.ts'

/** DSH requires a Location data key to equal its owning Conversation Definition kind. */
const ROLEPLAY_PRESENTATION_KIND = 'agent-rp/presentation'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Latest replayable RP presentation snapshot for this exact Turn. */
    'agent-rp/presentation': RoleplayTurnPresentation
  }
}

interface RoleplayPresentationState {
  readonly presentation: RoleplayTurnPresentation
}

function presentationFromEvent(event: unknown): RoleplayTurnPresentation | undefined {
  if (typeof event !== 'object' || event === null) return undefined
  const record = event as { readonly type?: unknown; readonly data?: unknown }
  if (record.type !== 'agent-rp/turn-presentation'
    || typeof record.data !== 'object' || record.data === null || Array.isArray(record.data)) return undefined
  const presentation = record.data as RoleplayTurnPresentation
  if (presentation.format !== 0 || !Number.isSafeInteger(presentation.turn) || presentation.turn < 0
    || typeof presentation.sessionId !== 'string' || typeof presentation.trigger !== 'object'
    || presentation.trigger === null || !Array.isArray(presentation.state)
    || typeof presentation.present !== 'object' || presentation.present === null
    || !Array.isArray(presentation.present.modules)) return undefined
  return normalizeRoleplayTurnPresentation(presentation)
}

const roleplayPresentationDefinition: ConversationNodeDefinition<RoleplayPresentationState> = {
  kind: ROLEPLAY_PRESENTATION_KIND,
  match: (event) => {
    const presentation = presentationFromEvent(event)
    if (presentation === undefined) return null
    return {
      id: String(presentation.turn),
      role: presentation.trigger.kind === 'settlement' ? 'start' : 'update',
    }
  },
  start: (_context, match) => {
    const presentation = presentationFromEvent(match.event)
    if (presentation === undefined) throw new Error('Agent RP presentation start is invalid')
    return { presentation }
  },
  update: (_context, match) => {
    const presentation = presentationFromEvent(match.event)
    if (presentation === undefined) throw new Error('Agent RP presentation update is invalid')
    return { presentation }
  },
  publication: () => 'immediate',
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
        kind: 'turn',
        turn: context.state.presentation.turn,
        key: ROLEPLAY_PRESENTATION_KIND,
        value: context.state.presentation,
      },
}

type ArtifactTailOwner = TurnTailOwnerProps & {
  readonly loadImage?: (attachment: ImageAttachmentRef) => Promise<string>
}

function RoleplayArtifactImage({ artifact, loadImage }: {
  readonly artifact: RoleplayPresentedArtifact
  readonly loadImage?: (attachment: ImageAttachmentRef) => Promise<string>
}) {
  const [state, setState] = useState<{ readonly url?: string; readonly error?: string }>({})
  useEffect(() => {
    let active = true
    setState({})
    if (loadImage === undefined) {
      setState({ error: '当前 DSH 版本尚未提供历史图片读取能力' })
      return () => { active = false }
    }
    void loadImage(artifact.attachment).then(
      url => { if (active) setState({ url }) },
      reason => {
        if (active) setState({ error: reason instanceof Error ? reason.message : '图片读取失败' })
      },
    )
    return () => { active = false }
  }, [artifact.attachment, loadImage])

  return <figure data-agent-rp-staged-artifact={artifact.artifactId} style={{
    alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: '7px', margin: 0,
    maxWidth: 'min(100%, 760px)', minWidth: 0,
  }}>
    {state.url !== undefined
      ? <img src={state.url} alt={artifact.caption ?? ''} loading="lazy" style={{
        background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #34343a)',
        borderRadius: '12px', display: 'block', height: 'auto', maxHeight: 'min(72vh, 760px)',
        maxWidth: '100%', objectFit: 'contain', width: 'auto',
      }} />
      : <div role={state.error === undefined ? 'status' : 'alert'} style={{
        alignItems: 'center', background: 'var(--dsw-alias-bg-layer-1, #202024)',
        border: '1px solid var(--dsw-alias-border-l2, #34343a)', borderRadius: '12px',
        color: state.error === undefined ? 'inherit' : 'var(--dsw-alias-state-error, #dc7777)',
        display: 'flex', fontSize: '12px', justifyContent: 'center', minHeight: '112px',
        opacity: state.error === undefined ? .52 : .8, padding: '14px',
      }}>{state.error ?? '正在读取舞台图片…'}</div>}
    {artifact.caption !== undefined && <figcaption style={{
      fontSize: '12px', lineHeight: 1.55, opacity: .62, padding: '0 2px', whiteSpace: 'pre-wrap',
    }}>{artifact.caption}</figcaption>}
  </figure>
}

function RoleplayArtifactTail({ owner }: { readonly owner: ArtifactTailOwner }) {
  const presentation = owner.turn.data.get(ROLEPLAY_PRESENTATION_KIND)
  const artifacts = presentation?.selectedReply?.surfaceSeq === owner.seq
    ? presentation.present.artifacts ?? []
    : []
  if (artifacts.length === 0) return null
  return <div data-agent-rp-staged-artifacts style={{
    display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0,
  }}>
    {artifacts.map((artifact, index) => <RoleplayArtifactImage
      key={`${artifact.artifactId}:${index}`}
      artifact={artifact}
      {...owner.loadImage === undefined ? {} : { loadImage: owner.loadImage }}
    />)}
  </div>
}

/** Register replay projection and the independent turnTail surface. */
export function installRoleplayArtifactTail(ctx: Context): void {
  ctx.effect(
    () => ctx.uiConversation.events.register(roleplayPresentationDefinition),
    'agent-rp: project per-turn presentation artifacts',
  )
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    priority: 80,
    select: owner => {
      const presentation = owner.turn.data.get(ROLEPLAY_PRESENTATION_KIND)
      return presentation?.selectedReply?.surfaceSeq === owner.seq
        && (presentation.present.artifacts?.length ?? 0) > 0
        ? {}
        : null
    },
  }, props => <RoleplayArtifactTail owner={props as ArtifactTailOwner} />))
}
