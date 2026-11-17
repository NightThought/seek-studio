import { ApiError, streamMessage } from '../api/client.js'
import type { CreateMessageRequest } from '../api/types.js'
import { applyEvent, settleReply } from '../chat/reply.js'
import type { AssistantMessage } from '../chat/types.js'
import { buildReplyView } from '../chat/view.js'

export const createSearchRequest = (query: string, reminder: string): CreateMessageRequest => ({
  model: 'deepseek-flash',
  system:
    'You are SeekStudio, an AI search assistant powered by DeepSeek. Search the web for the user question, prefer primary sources, and cite evidence. Distinguish facts from inference. If sources are unavailable or disagree, say so. Respond in the user’s language.',
  messages: [
    { role: 'latest_reminder', content: reminder },
    { role: 'user', content: query },
  ],
  thinking: { type: 'disabled' },
  tools: [
    { type: 'deepseek_web_search', name: 'deepseek_web_search' },
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ],
  safety_check: { level: 'high' },
})

/** One request, no automatic retries that could duplicate billed searches. */
export const runSearch = async (
  apiKey: string,
  query: string,
  reminder: string,
  signal: AbortSignal,
  onUpdate: (reply: AssistantMessage) => void
): Promise<AssistantMessage> => {
  let reply: AssistantMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    createdAt: Date.now(),
    model: 'deepseek-flash',
    search: true,
    thinking: false,
    prefix: false,
    status: 'pending',
    blocks: [],
  }
  onUpdate(reply)
  const indexes = new Map<number, number>()
  try {
    for await (const event of streamMessage(apiKey, createSearchRequest(query, reminder), signal)) {
      if (signal.aborted) {
        break
      }
      reply = applyEvent(reply, event, Date.now(), indexes)
      onUpdate(reply)
    }
    reply = settleReply(reply, signal.aborted ? 'stopped' : 'done', Date.now())
  } catch (error) {
    reply = signal.aborted
      ? settleReply(reply, 'stopped', Date.now())
      : settleReply(reply, 'error', Date.now(), {
          kind: error instanceof ApiError ? error.kind : 'network',
          message: error instanceof Error ? error.message : String(error),
          status: error instanceof ApiError ? error.status : undefined,
          localMessage: error instanceof ApiError ? error.localMessage : undefined,
        })
  }
  onUpdate(reply)
  return reply
}

/** Do not turn an untrusted source URL into a runnable Markdown link. */
export const sourceHref = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}

const escapeLabel = (text: string) =>
  text.replace(/[\\`*_{}[\]<>#]/g, '\\$&').replace(/[\r\n]+/g, ' ')

/** Export the same source numbering as the on-screen citations; never include credentials. */
export const exportSearchMarkdown = (
  query: string,
  reply: AssistantMessage,
  labels: { sources: string; incomplete: string }
): string => {
  if (reply.stopReason === 'refusal') {
    return ''
  }
  const view = buildReplyView(reply, false)
  if (!view.answer?.text.trim()) {
    return ''
  }
  const answer = view.answer.markdown.replace(/\[citation:(\d+)\]/g, (_, index: string) => {
    const url = sourceHref(view.sources.find((source) => source.index === Number(index))?.url ?? '')
    return url ? `[${index}](<${url}>)` : `[${index}]`
  })
  const sources = view.sources
    .map((source) => {
      const url = sourceHref(source.url)
      return `${source.index}. ${url ? `[${escapeLabel(source.title)}](<${url}>)` : escapeLabel(source.title)}`
    })
    .join('\n')
  const incomplete = reply.status !== 'done' || reply.stopReason === 'max_tokens'
  return `# ${escapeLabel(query)}\n\n${incomplete ? `> ${labels.incomplete}\n\n` : ''}${answer}\n${sources ? `\n## ${labels.sources}\n\n${sources}\n` : ''}`
}
