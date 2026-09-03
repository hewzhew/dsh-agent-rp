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
      title: '棋盘下露出半张折签',
      summary: '本局第一架木机驶上航线时，棋盘边缘轻轻一错，一张折签从棋盘下滑出半截，只露出画着问号的背面；写字的正面仍被压在下面。',
    },
    cue: {
      kind: 'change',
      text: '这张折签仍被棋盘压住，只作为所有在场人物都能看见的未完现场线索保留。',
      responders: 'none',
    },
    repeat: false,
  }, {
    id: 'stalled-opening-wind',
    trigger: { kind: 'consecutive-passes', count: 4 },
    event: {
      title: '棋盘被风掀动',
      summary: '一阵风忽然掀起棋盘一角，基地里的木机随之晃动。',
    },
    cue: {
      kind: 'pressure',
      text: '棋盘需要先被重新压稳。刚完成本轮行动的人物可以决定怎样处理；动作完成后，其他人物只能在后续轮次回应。',
      responders: 'actor',
    },
    repeat: false,
  }, {
    id: 'question-slip-step-eight',
    afterCardId: 'first-launch-hidden-slip',
    trigger: { kind: 'piece-landed', step: 8 },
    event: {
      title: '那张折签被带出棋盘',
      summary: '一架木机停在航线第 8 步时，底座勾住先前露出的那张折签，将它从棋盘下完整带出；正面写着“可以向另一位棋手提一个问题；对方可以拒答”。',
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
