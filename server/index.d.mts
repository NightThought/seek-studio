import type { IncomingMessage, ServerResponse } from 'node:http'
export function createStudioMiddleware(options?: {
  dir?: string
  key?: string
  schedule?: boolean
}): ((req: IncomingMessage, res: ServerResponse) => Promise<void>) & { close: () => Promise<void> }
