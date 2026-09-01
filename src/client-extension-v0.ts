/** Versioned browser contract for independent DSH plugins extending Agent RP UI. */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PlayWorldSnapshot, PlayWorldTurnProjection } from './play-world-protocol.ts'

/** The API version encoded by the `@hewzhew/dsh-agent-rp/client-extension/v0` export. */
export const AGENT_RP_CLIENT_EXTENSION_API_VERSION = 0 as const

/** Ordered external sections rendered inside the Agent RP sidebar workbench. */
export const AGENT_RP_WORKBENCH_SECTION_SLOT = 'agent-rp.workbench.section' as const

/** Module-id-keyed browser view rendered inside an installed executable world. */
export const AGENT_RP_PLAY_WORLD_VIEW_SLOT = 'agent-rp.play-world.view' as const

/** Module-id-keyed compact viewport hosted beside the native DSH conversation. */
export const AGENT_RP_WORLD_SURFACE_VIEW_SLOT = 'agent-rp.world-surface.view' as const

/** Client Cordis service used by independent plugins to install ST extension bundles. */
export const AGENT_RP_ST_EXTENSION_SERVICE = 'agentRpStExtensions' as const

/** One installed ST extension contributed by a trusted DSH client plugin. */
export interface AgentRpInstalledStExtensionRegistration {
  readonly id: string
  readonly displayName: string
  readonly loadingOrder: number
  readonly dependencies?: readonly string[]
  /** Optional manifest global invoked and awaited after GENERATION_STARTED. */
  readonly generateInterceptor?: string
  /** Skip this extension's GENERATION_STARTED listeners when its interceptor replaces them. */
  readonly generationStartedEvent?: 'emit' | 'interceptor-only'
  /** Self-contained ESM bundle evaluated in the singleton extension document. */
  readonly source: string
  /** Optional stylesheet text installed in the same document. */
  readonly style?: string
}

/** Public write-only face of the singleton ST extension registry. */
export interface AgentRpInstalledStExtensionService {
  /**
   * Install one extension for the calling plugin's lifetime.
   * @param registration - Stable manifest identity and browser build output.
   * @returns Idempotent revocation for explicit early removal.
   */
  register(registration: AgentRpInstalledStExtensionRegistration): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentRpStExtensions: AgentRpInstalledStExtensionService
  }
}

/** Host actions available to one independent workbench section. */
export interface AgentRpWorkbenchSectionOwnerProps {
  /** Close the Agent RP workbench after the extension opens its own surface. */
  readonly closeWorkbench: () => void
}

/** Public identity for one character participating in an executable world. */
export interface AgentRpPlayWorldViewCharacter {
  readonly id: string
  readonly name: string
}

/** Browser-safe state and actions supplied to one module-owned world view. */
export interface AgentRpPlayWorldViewOwnerProps {
  readonly world: PlayWorldSnapshot
  readonly characters: readonly AgentRpPlayWorldViewCharacter[]
  readonly turn: PlayWorldTurnProjection | null
  readonly busy: boolean
  readonly dirty: boolean
  /** Dispatch one action id from the current Host-projected legal turn. */
  readonly dispatchAction: (actionId: string) => void
}

/** Browser-safe read-only state supplied to one compact in-conversation world view. */
export interface AgentRpWorldSurfaceViewOwnerProps {
  readonly world: PlayWorldSnapshot
  readonly characters: readonly AgentRpPlayWorldViewCharacter[]
  readonly turn: PlayWorldTurnProjection | null
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Trusted client plugins can add complete task rows without receiving Agent RP private state. */
    'agent-rp.workbench.section': {
      kind: 'list'
      scope: 'root'
      owner: AgentRpWorkbenchSectionOwnerProps
    }
    /** Trusted client plugins can render the module-owned body of an installed world. */
    'agent-rp.play-world.view': {
      kind: 'keyed'
      scope: 'root'
      owner: AgentRpPlayWorldViewOwnerProps
    }
    /** Trusted client plugins can render a compact viewport inside the native Session world surface. */
    'agent-rp.world-surface.view': {
      kind: 'keyed'
      scope: 'root'
      owner: AgentRpWorldSurfaceViewOwnerProps
    }
  }
}

/** Props received by a registered Agent RP workbench section component. */
export type AgentRpWorkbenchSectionProps = PropsRuntime<typeof AGENT_RP_WORKBENCH_SECTION_SLOT>

/** Props received by a client view registered under its Host world module id. */
export type AgentRpPlayWorldViewProps = PropsRuntime<typeof AGENT_RP_PLAY_WORLD_VIEW_SLOT>

/** Props received by a compact native Session viewport registered under its Host world module id. */
export type AgentRpWorldSurfaceViewProps = PropsRuntime<typeof AGENT_RP_WORLD_SURFACE_VIEW_SLOT>
