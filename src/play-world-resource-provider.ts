/** First-party resource recipes for trusted executable play worlds. */

import {
  createFlyingChessWorldModule,
} from './flying-chess-world.ts'
import { FLYING_CHESS_WORLD_MODULE_ID } from './flying-chess-protocol.ts'
import type { RoleplayResourceProvider } from './roleplay-resource-catalog.ts'

/** Stable resource selected by a workspace before the trusted flying-chess module is invoked. */
export const FLYING_CHESS_WORLD_RESOURCE_ID = 'world:agent-rp/flying-chess'

/** Publish the built-in flying-chess rules as a resource-owned installation recipe. */
export function flyingChessWorldResourceProvider(): RoleplayResourceProvider {
  const descriptor = createFlyingChessWorldModule().descriptor
  return {
    id: 'agent-rp:play-worlds',
    list: () => [{
      id: FLYING_CHESS_WORLD_RESOURCE_ID,
      kind: 'world',
      name: descriptor.name,
      availability: 'available',
    }],
    inspect: () => ({
      kind: 'world',
      entryCount: 0,
      playWorld: {
        moduleId: descriptor.id,
        summary: descriptor.summary,
        category: descriptor.category,
        minCharacters: descriptor.minCharacters,
        maxCharacters: descriptor.maxCharacters,
      },
    }),
    projectWorld: selection => {
      if (selection.variant !== undefined) throw new Error('幻想乡飞行棋不提供资源变体')
      return {
        moduleId: FLYING_CHESS_WORLD_MODULE_ID,
        configuration: { format: 0, ruleset: 'classic-24' },
        sources: [],
      }
    },
  }
}
