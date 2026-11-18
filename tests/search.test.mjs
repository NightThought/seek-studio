import { test, after } from 'node:test'
import assert from 'node:assert/strict'

globalThis.__API_ORIGIN__ = 'https://example.test'
const { runSearch, exportSearchMarkdown, sourceHref } =
  await import('../.cache/tests/services/search/task.js')
const originalFetch = globalThis.fetch
after(() => {
  globalThis.fetch = originalFetch
})
const labels = { sources: 'Sources', incomplete: 'Incomplete result' }
const block = (index, content_block) => ({ type: 'content_block_start', index, content_block })
const citation = {
  type: 'web_search_result_location',
  url: 'https://example.org/docs',
  title: 'Official [docs]',
}
export const successEvents = [
  block(0, {
    type: 'server_tool_use',
    id: 's1',
    name: 'deepseek_web_search',
    kind: 'search',
    input: { action: 'search', queries: ['test'] },
  }),
  block(1, {
    type: 'web_search_tool_result',
    tool_use_id: 's1',
    kind: 'search',
    content: [
      {
        type: 'web_search_result',
        url: citation.url,
        title: citation.title,
        snippet: 'Official documentation',
        site_name: 'Example',
        site_icon: null,
        page_age: null,
      },
    ],
  }),
  block(2, { type: 'text', text: 'Evidence-based answer.', citations: [citation] }),
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } },
  { type: 'message_stop' },
]
const encode = (events) =>
  events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
const respond = (events) =>
  new Response(encode(events), { headers: { 'Content-Type': 'text/event-stream' } })
const search = (signal = new AbortController().signal, update = () => {}) =>
  runSearch('test-key', 'Question', '2026-11-17', signal, update)

test('streamed search requests tools, exposes progress and exports matching citations once', async () => {
  let calls = 0
  globalThis.fetch = async (url, init) => {
    calls++
    assert.equal(url, 'https://example.test/anthropic/v1/messages')
    const body = JSON.parse(init.body)
    assert.equal(body.stream, true)
    assert.equal(body.tools[0].name, 'deepseek_web_search')
    assert.equal(body.messages.at(-1).content, 'Question')
    return respond(successEvents)
  }
  const states = []
  const reply = await search(undefined, (r) => states.push(r.status))
  assert.equal(reply.status, 'done')
  assert.ok(states.includes('pending') && states.includes('streaming'))
  const md = exportSearchMarkdown('Question', reply, labels)
  assert.match(md, /Evidence-based answer\.\[1\]\(<https:\/\/example.org\/docs>\)/)
  assert.equal((md.match(/1\. \[/g) || []).length, 1)
  assert.ok(!md.includes('test-key') && !md.includes('[citation:'))
  assert.equal(calls, 1)
})

test('HTTP auth and rate-limit failures remain retryable by the caller, with no automatic request', async () => {
  for (const status of [401, 429, 503]) {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return new Response('{"error":{"message":"failure"}}', { status })
    }
    const reply = await search()
    assert.equal(reply.status, 'error')
    assert.equal(reply.error.status, status)
    assert.equal(calls, 1)
  }
  globalThis.fetch = async () => respond(successEvents)
  assert.equal((await search()).status, 'done')
})

test('an interrupted stream preserves partial text and marks its export incomplete', async () => {
  globalThis.fetch = async () => respond(successEvents.slice(0, 3))
  const reply = await search()
  assert.equal(reply.status, 'error')
  assert.equal(reply.error.kind, 'interrupted')
  assert.match(exportSearchMarkdown('Question', reply, labels), /Incomplete result/)
})

test('abort retains partial content without treating cancellation as a network failure', async () => {
  const controller = new AbortController()
  globalThis.fetch = async () => respond(successEvents)
  const reply = await search(controller.signal, (r) => {
    if (r.blocks.length === 3) controller.abort()
  })
  assert.equal(reply.status, 'stopped')
  assert.equal(reply.error, undefined)
  assert.match(exportSearchMarkdown('Question', reply, labels), /Incomplete result/)
})

test('refusal retains streamed text for labeled display but excludes continuation and context', async () => {
  globalThis.fetch = async () =>
    respond([
      ...successEvents.slice(0, 3),
      { type: 'message_delta', delta: { stop_reason: 'refusal', stop_sequence: null } },
      { type: 'message_stop' },
    ])
  const reply = await search()
  const { getReplyText, canContinueReply, getContextRounds } =
    await import('../.cache/tests/services/chat/reply.js')
  assert.match(getReplyText(reply), /Evidence-based answer/)
  assert.equal(reply.stopReason, 'refusal')
  assert.equal(canContinueReply(reply), false)
  assert.deepEqual(getContextRounds([{ role: 'user', content: 'Question', files: [] }, reply]), [])
  assert.equal(exportSearchMarkdown('Question', reply, labels), '')
})

test('refusal displays text before tool calls and distinguishes sources from answer text', async () => {
  const { buildReplyView } = await import('../.cache/tests/services/chat/view.js')
  const { describeReply } = await import('../.cache/tests/services/chat/describe.js')
  const { translate } = await import('../.cache/tests/i18n/index.js')
  const end = [
    { type: 'message_delta', delta: { stop_reason: 'refusal', stop_sequence: null } },
    { type: 'message_stop' },
  ]
  globalThis.fetch = async () =>
    respond([
      block(7, { type: 'text', text: 'Received before search.', citations: [citation] }),
      ...successEvents.slice(0, 2),
      ...end,
    ])
  let reply = await search()
  const view = buildReplyView(reply, false)
  assert.equal(view.answer.text, 'Received before search.')
  assert.match(view.answer.markdown, /\[citation:1\]/)
  assert.equal(view.searchResults.length, 1)
  assert.equal(describeReply(reply).text, translate('replyRefusedPartial'))

  globalThis.fetch = async () => respond([...successEvents.slice(0, 2), ...end])
  reply = await search()
  assert.equal(buildReplyView(reply, false).answer, null)
  assert.equal(buildReplyView(reply, false).searchResults.length, 1)
  assert.equal(describeReply(reply).text, translate('replyRefusedSources'))

  globalThis.fetch = async () => respond(end)
  reply = await search()
  assert.equal(buildReplyView(reply, false).answer, null)
  assert.equal(describeReply(reply).text, translate('replyRefusedEmpty'))
})

test('max-token output is identified as incomplete; empty responses cannot export', async () => {
  globalThis.fetch = async () =>
    respond([
      ...successEvents.slice(0, 3),
      { type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: null } },
      { type: 'message_stop' },
    ])
  assert.match(exportSearchMarkdown('Question', await search(), labels), /Incomplete result/)
  globalThis.fetch = async () => respond([{ type: 'message_stop' }])
  assert.equal(exportSearchMarkdown('Question', await search(), labels), '')
})

test('network and protocol errors settle the task instead of leaving it busy', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Offline')
  }
  assert.equal((await search()).error.kind, 'network')
  globalThis.fetch = async () => new Response('<html>Error</html>')
  assert.equal((await search()).error.kind, 'protocol')
})

test('source URLs cannot introduce active content or break Markdown destinations', () => {
  assert.equal(sourceHref('javascript:alert(1)'), null)
  assert.equal(sourceHref('data:text/html,test'), null)
  assert.equal(sourceHref('not a URL'), null)
  assert.equal(sourceHref('https://example.org/a>b'), 'https://example.org/a%3Eb')
})
