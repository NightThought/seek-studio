import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { StudioEngine } from '../server/engine.mjs'
import { DeepSeekProvider } from '../server/provider.mjs'
import { createStudioMiddleware } from '../server/index.mjs'
import { parseScript, wav } from '../server/media.mjs'
import { validateInput, publicUrl, normalizePage, changedLines } from '../server/validation.mjs'

function mockProvider() {
  const calls = []
  const provider = {
    calls,
    page: 'original content',
    news: [
      {
        url: 'https://example.org/news',
        title: 'News',
        content: 'Release notes',
        date: '2026-11-17',
      },
    ],
    async upload(file, purpose) {
      calls.push(['upload', file.name, purpose])
      return { id: 'remote-' + file.id }
    },
    async ocr(file, purpose) {
      calls.push(['ocr', file.name, purpose])
      return {
        pages: [
          {
            index: 0,
            text: '<｜ref｜>Title<｜/ref｜><｜box｜>[[10,20,100,80]]<｜/box｜>\n| A | B |',
            finish_reason: 'stop',
          },
        ],
      }
    },
    async chat(prompt, options) {
      calls.push(['chat', prompt, options])
      return {
        text: prompt.includes('严格每行')
          ? 'A: 大家好。\nB: 欢迎收听。'
          : 'Generated answer with evidence',
        sources: options?.search ? [{ url: 'https://example.org/news', title: 'News' }] : [],
      }
    },
    async fetchPage() {
      calls.push(['fetch'])
      return { title: 'Page', content: provider.page }
    },
    async search(query) {
      calls.push(['search', query])
      return provider.news
    },
    async asr() {
      calls.push(['asr'])
      return '会议决定下周完成原型，负责人待确认。'
    },
    async tts(text, voice) {
      calls.push(['tts', text, voice])
      return Buffer.alloc(4800)
    },
  }
  return provider
}
async function setup(t, provider = mockProvider(), options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'seek-test-'))
  const engine = await new StudioEngine({
    dir,
    key: 'secret-test-key',
    providerFactory: () => provider,
    ...options,
  }).init()
  t.after(async () => {
    if (engine.active) await engine.cancel(engine.active.run.id)
    await engine.writes
    await rm(dir, { recursive: true, force: true })
  })
  return { engine, provider, dir }
}
async function run(engine, request) {
  const value = await engine.start(request)
  await engine.finished
  return value
}

test('OCR batch, multi-file document analysis and evidence inputs', async (t) => {
  const { engine, provider } = await setup(t)
  const f1 = await engine.asset('one.pdf', Buffer.from('fixture'), 'application/pdf')
  const f2 = await engine.asset('two.md', Buffer.from('text'), 'text/markdown')
  const ocr = await run(engine, { kind: 'ocr', input: { fileIds: [f1.id, f2.id] } })
  assert.equal(ocr.status, 'done')
  assert.equal(ocr.result.documents.length, 2)
  const docs = await run(engine, {
    kind: 'documents',
    input: { fileIds: [f1.id, f2.id], prompt: '比较文档' },
  })
  assert.equal(docs.status, 'done')
  assert.deepEqual(
    provider.calls.filter((c) => c[0] === 'upload').map((c) => c[2]),
    ['rich_layout_recognition', 'user_data']
  )
  assert.equal(provider.calls.find((c) => c[0] === 'chat')[2].files.length, 2)
  assert.ok(docs.result.text)
  assert.ok(!JSON.stringify(engine.snapshot()).includes('secret-test-key'))
  assert.ok(!JSON.stringify(engine.snapshot().files).includes(engine.dir))
})
test('podcast generates editable script then two voices in a valid WAV', async (t) => {
  const { engine, provider } = await setup(t)
  const script = await run(engine, { kind: 'podcast', input: { topic: 'AI' } })
  assert.equal(script.status, 'done')
  assert.match(script.result.script, /A:/)
  const audio = await run(engine, {
    kind: 'podcast',
    input: { topic: 'AI', action: 'audio', script: script.result.script },
  })
  assert.equal(audio.status, 'done')
  const bytes = await readFile(engine.file(audio.result.audioId).path)
  assert.equal(bytes.toString('utf8', 0, 4), 'RIFF')
  assert.equal(bytes.readUInt32LE(40), bytes.length - 44)
  assert.deepEqual(
    provider.calls.filter((c) => c[0] === 'tts').map((c) => c[2]),
    ['stella', 'tide']
  )
  assert.throws(() => parseScript('无角色的文案'))
})
test('meeting uses real FFmpeg chunking and merges transcript with reference documents', async (t) => {
  const { engine, provider } = await setup(t)
  const audio = await engine.asset(
    'meeting.wav',
    wav(Buffer.alloc(16000 * 2 * 112), 16000),
    'audio/wav'
  )
  const doc = await engine.asset('agenda.md', Buffer.from('agenda'), 'text/plain')
  const result = await run(engine, {
    kind: 'meeting',
    input: { fileIds: [audio.id], referenceIds: [doc.id] },
  })
  assert.equal(result.status, 'done', result.error)
  assert.equal(provider.calls.filter((c) => c[0] === 'asr').length, 2)
  assert.match(result.result.transcript, /\[1:50\]/)
  assert.equal(provider.calls.filter((c) => c[0] === 'chat').at(-1)[2].files.length, 1)
})
test('monitor stores baseline, ignores noise and summarizes only changes', async (t) => {
  const { engine, provider } = await setup(t)
  const recipe = await engine.recipe({
    kind: 'monitor',
    name: 'Updates',
    input: { url: 'https://example.org/changes', ignore: 'Clock:' },
  })
  provider.page = 'Hello\nClock: 1'
  assert.equal((await run(engine, { recipeId: recipe.id })).result.changed, false)
  provider.page = ' Hello \nClock: 2'
  assert.equal((await run(engine, { recipeId: recipe.id })).result.changed, false)
  assert.equal(provider.calls.filter((c) => c[0] === 'chat').length, 0)
  provider.page = 'Hello\nNew feature'
  const result = await run(engine, { recipeId: recipe.id })
  assert.equal(result.result.changed, true)
  assert.deepEqual(result.result.diff.added, ['New feature'])
  await assert.rejects(
    engine.start({ recipeId: recipe.id, input: { url: 'https://other.example/path' } }),
    /保存配置/
  )
})
test('subscription deduplicates persisted content and can synthesize a voice briefing', async (t) => {
  const { engine, provider } = await setup(t)
  const recipe = await engine.recipe({
    kind: 'subscription',
    name: 'News',
    input: { topic: 'AI', voice: true },
  })
  const first = await run(engine, { recipeId: recipe.id })
  assert.equal(first.status, 'done')
  assert.ok(first.result.audioId)
  const next = await run(engine, { recipeId: recipe.id })
  assert.equal(next.result.changed, false)
  assert.equal(provider.calls.filter((c) => c[0] === 'tts').length, 1)
  provider.news[0].content = 'Updated release'
  assert.equal((await run(engine, { recipeId: recipe.id })).result.changed, true)
})
test('workflow passes outputs, logs steps, stops on failure and publishes revocable tokens', async (t) => {
  const { engine, provider } = await setup(t)
  const recipe = await engine.recipe({
    kind: 'workflow',
    name: 'Flow',
    input: {
      text: 'AI',
      nodes: [
        { type: 'search', prompt: '{{input}}' },
        { type: 'chat', prompt: 'Summary: {{previous}}' },
        { type: 'tts' },
      ],
    },
  })
  const completed = await run(engine, { recipeId: recipe.id })
  assert.equal(completed.status, 'done')
  assert.equal(completed.steps.length, 3)
  assert.ok(completed.result.audioId)
  assert.match(provider.calls.find((c) => c[0] === 'chat')[1], /Release notes/)
  const token = await engine.publish(recipe.id)
  assert.equal(token.length, 48)
  await engine.unpublish(recipe.id)
  assert.equal(recipe.token, null)
  provider.chat = async () => {
    throw new Error('upstream failed')
  }
  const failed = await run(engine, { recipeId: recipe.id })
  assert.equal(failed.status, 'error')
  assert.equal(failed.steps.length, 2)
  assert.equal(failed.steps[1].status, 'error')
})
test('all workflow file and webpage nodes execute against their declared inputs', async (t) => {
  const { engine } = await setup(t)
  const file = await engine.asset('document.pdf', Buffer.from('file'), 'application/pdf')
  const result = await run(engine, {
    kind: 'workflow',
    input: {
      text: 'https://example.org',
      fileIds: [file.id],
      nodes: [
        { type: 'fetch', prompt: '{{input}}' },
        { type: 'ocr' },
        { type: 'files', prompt: 'Summarize {{previous}}' },
      ],
    },
  })
  assert.equal(result.status, 'done', result.error)
  assert.equal(result.result.outputs.length, 3)
  const audio = await engine.asset('audio.wav', wav(Buffer.alloc(32000), 16000), 'audio/wav')
  const speech = await run(engine, {
    kind: 'workflow',
    input: { fileIds: [audio.id], nodes: [{ type: 'asr' }] },
  })
  assert.equal(speech.status, 'done', speech.error)
})
test('single execution, cancellation, restart recovery and schedule persistence', async (t) => {
  let now = 100000
  const provider = mockProvider()
  const { engine, dir } = await setup(t, provider, { now: () => now })
  provider.chat = async (_, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  const task = await engine.start({
    kind: 'workflow',
    input: { text: 'test', nodes: [{ type: 'chat' }] },
  })
  await assert.rejects(engine.start({ kind: 'podcast', input: { topic: 'test' } }), /已有任务/)
  await engine.cancel(task.id)
  assert.equal(task.status, 'cancelled')
  provider.chat = async () => ({ text: 'ok', sources: [] })
  const recipe = await engine.recipe({
    kind: 'subscription',
    name: 'Timer',
    enabled: true,
    intervalMinutes: 15,
    input: { topic: 'AI' },
  })
  const count = engine.state.runs.length
  await engine.tick()
  assert.equal(engine.state.runs.length, count)
  now += 60 * 60000
  await engine.tick()
  await engine.finished
  assert.equal(engine.state.runs.length, count + 1)
  assert.equal(recipe.nextRunAt, now + 15 * 60000)
  await engine.tick()
  assert.equal(engine.state.runs.length, count + 1)
  engine.state.runs.push({ id: 'interrupted', status: 'running' })
  await engine.save()
  const restored = await new StudioEngine({
    dir,
    key: 'secret-test-key',
    providerFactory: () => provider,
  }).init()
  assert.equal(restored.state.runs.at(-1).status, 'error')
  assert.ok(restored.state.recipes[0].seen.length)
  const disk = await readFile(path.join(dir, 'state.json'), 'utf8')
  assert.ok(!disk.includes('secret-test-key'))
})
test('invalid input, URL schemes, missing files and accidental credential persistence rejected', async (t) => {
  assert.throws(() => publicUrl('file:///etc/passwd'))
  assert.throws(() => publicUrl('https://user:password@example.com'))
  assert.throws(() => publicUrl('http://127.0.0.1/'))
  assert.throws(() => validateInput('workflow', { nodes: [{ type: 'shell' }] }))
  assert.throws(() => validateInput('ocr', {}))
  assert.equal(
    validateInput('podcast', { topic: 'hello', apiKey: 'do-not-save' }).apiKey,
    undefined
  )
  assert.equal(normalizePage(' A \nClock:1', 'Clock:'), 'A')
  assert.deepEqual(changedLines('old', 'new'), { added: ['new'], removed: ['old'] })
  const { engine } = await setup(t)
  await assert.rejects(
    engine.recipe({
      kind: 'monitor',
      name: 'x',
      enabled: true,
      intervalMinutes: 1,
      input: { url: 'https://example.org' },
    })
  )
})
test('provider wire format, citations, 200 errors, refusal and incomplete output', async () => {
  const requests = []
  let response = {
    content: [
      {
        type: 'text',
        text: 'Answer',
        citations: [{ url: 'https://example.org', title: 'Source' }],
      },
    ],
    stop_reason: 'end_turn',
  }
  const provider = new DeepSeekProvider('fixture-key', {
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
  const answer = await provider.chat('question', { files: ['file-1'] })
  const body = JSON.parse(requests[0].init.body)
  assert.equal(body.messages[0].content[0].type, 'document')
  assert.equal(requests[0].init.headers['anthropic-beta'], 'files-api-2025-04-14')
  assert.equal(answer.sources.length, 1)
  response = { error: { message: 'processing error' } }
  await assert.rejects(provider.search('test'))
  response = { stop_reason: 'refusal', content: [] }
  await assert.rejects(provider.chat('test'), /拒绝/)
  response = { stop_reason: 'max_tokens', content: [] }
  await assert.rejects(provider.chat('test'), /上限/)
})
test('local HTTP API: uploads, run results, origin guard, published auth and revocation', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'seek-http-'))
  const middleware = createStudioMiddleware({
    dir,
    key: 'private-secret',
    providerFactory: () => mockProvider(),
    schedule: false,
  })
  const server = createServer((req, res) => {
    req.url = req.url.replace(/^\/studio-api/, '')
    void middleware(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    await middleware.close()
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
    await rm(dir, { recursive: true, force: true })
  })
  const origin = `http://127.0.0.1:${server.address().port}`,
    base = origin + '/studio-api'
  const call = async (p, method = 'GET', data, headers = {}) =>
    fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: data ? JSON.stringify(data) : undefined,
    })
  assert.equal(
    (await call('/state', 'GET', null, { Origin: 'https://attacker.example' })).status,
    403
  )
  const form = new FormData()
  form.append('file', new Blob(['test']), 'example.txt')
  const upload = await (await fetch(base + '/uploads', { method: 'POST', body: form })).json()
  assert.ok(upload.id)
  assert.equal(upload.path, undefined)
  const recipe = await (
    await call('/recipes', 'POST', {
      kind: 'workflow',
      name: 'API',
      input: { text: 'hello', nodes: [{ type: 'chat' }] },
    })
  ).json()
  const published = await (await call(`/recipes/${recipe.id}/publish`, 'POST', {})).json()
  assert.equal((await call(`/published/${recipe.id}`, 'POST', { text: 'test' })).status, 401)
  const launch = await (
    await call(
      `/published/${recipe.id}`,
      'POST',
      { text: 'external input' },
      { Authorization: `Bearer ${published.token}` }
    )
  ).json()
  await middleware.engine.finished
  const result = await (
    await fetch(origin + launch.resultUrl, {
      headers: { Authorization: `Bearer ${published.token}` },
    })
  ).json()
  assert.equal(result.status, 'done')
  assert.equal(result.input.text, 'external input')
  await call(`/recipes/${recipe.id}/publish`, 'DELETE')
  assert.equal(
    (
      await call(
        `/published/${recipe.id}`,
        'POST',
        {},
        { Authorization: `Bearer ${published.token}` }
      )
    ).status,
    401
  )
  const state = await (await call('/state')).json()
  assert.ok(!JSON.stringify(state).includes('private-secret'))
})
