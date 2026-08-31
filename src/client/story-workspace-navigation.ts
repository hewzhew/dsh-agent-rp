/** In-memory navigation from Session surfaces to one native play or authoring surface. */

/** Browser request to open one exact play space. */
export interface StoryWorkspaceOpenRequest {
  readonly workspaceId: string
  readonly surface: 'world' | 'studio'
}

/** Shared navigation source used by independent Agent RP surfaces. */
export interface StoryWorkspaceNavigation {
  request(request: StoryWorkspaceOpenRequest): void
  subscribe(listener: (request: StoryWorkspaceOpenRequest) => void): () => void
}

/** Create one apply-lifetime navigation source without global browser events. */
export function createStoryWorkspaceNavigation(): StoryWorkspaceNavigation {
  const listeners = new Set<(request: StoryWorkspaceOpenRequest) => void>()
  return {
    request: (request) => {
      for (const listener of listeners) listener(request)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
