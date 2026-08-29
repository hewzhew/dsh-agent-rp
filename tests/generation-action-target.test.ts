import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  AssistantActionOwnerProps, AssistantMessageNode, ChatSnapshot,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { resolveAssistantActionMessage } from '../src/client/generation-action-target.ts'

function message(
  messageId: AssistantActionOwnerProps['messageId'],
  seq: number,
  turn: number,
): AssistantMessageNode {
  return {
    kind: 'assistant',
    messageId,
    seq,
    turn,
    step: 1,
    time: 1,
    blocks: [],
  }
}

function snapshot(nodes: readonly AssistantMessageNode[]): ChatSnapshot {
  return { legacy: { nodes } } as unknown as ChatSnapshot
}

test('resolves native assistant actions by stable message identity', () => {
  const firstId = 'assistant-first' as AssistantActionOwnerProps['messageId']
  const latestId = 'assistant-latest' as AssistantActionOwnerProps['messageId']
  const latest = message(latestId, 42, 7)

  assert.equal(resolveAssistantActionMessage(snapshot([
    message(firstId, 42, 6),
    latest,
  ]), latestId), latest)
})

test('ignores action owners that do not address a loaded assistant message', () => {
  const loadedId = 'assistant-loaded' as AssistantActionOwnerProps['messageId']
  const absentId = 'assistant-absent' as AssistantActionOwnerProps['messageId']

  assert.equal(resolveAssistantActionMessage(snapshot([
    message(loadedId, 12, 2),
  ]), absentId), undefined)
})
