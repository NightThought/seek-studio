const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { mkdir } = await import('node:fs/promises')
await mkdir('.cache', { recursive: true })
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    localStorage.setItem('chat-demo:api-key', 'mock-key')
    localStorage.setItem('chat-demo:locale', 'zh-CN')
  })
  await page.route('https://api.deepseek.com/**', (r) => r.abort())
  await page.route('**/api/**', (r) => r.abort())
  const state = {
    configured: true,
    activeId: null,
    storageError: null,
    files: [],
    recipes: [],
    runs: [],
  }
  let n = 0
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=',
    'base64'
  )
  await page.route('**/studio-api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      parts = url.pathname.split('/').filter(Boolean).slice(1),
      method = req.method()
    const send = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (parts[0] === 'state') return send(state)
    if (parts[0] === 'assets') return route.fulfill({ contentType: 'image/png', body: pixel })
    if (parts[0] === 'uploads') {
      const file = { id: 'file-' + ++n, name: 'fixture.png', mime: 'image/png', size: 100 }
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
      const { kind, input, recipeId } = req.postDataJSON()
      const run = {
        id: 'run-' + ++n,
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
            name: 'fixture.png',
            pages: [
              {
                index: 0,
                text: '<｜ref｜>标题<｜/ref｜><｜box｜>[[10,20,500,300]]<｜/box｜>',
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
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:8090/')
  await page.getByRole('button', { name: '应用工作台', exact: true }).click()
  const choose = async (name) => {
    await page
      .getByRole('navigation', { name: '应用选择' })
      .getByRole('button', { name, exact: true })
      .click()
    await page.getByRole('heading', { name, exact: true }).waitFor()
  }
  const result = async () => {
    await page
      .getByRole('region', { name: '任务结果' })
      .getByRole('heading', { name: '完成', exact: true })
      .waitFor()
  }
  await choose('OCR 工作台')
  await page
    .locator('input[aria-label="上传文件"]')
    .setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: pixel })
  await page.getByText('fixture.png', { exact: false }).first().waitFor()
  await page.getByRole('button', { name: '运行OCR 工作台', exact: true }).click()
  await result()
  await page.getByRole('button', { name: /区域 1 标题/ }).click()
  await page.getByRole('navigation', { name: '应用选择' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: '.cache/apps-ocr.png', fullPage: true })
  await choose('文档分析')
  await page
    .locator('input[aria-label="上传文件"]')
    .setInputFiles({
      name: 'fixture.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('fixture'),
    })
  await page.getByText('fixture.png', { exact: false }).first().waitFor()
  await page.getByRole('button', { name: '运行文档分析', exact: true }).click()
  await result()
  await choose('播客生成器')
  await page.getByLabel('播客主题', { exact: true }).fill('AI 新进展')
  await page.getByRole('button', { name: '生成脚本', exact: true }).click()
  await result()
  await page.getByRole('button', { name: '载入脚本编辑', exact: true }).click()
  await page.getByRole('button', { name: '合成播客', exact: true }).click()
  await result()
  assert.equal(await page.locator('audio').count(), 1)
  await choose('会议助手')
  await page
    .locator('input[aria-label="上传文件"]')
    .setInputFiles({ name: 'audio.wav', mimeType: 'audio/wav', buffer: Buffer.from('fixture') })
  await page.getByText('fixture.png', { exact: false }).first().waitFor()
  await page.getByRole('button', { name: '运行会议助手', exact: true }).click()
  await result()
  await page.getByText('完整转写文本', { exact: true }).click()
  await page.getByText('[0:00] 会议转写。', { exact: true }).waitFor()
  await choose('网页监测')
  await page.getByLabel('网页地址', { exact: true }).fill('https://example.org/changelog')
  await page.getByLabel('配置名称', { exact: true }).fill('更新监测')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText('配置已保存', { exact: true }).waitFor()
  await page.getByRole('button', { name: '运行网页监测', exact: true }).click()
  await result()
  await choose('信息订阅')
  await page.getByLabel('订阅主题', { exact: true }).fill('DeepSeek')
  await page.getByLabel('配置名称', { exact: true }).fill('AI 简报')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText('配置已保存', { exact: true }).waitFor()
  await page.getByRole('button', { name: '运行信息订阅', exact: true }).click()
  await result()
  await choose('工作流')
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
  await page.getByRole('navigation', { name: '应用选择' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: '.cache/apps-workflow.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('navigation', { name: '应用选择' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: '.cache/apps-mobile.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const panels = await page
    .locator('[aria-label="应用配置"]')
    .evaluate((e) => e.getBoundingClientRect().right <= innerWidth)
  assert.equal(panels, true)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: all seven apps, uploads, OCR highlight, podcast editing/audio, transcript, recipes, workflow editing/publishing, mobile layout'
  )
} finally {
  await browser.close()
}
