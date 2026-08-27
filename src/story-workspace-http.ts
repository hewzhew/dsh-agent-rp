/** Same-origin HTTP surface for editable story workspaces. */

import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  jsonResponse as json,
  readJsonRequest,
  trustedBrowserRequest,
  type AgentRpHttpServer,
} from './host-http.ts'
import {
  STORY_WORKSPACES_PATH,
  type StoryWorkspaceCreateRequest,
  type StoryWorkspaceSaveRequest,
} from './story-workspace-protocol.ts'
import { StoryWorkspaceStore } from './story-workspace.ts'

const MAX_STORY_WORKSPACE_REQUEST_BYTES = 17 * 1024 * 1024

async function readJson(request: IncomingMessage): Promise<unknown> {
  return readJsonRequest(request, {
    limit: MAX_STORY_WORKSPACE_REQUEST_BYTES,
    emptyMessage: '故事工作区请求为空',
    tooLargeMessage: '故事工作区请求过大',
    invalidMessage: '故事工作区请求不是有效 JSON',
  })
}

function requestRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('故事工作区请求不是对象')
  return value as Record<string, unknown>
}

function parseCreateRequest(value: unknown): StoryWorkspaceCreateRequest {
  const record = requestRecord(value)
  if (record.format !== 1 || typeof record.name !== 'string'
    || Object.keys(record).some(key => key !== 'format' && key !== 'name')) {
    throw new Error('故事工作区创建请求字段无效')
  }
  return record as unknown as StoryWorkspaceCreateRequest
}

function parseSaveRequest(value: unknown, id: string): StoryWorkspaceSaveRequest {
  const record = requestRecord(value)
  const keys = new Set(['format', 'id', 'revision', 'name', 'pipeline', 'graph', 'characters', 'facts', 'events', 'outputs', 'sources', 'citations'])
  if (record.format !== 1 || record.id !== id || typeof record.revision !== 'number'
    || typeof record.name !== 'string' || typeof record.pipeline !== 'object' || record.pipeline === null
    || Array.isArray(record.pipeline) || typeof record.graph !== 'object' || record.graph === null
    || Array.isArray(record.graph) || !Array.isArray(record.characters) || !Array.isArray(record.facts)
    || !Array.isArray(record.events) || !Array.isArray(record.outputs) || !Array.isArray(record.sources)
    || !Array.isArray(record.citations)
    || Object.keys(record).some(key => !keys.has(key))) {
    throw new Error('故事工作区保存请求字段无效')
  }
  return record as unknown as StoryWorkspaceSaveRequest
}

function responseStatus(message: string): number {
  if (/请求过大|不能超过/u.test(message)) return 413
  if (/当前 revision/u.test(message)) return 409
  if (/无法读取故事工作区/u.test(message)) return 404
  return 400
}

/** Register story workspace list, read, create, save, and delete operations. */
export function installStoryWorkspaceHttp(ctx: Context, store: StoryWorkspaceStore, server: AgentRpHttpServer): void {
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: STORY_WORKSPACES_PATH,
    async handler(request, response) {
      if (!trustedBrowserRequest(request)) {
        json(response, 403, { error: 'forbidden' })
        return
      }
      const pathname = new URL(request.url ?? '/', 'http://agent-rp.local').pathname
      const suffix = pathname === STORY_WORKSPACES_PATH ? '' : pathname.slice(STORY_WORKSPACES_PATH.length + 1)
      const id = suffix === '' || suffix.includes('/') ? undefined : decodeURIComponent(suffix)
      try {
        if (request.method === 'GET' && suffix === '') {
          json(response, 200, { format: 1, workspaces: store.list() })
          return
        }
        if (request.method === 'POST' && suffix === '') {
          json(response, 201, { format: 1, workspace: store.create(parseCreateRequest(await readJson(request))) })
          return
        }
        if (request.method === 'GET' && id !== undefined) {
          json(response, 200, { format: 1, workspace: store.get(id) })
          return
        }
        if (request.method === 'PUT' && id !== undefined) {
          json(response, 200, { format: 1, workspace: store.save(parseSaveRequest(await readJson(request), id)) })
          return
        }
        if (request.method === 'DELETE' && id !== undefined) {
          json(response, 200, { format: 1, workspace: store.remove(id) })
          return
        }
        response.setHeader('allow', 'GET, POST, PUT, DELETE')
        json(response, request.method === 'GET' || request.method === 'POST'
          || request.method === 'PUT' || request.method === 'DELETE' ? 404 : 405, { error: 'not found' })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        json(response, responseStatus(message), { error: message })
      }
    },
  }), 'agent-rp: story workspace HTTP')
}
