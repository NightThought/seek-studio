import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { StudioEngine } from './engine.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const json = (res, status, data) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}
const body = async (req, max = 1024 * 1024) => {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > max) {
      throw new Error('请求体过大')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
const safeToken = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b))
export function createStudioMiddleware({
  dir = path.join(root, '../.seek-studio'),
  key = process.env.DEEPSEEK_API_KEY?.trim(),
  providerFactory,
  schedule = true,
} = {}) {
  const engine = new StudioEngine({ dir, key, providerFactory })
  const ready = engine.init()
  // Save init failure for requests; do not produce unhandled rejections at startup.
  ready.catch(() => {})
  let timer
  if (schedule) {
    timer = setInterval(() => void ready.then(() => engine.tick()).catch(() => {}), 15000)
    timer.unref()
  }
  const handler = async (req, res) => {
    try {
      const host = req.headers.host ?? ''
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
        return json(res, 403, { error: '仅允许本机访问' })
      }
      if (req.headers.origin && req.headers.origin !== `http://${host}`) {
        return json(res, 403, { error: '不允许跨站请求' })
      }
      await ready
      const url = new URL(req.url, 'http://localhost'),
        parts = url.pathname.split('/').filter(Boolean)
      const method = req.method
      if (method === 'GET' && url.pathname === '/state') {
        return json(res, 200, engine.snapshot())
      }
      if (method === 'POST' && url.pathname === '/uploads') {
        const raw = await body(req, 101 * 1024 * 1024)
        const form = await new Response(raw, {
          headers: { 'Content-Type': req.headers['content-type'] ?? '' },
        }).formData()
        const file = form.get('file')
        if (!file || typeof file === 'string' || !file.size || file.size > 100 * 1024 * 1024) {
          throw new Error('请选择不超过 100 MiB 的非空文件')
        }
        const saved = await engine.asset(
          path.basename(file.name).slice(0, 200),
          Buffer.from(await file.arrayBuffer()),
          file.type || 'application/octet-stream'
        )
        const publicFile = { id: saved.id, name: saved.name, mime: saved.mime, size: saved.size }
        return json(res, 201, publicFile)
      }
      if (method === 'GET' && parts[0] === 'assets' && parts.length === 2) {
        const file = engine.file(parts[1])
        const data = await readFile(file.path)
        res.setHeader('Content-Type', file.mime)
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
        const inline = /^(audio\/(wav|mpeg|ogg)|image\/(png|jpeg|webp)|application\/pdf)$/.test(
          file.mime
        )
        res.setHeader(
          'Content-Disposition',
          `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`
        )
        res.end(data)
        return
      }
      if (method === 'GET' && parts[0] === 'runs' && parts.length === 2) {
        const run = engine.state.runs.find((r) => r.id === parts[1])
        return json(res, run ? 200 : 404, run ?? { error: '任务不存在' })
      }
      if (method === 'POST' && url.pathname === '/runs') {
        return json(
          res,
          202,
          await engine.start(JSON.parse(await body(req)), engine.key || req.headers['x-studio-key'])
        )
      }
      if (method === 'POST' && parts[0] === 'runs' && parts[2] === 'cancel') {
        await engine.cancel(parts[1])
        return json(res, 200, { ok: true })
      }
      if (method === 'POST' && url.pathname === '/recipes') {
        return json(res, 200, await engine.recipe(JSON.parse(await body(req))))
      }
      if (method === 'DELETE' && parts[0] === 'recipes' && parts.length === 2) {
        await engine.removeRecipe(parts[1])
        return json(res, 200, { ok: true })
      }
      if (method === 'POST' && parts[0] === 'recipes' && parts[2] === 'publish') {
        return json(res, 200, { token: await engine.publish(parts[1]) })
      }
      if (method === 'DELETE' && parts[0] === 'recipes' && parts[2] === 'publish') {
        await engine.unpublish(parts[1])
        return json(res, 200, { ok: true })
      }
      if (method === 'POST' && parts[0] === 'published' && parts.length === 2) {
        const recipe = engine.state.recipes.find((r) => r.id === parts[1] && r.kind === 'workflow')
        if (!recipe?.token || !safeToken(req.headers.authorization, `Bearer ${recipe.token}`)) {
          return json(res, 401, { error: '发布令牌无效' })
        }
        const input = JSON.parse(await body(req))
        const run = await engine.start({
          recipeId: recipe.id,
          input: {
            ...recipe.input,
            text: typeof input.text === 'string' ? input.text : recipe.input.text,
          },
        })
        return json(res, 202, {
          id: run.id,
          status: run.status,
          resultUrl: `/studio-api/published/${recipe.id}/runs/${run.id}`,
        })
      }
      if (
        method === 'GET' &&
        parts[0] === 'published' &&
        parts[2] === 'runs' &&
        parts.length === 4
      ) {
        const recipe = engine.state.recipes.find((r) => r.id === parts[1])
        if (!recipe?.token || !safeToken(req.headers.authorization, `Bearer ${recipe.token}`)) {
          return json(res, 401, { error: '发布令牌无效' })
        }
        const run = engine.state.runs.find((r) => r.id === parts[3] && r.recipeId === recipe.id)
        return json(res, run ? 200 : 404, run ?? { error: '任务不存在' })
      }
      return json(res, 404, { error: '接口不存在' })
    } catch (e) {
      if (!res.headersSent) {
        json(res, 400, {
          error: String(e.message ?? e)
            .split(key || '\0')
            .join('[redacted]'),
        })
      } else {
        res.end()
      }
    }
  }
  handler.close = async () => {
    clearInterval(timer)
    await ready.catch(() => {})
    if (engine.active) {
      await engine.cancel(engine.active.run.id)
    }
    await engine.writes.catch(() => {})
  }
  handler.engine = engine
  return handler
}
