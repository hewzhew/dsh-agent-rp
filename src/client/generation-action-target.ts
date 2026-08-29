import type {
  AssistantActionOwnerProps, AssistantMessageNode, ChatSnapshot,
} from '@deepseek-ai/dsh-client-ui-chat/client'

type AssistantMessageId = AssistantActionOwnerProps['messageId']

const assistantMessagesByNodeList = new WeakMap<
  ChatSnapshot['legacy']['nodes'],
  ReadonlyMap<AssistantMessageId, AssistantMessageNode>
>()

function assistantMessages(snapshot: ChatSnapshot): ReadonlyMap<AssistantMessageId, AssistantMessageNode> {
  const nodes = snapshot.legacy.nodes
  const cached = assistantMessagesByNodeList.get(nodes)
  if (cached !== undefined) return cached
  const indexed = new Map<AssistantMessageId, AssistantMessageNode>()
  for (const node of nodes) {
    if (node.kind === 'assistant' && node.messageId !== undefined) indexed.set(node.messageId, node)
  }
  assistantMessagesByNodeList.set(nodes, indexed)
  return indexed
}

/** Resolve an alpha assistant-action owner to its durable chat message. */
export function resolveAssistantActionMessage(
  snapshot: ChatSnapshot,
  messageId: AssistantMessageId,
): AssistantMessageNode | undefined {
  return assistantMessages(snapshot).get(messageId)
}
