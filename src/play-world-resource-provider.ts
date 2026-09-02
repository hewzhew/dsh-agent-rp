/** First-party resource recipes for trusted executable play worlds. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  createFlyingChessWorldModule,
} from './flying-chess-world.ts'
import {
  FLYING_CHESS_WORLD_MODULE_ID,
  type FlyingChessWorldConfiguration,
} from './flying-chess-protocol.ts'
import type { RoleplayResourceProvider } from './roleplay-resource-catalog.ts'
import type { RoleplayWorldCastSlotDetail } from './roleplay-resource-catalog-protocol.ts'

/** Stable resource selected by a workspace before the trusted flying-chess module is invoked. */
export const FLYING_CHESS_WORLD_RESOURCE_ID = 'world:agent-rp/flying-chess'

/** Structured rule and narrative recipe installed by the built-in flying-chess resource. */
export const FLYING_CHESS_WORLD_CONFIGURATION = {
  format: 0,
  ruleset: 'classic-24',
  narrativeCards: [{
    id: 'first-launch-hidden-slip',
    trigger: { kind: 'piece-launched' },
    event: {
      title: '第一格下露出一张折签',
      summary: '本局第一架木机离开基地后，航线第一格下压着的一张折签露出画着问号的背面；签文仍被棋盘遮住。',
    },
    cue: {
      kind: 'opportunity',
      text: '折签尚未翻开，也不妨碍棋局；在场人物已经看见这里藏着东西，可以先继续走棋，等它自行揭开。',
      responders: 'all',
    },
    repeat: false,
  }, {
    id: 'stalled-opening-wind',
    trigger: { kind: 'consecutive-passes', count: 4 },
    event: {
      title: '棋盘被风掀动',
      summary: '接连几轮都没有飞机起飞时，一阵风掀起棋盘一角，基地里的木机随之晃动。',
    },
    cue: {
      kind: 'pressure',
      text: '棋盘需要先被重新压稳。刚完成本轮行动的人物可以决定怎样处理；动作完成后，其他人物只能在后续轮次回应。',
      responders: 'actor',
    },
    repeat: false,
  }, {
    id: 'question-slip-step-eight',
    trigger: { kind: 'piece-landed', step: 8 },
    event: {
      title: '格子下的折签弹开',
      summary: '一架木机停在航线第 8 步时，格子下压着的折签弹开，正面写着“可以向另一位棋手提一个问题；对方可以拒答”。',
    },
    cue: {
      kind: 'opportunity',
      text: '刚移动棋子的人物获得一次明确的提问机会，可以立即使用、留到以后或放弃；只有问题真正说出后，另一位人物才获得回答前提。',
      responders: 'actor',
      opportunity: {
        kind: 'speech',
        move: 'question',
        targets: 'opponents',
      },
    },
    repeat: false,
  }],
} satisfies FlyingChessWorldConfiguration & JsonValue
for (const card of FLYING_CHESS_WORLD_CONFIGURATION.narrativeCards) {
  Object.freeze(card.trigger)
  Object.freeze(card.event)
  if (card.cue.opportunity !== undefined) Object.freeze(card.cue.opportunity)
  Object.freeze(card.cue)
  Object.freeze(card)
}
Object.freeze(FLYING_CHESS_WORLD_CONFIGURATION.narrativeCards)
Object.freeze(FLYING_CHESS_WORLD_CONFIGURATION)

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
        configuration: FLYING_CHESS_WORLD_CONFIGURATION,
        sources: [],
        castSlots: FLYING_CHESS_WORLD_CAST_SLOTS,
      }
    },
  }
}
