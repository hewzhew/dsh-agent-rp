/** First-party resource recipes for trusted executable play worlds. */

import {
  createFlyingChessWorldModule,
} from './flying-chess-world.ts'
import { FLYING_CHESS_WORLD_MODULE_ID } from './flying-chess-protocol.ts'
import type { RoleplayResourceProvider } from './roleplay-resource-catalog.ts'
import type { RoleplayWorldCastSlotDetail } from './roleplay-resource-catalog-protocol.ts'

/** Stable resource selected by a workspace before the trusted flying-chess module is invoked. */
export const FLYING_CHESS_WORLD_RESOURCE_ID = 'world:agent-rp/flying-chess'

/** Character-card openings recommended by the first-party Touhou play-space recipe. */
export const FLYING_CHESS_WORLD_CAST_SLOTS: readonly RoleplayWorldCastSlotDetail[] = Object.freeze([
  Object.freeze({
    id: 'reimu',
    name: '博丽灵梦',
    aliases: Object.freeze(['博麗霊夢', '霊夢']),
    description: '第一位棋手；身份、语气与人物指令来自所选角色卡。',
    required: true,
  }),
  Object.freeze({
    id: 'marisa',
    name: '雾雨魔理沙',
    aliases: Object.freeze(['霧雨魔理沙', '魔理沙']),
    description: '第二位棋手；身份、语气与人物指令来自所选角色卡。',
    required: true,
  }),
  Object.freeze({
    id: 'guest-1',
    name: '追加人物 1',
    aliases: Object.freeze([]),
    description: '可选的第三位棋手。',
    required: false,
  }),
  Object.freeze({
    id: 'guest-2',
    name: '追加人物 2',
    aliases: Object.freeze([]),
    description: '可选的第四位棋手。',
    required: false,
  }),
])

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
        castSlots: FLYING_CHESS_WORLD_CAST_SLOTS,
      },
    }),
    projectWorld: selection => {
      if (selection.variant !== undefined) throw new Error('幻想乡飞行棋不提供资源变体')
      return {
        moduleId: FLYING_CHESS_WORLD_MODULE_ID,
        configuration: { format: 0, ruleset: 'classic-24' },
        sources: [],
        castSlots: FLYING_CHESS_WORLD_CAST_SLOTS,
      }
    },
  }
}
