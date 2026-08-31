import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cardFrameCompatibilityUrl,
  compileCardFrameDocument,
  type CardFrameChatSnapshot,
} from '../src/client/card-frame.ts'
import { retainedCardFrameMessageIds } from '../src/client/card-frame-retention.ts'

const renderDepth = 12

function retainedFrameUrlCharacters(messageCount: number): number {
  const messages = Array.from({ length: messageCount }, (_, messageId) => ({
    messageId,
    role: messageId % 2 === 0 ? 'assistant' as const : 'user' as const,
    text: `${messageId}:`.padEnd(2_000, '字'),
  }))
  const retained = retainedCardFrameMessageIds(messages, renderDepth)
  let total = 0
  for (const message of messages) {
    if (!retained.has(message.messageId)) continue
    const chat: CardFrameChatSnapshot = {
      currentMessageId: message.messageId,
      messages: messages.slice(0, message.messageId + 1),
    }
    const document = compileCardFrameDocument(
      '<!doctype html><html><body><script>window.getChatMessages()</script></body></html>',
      { origin: 'http://127.0.0.1:3080', chat },
    )
    total += cardFrameCompatibilityUrl(document, `frame-${message.messageId}`).length
  }
  return total
}

test('retains only the configured visible-message tail', () => {
  const messages = Array.from({ length: 40 }, (_, messageId) => ({ messageId }))
  const retained = retainedCardFrameMessageIds(messages, renderDepth)
  assert.equal(retained.size, renderDepth)
  assert.equal(retained.has(27), false)
  assert.equal(retained.has(28), true)
  assert.equal(retained.has(39), true)
})

test('bounds accumulated production frame URLs to linear conversation growth', () => {
  const forty = retainedFrameUrlCharacters(40)
  const eighty = retainedFrameUrlCharacters(80)
  assert.ok(eighty > forty)
  assert.ok(eighty / forty < 2.25, `expected near-linear growth, received ${(eighty / forty).toFixed(3)}x`)
})
