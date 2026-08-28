import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeStorySourceFile,
  MAX_STORY_SOURCE_FILE_BYTES,
  storySourceNameFromFile,
} from '../src/client/story-source-file.ts'

test('decodes UTF-8, UTF-16 and common Chinese TXT encodings', () => {
  assert.equal(decodeStorySourceFile(new TextEncoder().encode('第一章\r\n灵梦出场。')), '第一章\n灵梦出场。')
  assert.equal(decodeStorySourceFile(new Uint8Array([0xff, 0xfe, 0x2c, 0x7b, 0x00, 0x4e, 0xe0, 0x7a])), '第一章')
  assert.equal(decodeStorySourceFile(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])), '中文')
})

test('rejects empty, binary and oversized local sources', () => {
  assert.throws(() => decodeStorySourceFile(new TextEncoder().encode('  \n')), /没有可导入/u)
  assert.throws(() => decodeStorySourceFile(new Uint8Array([0x41, 0, 0x42])), /二进制/u)
  assert.throws(() => decodeStorySourceFile(new Uint8Array(MAX_STORY_SOURCE_FILE_BYTES + 1)), /不能超过/u)
})

test('uses the local filename as an editable source title', () => {
  assert.equal(storySourceNameFromFile('  东方红魔乡.md  '), '东方红魔乡')
  assert.equal(storySourceNameFromFile('.txt'), '导入的原著资料')
  assert.equal(storySourceNameFromFile(`${'原'.repeat(130)}.txt`).length, 120)
})
