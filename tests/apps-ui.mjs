const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { mkdir } = await import('node:fs/promises')
await mkdir('.cache', { recursive: true })
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    localStorage.setItem('chat-demo:api-key', 'mock-key')
    localStorage.setItem('chat-demo:locale', 'zh-CN')
  })
  const requests = [],
    audits = []
  let ttsCount = 0
  const mockApi = async (route) => {
    const url = route.request().url()
    if (url.endsWith('/models')) return route.fulfill({ json: { data: [] } })
    if (url.endsWith('/tts')) {
      ttsCount++
      return route.fulfill({ contentType: 'audio/pcm', body: Buffer.alloc(4800) })
    }
    if (url.endsWith('/messages')) {
      const body = route.request().postDataJSON()
      requests.push(body)
      const events = [
        {
          type: 'message_start',
          message: {
            id: 'req-' + requests.length,
            role: 'assistant',
            model: body.model,
            content: [],
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '这是保留的文字回答。' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null, title: '链接分析' },
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 10,
            output_tokens_details: { safety_tokens: 3 },
          },
        },
        { type: 'message_stop' },
      ]
      return route.fulfill({
        contentType: 'text/event-stream',
        body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
      })
    }
    return route.abort()
  }
  await page.route('https://api.deepseek.com/**', mockApi)
  await page.route('**/api/**', mockApi)
  const state = {
    configured: true,
    activeId: null,
    storageError: null,
    files: [],
    recipes: [],
    runs: [],
  }
  let n = 0
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 700] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 700] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...['Page One', 'Page Two'].map((label) => {
      const stream = `BT /F1 30 Tf 40 600 Td (${label}) Tj ET`
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    }),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  await page.route('**/studio-api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      parts = url.pathname.split('/').filter(Boolean).slice(1),
      method = req.method()
    const send = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (parts[0] === 'state') return send(state)
    if (parts[0] === 'audit') {
      if (method === 'POST') audits.push(req.postDataJSON())
      return send({ entries: audits })
    }
    if (parts[0] === 'assets')
      return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(pdf) })
    if (parts[0] === 'uploads') {
      const file = { id: 'file-' + ++n, name: 'fixture.pdf', mime: 'application/pdf', size: 100 }
      state.files.push(file)
      return send(file, 201)
    }
    if (parts[0] === 'recipes') {
      if (parts[2] === 'publish') {
        const r = state.recipes.find((r) => r.id === parts[1])
        r.token = method === 'DELETE' ? null : 'mock-publish-token'
        return send({ token: r.token })
      }
      if (method === 'DELETE') {
        state.recipes = state.recipes.filter((r) => r.id !== parts[1])
        return send({ ok: true })
      }
      const data = req.postDataJSON(),
        r = {
          ...data,
          id: data.id || 'recipe-' + ++n,
          nextRunAt: Date.now() + 86400000,
          token: null,
        }
      state.recipes = state.recipes.filter((x) => x.id !== r.id)
      state.recipes.push(r)
      return send(r)
    }
    if (parts[0] === 'runs' && method === 'GET')
      return send(state.runs.find((r) => r.id === parts[1]))
    if (parts[0] === 'runs' && method === 'POST') {
      const { kind, input, recipeId, conversationId, message, executionOptions } =
        req.postDataJSON()
      const run = {
        id: 'run-' + ++n,
        conversationId: conversationId || randomUUID(),
        message,
        executionOptions,
        kind,
        input,
        recipeId: recipeId ?? null,
        status: 'done',
        createdAt: Date.now(),
        progress: '完成',
        steps: [],
        result: { text: `## ${kind} 测试结果\n\n内容已生成。` },
      }
      if (kind === 'ocr')
        run.result.documents = [
          {
            fileId: input.fileIds[0],
            name: 'fixture.pdf',
            pages: [
              {
                index: 0,
                text: '<｜ref｜>title<｜/ref｜><｜box｜>[[10,20,500,300]]<｜/box｜>\n文档标题',
                finish_reason: 'stop',
              },
              {
                index: 1,
                text: '<｜ref｜>table<｜/ref｜><｜box｜>[[100,200,900,600]]<｜/box｜>\n| 项目 | 数量 |\n|---|---|\n| 测试 | 2 |',
                finish_reason: 'stop',
              },
            ],
          },
        ]
      if (kind === 'podcast') {
        run.result.script = input.script || 'A: 大家好。\nB: 欢迎收听。'
        if (input.action === 'audio') run.result.audioId = 'audio-1'
      }
      if (kind === 'meeting') run.result.transcript = '[0:00] 会议转写。'
      if (kind === 'monitor') run.result.source = input.url
      if (kind === 'workflow')
        run.steps = input.nodes.map((node, i) => ({
          index: i,
          type: node.type,
          status: 'done',
          preview: '节点结果',
        }))
      state.runs.unshift(run)
      return send(run, 202)
    }
    return send({ error: 'not found' }, 404)
  })
  await page.goto('http://127.0.0.1:8090/')
  const choose = async (value) => {
    await page.getByLabel('选择功能', { exact: true }).selectOption(value)
  }
  const result = () => page.getByRole('region', { name: '任务结果' }).last().waitFor()
  const upload = async () => {
    await page
      .locator('input[aria-label="上传文件"]')
      .setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) })
    await page.getByText('fixture.pdf', { exact: false }).first().waitFor()
  }
  await choose('ocr')
  await upload()
  await page.getByRole('button', { name: '运行OCR 工作台', exact: true }).click()
  await page.getByRole('heading', { name: '文档标题', exact: true }).waitFor()
  await page.locator('canvas[data-ready="true"][aria-label="PDF 原文第 1 页"]').waitFor()
  await page.getByRole('button', { name: '定位第 2 页区域 1', exact: true }).click()
  await page.locator('canvas[data-ready="true"][aria-label="PDF 原文第 2 页"]').waitFor()
  assert.equal(await page.getByTestId('ocr-highlight').count(), 1)
  assert.equal(await page.getByRole('cell', { name: '测试', exact: true }).count(), 1)
  assert.ok(!(await page.getByLabel('Markdown 识别结果').innerText()).includes('<｜'))
  await page.screenshot({ path: '.cache/unified-ocr.png', fullPage: true })
  const ocrConversation = state.runs[0].conversationId
  await choose('documents')
  await upload()
  await page.getByLabel('应用消息', { exact: true }).fill('比较这些资料的结论')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await result()
  const docConversation = state.runs[0].conversationId
  await page.getByLabel('应用消息', { exact: true }).fill('请进一步解释第一点')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByText('请进一步解释第一点', { exact: true }).first().waitFor()
  assert.equal(state.runs[0].conversationId, docConversation)
  await page.waitForFunction(
    () => document.querySelectorAll('[aria-label="任务结果"]').length === 2
  )
  await choose('podcast')
  await page.getByLabel('播客主题', { exact: true }).fill('AI 新进展')
  await page.getByRole('button', { name: '生成脚本', exact: true }).click()
  await result()
  await page.getByRole('button', { name: '载入脚本编辑', exact: true }).click()
  await page.getByRole('button', { name: '合成播客', exact: true }).click()
  await page.locator('audio').waitFor()
  await choose('meeting')
  await upload()
  await page.getByRole('button', { name: '运行会议助手', exact: true }).click()
  await result()
  await page.getByText('完整转写文本', { exact: true }).click()
  await page.getByText('[0:00] 会议转写。', { exact: true }).waitFor()
  await choose('monitor')
  await page
    .getByLabel('应用消息', { exact: true })
    .fill('检查 https://example.org/changelog，是否增加了离线功能？')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await result()
  assert.equal(state.runs[0].input.url, 'https://example.org/changelog')
  assert.match(state.runs[0].input.goal, /离线功能/)
  assert.equal(state.runs[0].recipeId, null)
  await page.getByLabel('配置名称', { exact: true }).fill('更新监测')
  await page.getByLabel('启用定时执行', { exact: true }).check()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText('配置已保存', { exact: true }).waitFor()
  assert.equal(
    await page
      .getByRole('complementary', { name: '功能配置' })
      .getByText('保存配置与定时运行', { exact: true })
      .count(),
    1
  )
  await choose('subscription')
  await page.getByLabel('应用消息', { exact: true }).fill('DeepSeek')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await result()
  await choose('workflow')
  await page.getByLabel('工作流输入', { exact: true }).fill('DeepSeek API')
  await page.getByRole('button', { name: '添加节点', exact: true }).click()
  assert.equal(await page.getByLabel(/节点 \d 类型/).count(), 3)
  await page.getByLabel('配置名称', { exact: true }).fill('研究流水线')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText('配置已保存', { exact: true }).waitFor()
  await page.getByRole('button', { name: '发布 / 更换 API 令牌', exact: true }).click()
  await page.getByText(/Authorization: Bearer mock-publish-token/).waitFor()
  await page.getByRole('button', { name: '运行工作流', exact: true }).click()
  await result()
  await page.getByRole('button', { name: /运行OCR 工作台.*OCR 识别/ }).click()
  await page.getByRole('heading', { name: '文档标题', exact: true }).waitFor()
  assert.ok(state.runs.some((r) => r.conversationId === ocrConversation))
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('用户元信息标记', { exact: true }).check()
  await page.getByLabel('自动朗读回答', { exact: true }).check()
  await page.keyboard.press('Escape')
  await choose('search')
  const composer = page.locator('main textarea:visible')
  await composer.fill('阅读 https://example.org 并总结')
  await composer.press('Enter')
  await page.getByText('这是保留的文字回答。', { exact: true }).waitFor()
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('seek-studio:audit') || '[]').length > 0
  )
  assert.ok(requests[0].tools.some((t) => t.name === 'deepseek_read_url'))
  assert.ok(requests[0].tools.some((t) => t.name === 'deepseek_web_search'))
  assert.ok(requests[0].messages.some((m) => m.role === 'latest_reminder'))
  assert.equal(requests[0].safety_check.level, 'high')
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(ttsCount, 1)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('模型内容安全与审计', { exact: true }).uncheck()
  await page.getByLabel('用户元信息标记', { exact: true }).uncheck()
  await page.getByLabel('自动朗读回答', { exact: true }).uncheck()
  await page.getByRole('tab', { name: '安全审计', exact: true }).click()
  await page.getByText('完成，未返回拒答', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('main textarea:visible').fill('继续解释刚才的链接')
  await page.locator('main textarea:visible').press('Enter')
  await page.getByRole('button', { name: '发送', exact: true }).waitFor()
  await new Promise((r) => setTimeout(r, 500))
  assert.equal(requests.length, 2)
  assert.equal(requests[1].safety_check.level, 'low')
  assert.equal(
    requests[1].messages.some((m) => m.role === 'latest_reminder'),
    false
  )
  assert.ok(requests[1].messages.length >= 3)
  assert.equal(ttsCount, 1)
  assert.equal(audits.length, 1)
  await page.screenshot({ path: '.cache/unified-chat.png', fullPage: true })
  await page.reload()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  assert.equal(await page.getByLabel('模型内容安全与审计', { exact: true }).isChecked(), false)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .getByRole('complementary', { name: '功能配置' })
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await page.getByRole('button', { name: '历史与功能', exact: true }).click()
  await choose('ocr')
  await page.getByRole('button', { name: '功能配置', exact: true }).click()
  await page.locator('input[aria-label="上传文件"]').waitFor()
  await page.screenshot({ path: '.cache/unified-mobile.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: unified seven apps, conversation history, natural URL goals, right schedules, PDF page/region mapping, Markdown tables, settings persistence, safety audit, metadata removal, automatic speech, mobile layout'
  )
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0]
  if (page) {
    await page.screenshot({ path: '.cache/ui-failure.png', fullPage: true })
    console.error((await page.locator('body').innerText()).slice(-6000))
  }
  throw error
} finally {
  await browser.close()
}
