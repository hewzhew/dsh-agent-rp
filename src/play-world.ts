/** Registry and lifecycle boundary for executable play-space worlds. */

import type { StoryCharacter } from './story-workspace-protocol.ts'
import { createFlyingChessWorldModule } from './flying-chess-world.ts'
import type {
  PlayWorldModuleDescriptor,
  PlayWorldPromptProjection,
  PlayWorldSnapshot,
} from './play-world-protocol.ts'

/** Inputs available when a module creates or advances one world instance. */
export interface PlayWorldContext {
  readonly characters: readonly StoryCharacter[]
}

/** One legal character choice whose executable payload stays inside its owning module. */
export interface PlayWorldCharacterAction {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly action: unknown
}

/** One module-defined character turn that may require several consecutive choices. */
export interface PlayWorldCharacterTurn {
  readonly id: string
  readonly characterId: string
  readonly instruction: string
  readonly actions: readonly PlayWorldCharacterAction[]
}

/** Host implementation of one typed, deterministic world transition system. */
export interface PlayWorldModule {
  readonly descriptor: PlayWorldModuleDescriptor
  /** Create one fresh authoritative snapshot. */
  create(context: PlayWorldContext): PlayWorldSnapshot
  /** Parse durable state owned by this module. */
  normalize(value: unknown, context: PlayWorldContext): PlayWorldSnapshot
  /** Apply one validated action and return the complete next snapshot. */
  dispatch(snapshot: PlayWorldSnapshot, action: unknown, context: PlayWorldContext): PlayWorldSnapshot
  /** Return only the legal choices for the character currently controlling the world. */
  characterTurn(snapshot: PlayWorldSnapshot, context: PlayWorldContext): PlayWorldCharacterTurn | undefined
  /** Project only knowledge available to one character Worker. */
  projectForCharacter(snapshot: PlayWorldSnapshot, characterId: string, context: PlayWorldContext): PlayWorldPromptProjection
  /** Project authoritative state for the director Worker. */
  projectForDirector(snapshot: PlayWorldSnapshot, context: PlayWorldContext): PlayWorldPromptProjection
  /** Render selected authoritative events as the immutable first paragraph of story prose. */
  renderEventNarrative(snapshot: PlayWorldSnapshot, eventSequences: readonly number[], context: PlayWorldContext): string
}

/** Installed world modules keyed by stable module id. */
export class PlayWorldRegistry {
  readonly #modules = new Map<string, PlayWorldModule>()

  /** Register one module and reject ambiguous ownership. */
  register(module: PlayWorldModule): void {
    if (this.#modules.has(module.descriptor.id)) {
      throw new Error(`游玩世界模块 ${JSON.stringify(module.descriptor.id)} 重复注册`)
    }
    this.#modules.set(module.descriptor.id, module)
  }

  /** List installed modules in stable presentation order. */
  list(): readonly PlayWorldModuleDescriptor[] {
    return [...this.#modules.values()].map(module => module.descriptor)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Resolve one installed module or fail before state can be changed. */
  get(id: string): PlayWorldModule {
    const module = this.#modules.get(id)
    if (module === undefined) throw new Error(`游玩世界模块 ${JSON.stringify(id)} 未安装`)
    return module
  }

  /** Parse one durable world through its owning module. */
  normalize(value: unknown, context: PlayWorldContext): PlayWorldSnapshot {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || typeof (value as { readonly moduleId?: unknown }).moduleId !== 'string') {
      throw new Error('游玩世界快照无效')
    }
    return this.get((value as { readonly moduleId: string }).moduleId).normalize(value, context)
  }
}

/** Create the first-party world registry used by local story workspaces. */
export function createDefaultPlayWorldRegistry(): PlayWorldRegistry {
  const registry = new PlayWorldRegistry()
  registry.register(createFlyingChessWorldModule())
  return registry
}
