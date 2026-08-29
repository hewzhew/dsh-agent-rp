import assert from 'node:assert/strict'
import test from 'node:test'
import { auditCharacterCardCompatibility } from '../scripts/audit-card-compat.ts'

function compatibilityCard(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '审计角色',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '你好。',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: 'fixture',
      character_version: '1.0',
      extensions: {},
      character_book: {
        name: '审计角色世界书',
        extensions: {},
        entries: [
          {
            id: 1,
            keys: [],
            secondary_keys: [],
            content: [
              '<% if (charLoreBook !== "审计角色世界书") throw new Error("wrong character world"); %>',
              '<% if (Date.now() === 0) throw new Error("missing replay time"); %>',
              '<%= await getwi(charLoreBook, "审计资料") %>',
            ].join(''),
            enabled: true,
            insertion_order: 1,
            constant: true,
            selective: false,
            position: 'before_char',
            name: '审计控制器',
            use_regex: false,
            extensions: {},
          },
          {
            id: 2,
            keys: [],
            secondary_keys: [],
            content: '审计资料已读取',
            enabled: false,
            insertion_order: 2,
            constant: false,
            selective: false,
            position: 'before_char',
            name: '审计资料',
            use_regex: false,
            extensions: {},
          },
        ],
      },
    },
  }))
}

test('audits EJS with the product character-world and replay-time context', async () => {
  const report = await auditCharacterCardCompatibility('fixture.json', compatibilityCard())

  assert.deepEqual(report.ejs.outcomes, { ok: 1 })
  assert.deepEqual(report.worldInfo?.templateOutcomes, { rendered: 1 })
})
