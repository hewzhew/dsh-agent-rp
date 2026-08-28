/** Isolated card-display rendering and remote-resource approval UI. */

import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentRpProjection } from '../projection-types.ts'
import type { CompiledCharacterDisplay } from '../frontend-regex.ts'
import type { ImportedTavernHelperScript } from '../import/types.ts'
import {
  type CharacterLibraryDetail,
  type CharacterRemoteResourceApproval,
  type CharacterRemoteResourceType,
} from '../character-library-protocol.ts'
import { cardRemoteResourceApprovalKey } from '../card-remote-resource.ts'
import { substituteSillyTavernIdentityMacros } from '../sillytavern-identity-macro.ts'
import type { CardFrameAppearance } from './card-frame-appearance.ts'
import {
  blockedCardFrameResources,
  cardFrameDiagnosticSummary,
  cardFrameCompatibilityUrl,
  compileCardFrames,
  type CardFrameGreetingChoices,
} from './card-frame.ts'
import {
  notifyCharacterLibraryChanged,
  updateCharacterRemoteResource,
  updateCharacterRemoteResourcePolicy,
} from './character-library-client.ts'

const cardFrameRevealFallbackMs = 250

const cardMarkdownLabels: MarkdownLabels = {
  code: { copyLabel: '复制代码', copiedLabel: '已复制' },
  footnotes: '脚注',
}

/** Event emitted by a card frame after the Host sanitizer blocks a remote resource. */
export const cardResourceBlockedEvent = 'agent-rp:card-resource-blocked'

/** User-facing labels for separately approved remote resource classes. */
export const cardResourceTypeLabel: Readonly<Record<CharacterRemoteResourceType, string>> = {
  connect: '数据连接', font: '字体', frame: '内嵌页面', image: '图片', media: '音视频', script: '脚本', style: '样式',
}

const miniButtonStyle = {
  background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #424248)', borderRadius: '6px', color: 'inherit',
  cursor: 'pointer', font: 'inherit', fontSize: '11px', height: '25px', minWidth: '25px', padding: '2px 6px',
} as const

function BlockedCardResources({ character, resources }: {
  readonly character: CharacterLibraryDetail
  readonly resources: readonly CharacterRemoteResourceApproval[]
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return <div role="note" style={{
    background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
    borderRadius: '10px', fontSize: '12px', lineHeight: 1.55, padding: '12px 14px',
  }}>
    <strong style={{ display: 'block', fontSize: '13px' }}>外部界面尚未加载</strong>
    <span style={{ display: 'block', marginTop: '3px', opacity: .56 }}>
      这段界面请求了 {resources.map(resource =>
        `${new URL(resource.origin).hostname} 的${cardResourceTypeLabel[resource.type]}`).join('、')}；每类权限彼此独立，确认后仍只在隔离页面中运行
    </span>
    <button type="button" disabled={busy} onClick={() => {
      setBusy(true)
      setError(undefined)
      void (async () => {
        let changed = false
        try {
          for (const resource of resources) {
            await updateCharacterRemoteResource(character.id, resource.origin, resource.type, true)
            changed = true
          }
        } finally {
          if (changed) notifyCharacterLibraryChanged(character.id)
        }
      })().then(() => {
        setBusy(false)
      }, reason => {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    }} style={{ ...miniButtonStyle, marginTop: '9px' }}>{busy ? '正在确认…' : `允许这 ${resources.length} 项并重新加载`}</button>
    <button type="button" disabled={busy} onClick={() => {
      setBusy(true)
      setError(undefined)
      void updateCharacterRemoteResourcePolicy(character.id, 'isolated-https').then(() => {
        setBusy(false)
        notifyCharacterLibraryChanged(character.id)
      }, reason => {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    }} style={{ ...miniButtonStyle, marginLeft: '7px', marginTop: '9px' }}>
      本卡启用兼容测试模式
    </button>
    <span style={{ display: 'block', fontSize: '10px', lineHeight: 1.5, marginTop: '7px', opacity: .48 }}>
      测试模式会持久允许本卡的 HTTPS 网络资源，但 iframe 仍不能访问 DSH 页面、文件或同源数据
    </span>
    {error !== undefined && <span role="alert" style={{ color: '#e88989', display: 'block', marginTop: '6px' }}>{error}</span>}
  </div>
}

function CardFrameView({
  appearance, character, characterName, frameToken, onFrameRegistration, preview, segment, segmentIndex,
}: {
  readonly appearance?: CardFrameAppearance
  readonly character?: CharacterLibraryDetail
  readonly characterName: string
  readonly frameToken?: string
  readonly onFrameRegistration?: (token: string, frame: HTMLIFrameElement | null) => void
  readonly preview: boolean
  readonly segment: Extract<ReturnType<typeof compileCardFrames>['segments'][number], { readonly kind: 'frame' }>
  readonly segmentIndex: number
}) {
  const [discovered, setDiscovered] = useState<readonly CharacterRemoteResourceApproval[]>([])
  const registration = useRef<{ readonly frame: HTMLIFrameElement; readonly listener: EventListener }>()
  const receiveBlockedResource = useCallback((event: Event): void => {
    const resource = (event as CustomEvent<CharacterRemoteResourceApproval>).detail
    setDiscovered(current => {
      const values = new Map(current.map(value => [cardRemoteResourceApprovalKey(value), value] as const))
      values.set(cardRemoteResourceApprovalKey(resource), resource)
      return [...values.values()].slice(0, 32)
    })
  }, [])
  const registerFrame = useCallback((frame: HTMLIFrameElement | null): void => {
    const previous = registration.current
    if (previous !== undefined) {
      previous.frame.removeEventListener(cardResourceBlockedEvent, previous.listener)
      if (frameToken !== undefined) onFrameRegistration?.(frameToken, null)
      registration.current = undefined
    }
    if (frame === null || frameToken === undefined) return
    const listener: EventListener = receiveBlockedResource
    frame.addEventListener(cardResourceBlockedEvent, listener)
    registration.current = { frame, listener }
    onFrameRegistration?.(frameToken, frame)
  }, [frameToken, onFrameRegistration, receiveBlockedResource])
  const requested = new Map([...segment.remoteResources, ...discovered]
    .map(resource => [cardRemoteResourceApprovalKey(resource), resource] as const))
  const blocked = character === undefined ? [] : blockedCardFrameResources([...requested.values()], character)
  if (!preview && blocked.length > 0) return <BlockedCardResources character={character!} resources={blocked} />
  // A document's scrollHeight cannot shrink below its iframe viewport. Seed
  // live frames at the minimum accepted resize height; a viewport-sized seed
  // would otherwise lock compact/fixed status bars into a screen-tall blank box.
  return <iframe
    title={`${characterName}的轻前端界面 ${segmentIndex + 1}`}
    data-agent-rp-frame
    data-agent-rp-frame-kind={segment.sourceKind}
    data-agent-rp-frame-token={frameToken}
    ref={registerFrame}
    sandbox={preview ? '' : 'allow-scripts allow-same-origin'}
    {...(preview
      ? { srcDoc: segment.srcDoc }
      : { src: cardFrameCompatibilityUrl(segment.srcDoc, frameToken) })}
    onLoad={event => {
      const frame = event.currentTarget
      frame.contentWindow?.postMessage({ source: 'dsh-agent-rp-host', action: 'request-resize' }, '*')
      window.setTimeout(() => {
        if (frame.isConnected && frame.style.visibility === 'hidden') frame.style.visibility = 'visible'
      }, cardFrameRevealFallbackMs)
    }}
    style={{
      background: appearance?.backgroundColor ?? 'transparent', border: 0, colorScheme: 'dark', display: 'block',
      height: preview ? 'min(52vh, 480px)' : '72px', maxWidth: '100%',
      visibility: preview ? 'visible' : 'hidden', width: '100%',
    }}
  />
}

/** Render compiled Markdown and isolated light-frontend segments. */
export function CharacterDisplay({
  appearance, capabilityToken, compilation, statData, characterName, character, compatibilityMarkers, greetingChoices,
  onFrameRegistration, onReady, preview = false, tavernHelperScripts, variableScopes,
}: {
  readonly appearance?: CardFrameAppearance
  readonly capabilityToken?: string
  readonly compilation: CompiledCharacterDisplay
  readonly statData: NonNullable<AgentRpProjection['mvu']>['statData'] | undefined
  readonly characterName: string
  readonly character?: CharacterLibraryDetail
  readonly compatibilityMarkers?: readonly string[]
  readonly greetingChoices?: CardFrameGreetingChoices
  readonly tavernHelperScripts?: readonly ImportedTavernHelperScript[]
  readonly variableScopes?: NonNullable<AgentRpProjection['tavern']>['scopes']
  readonly onFrameRegistration?: (token: string, frame: HTMLIFrameElement | null) => void
  readonly onReady?: () => void
  readonly preview?: boolean
}) {
  const compiled = useMemo(() => compileCardFrames(compilation, {
    origin: window.location.origin,
    ...(appearance === undefined ? {} : { appearance }),
    ...(statData === undefined ? {} : { statData }),
    ...(character === undefined ? {} : { character }),
    ...(compatibilityMarkers === undefined ? {} : { compatibilityMarkers }),
    ...(greetingChoices === undefined ? {} : { greetingChoices }),
    ...(tavernHelperScripts === undefined ? {} : {
      currentCharacter: { name: characterName, tavernHelperScripts },
    }),
    ...(variableScopes === undefined ? {} : { variableScopes }),
    ...(capabilityToken === undefined ? {} : { capabilityToken }),
  }), [appearance, capabilityToken, character, characterName, compatibilityMarkers, compilation, greetingChoices, statData, tavernHelperScripts, variableScopes])
  useLayoutEffect(() => { onReady?.() }, [onReady])
  return <div data-agent-rp-character-display data-agent-rp-display-diagnostics={cardFrameDiagnosticSummary(compiled.diagnostics)}
    style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
    {compiled.segments.map((segment, index) => {
      if (segment.kind === 'markdown') return <MarkdownText key={index} text={segment.text} labels={cardMarkdownLabels} />
      if (preview && segment.interactive) return <div key={index} role="note" style={{
            alignItems: 'center', background: 'var(--dsw-alias-bg-layer-1, #202024)',
            border: '1px solid var(--dsw-alias-border-l2, #39393c)', borderRadius: '10px',
            display: 'flex', gap: '11px', minHeight: '92px', padding: '15px 16px',
          }}>
            <span aria-hidden="true" style={{ fontSize: '20px', opacity: .7 }}>◇</span>
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: '13px' }}>交互式开场</strong>
              <span style={{ display: 'block', fontSize: '11px', lineHeight: 1.55, marginTop: '4px', opacity: .56 }}>
                这段内容需要脚本或外部界面，开始新对话后再启动；角色库不会在后台运行它
              </span>
            </span>
          </div>
      const frameToken = capabilityToken === undefined ? undefined : `${capabilityToken}:${index}`
      return <CardFrameView key={index} characterName={characterName} preview={preview}
        segment={segment} segmentIndex={index}
        {...(segment.sourceKind !== 'inline-html' || appearance === undefined ? {} : { appearance })}
        {...(character === undefined ? {} : { character })}
        {...(frameToken === undefined ? {} : { frameToken })}
        {...(onFrameRegistration === undefined ? {} : { onFrameRegistration })} />
    })}
  </div>
}

/** Build bounded greeting choices for the card-frame runtime. */
export function cardFrameGreetingChoices(
  projection: AgentRpProjection,
  character: CharacterLibraryDetail | undefined,
): CardFrameGreetingChoices | undefined {
  if (character === undefined) return undefined
  const characterName = projection.characterName
  const userName = projection.userName ?? '用户'
  const alternatives = character.greetings.slice(0, 256).map(greeting =>
    substituteSillyTavernIdentityMacros(greeting, { characterName, userName }).trim(),
  ).filter(greeting => greeting.length <= 2 * 1024 * 1024)
  if (alternatives.length === 0) return undefined
  const selected = projection.tavern?.messages.find(message => message.messageId === 0)?.text ?? alternatives[0]!
  return { selected, alternatives }
}
