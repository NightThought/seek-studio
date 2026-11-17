export const kinds = [
  'ocr',
  'documents',
  'podcast',
  'meeting',
  'monitor',
  'subscription',
  'workflow',
]
export const nodeKinds = ['search', 'fetch', 'chat', 'ocr', 'files', 'asr', 'tts']
export function text(value, name, max = 20000, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`${name}不能为空且最多 ${max} 个字符`)
  }
  return value.trim()
}
export function publicUrl(value) {
  const u = new URL(text(value, '网页地址', 8192))
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    !u.hostname.includes('.') ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      u.hostname
    ) ||
    u.hostname.endsWith('.local')
  ) {
    throw new Error('请输入公开的 HTTP/HTTPS 网页地址')
  }
  return u.href
}
export function validateInput(kind, input = {}) {
  if (!kinds.includes(kind) || !input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('无效的应用或输入')
  }
  // Explicit allowlist prevents request keys, prototype properties and unrelated data entering persistence.
  const out = {}
  if (input.fileIds !== undefined) {
    if (
      !Array.isArray(input.fileIds) ||
      input.fileIds.length > 20 ||
      input.fileIds.some((x) => typeof x !== 'string' || !/^[a-f0-9-]{36}$/.test(x))
    ) {
      throw new Error('最多选择 20 个有效文件')
    }
    out.fileIds = input.fileIds
  }
  if (['ocr', 'documents', 'meeting'].includes(kind) && !out.fileIds?.length) {
    throw new Error('请先上传文件')
  }
  if (kind === 'meeting' && out.fileIds.length !== 1) {
    throw new Error('每次选择一个录音文件')
  }
  if (kind === 'ocr') {
    out.purpose =
      input.purpose === 'text_recognition' ? 'text_recognition' : 'rich_layout_recognition'
  }
  if (kind === 'documents') {
    out.prompt = text(input.prompt, '分析问题', 8000)
  }
  if (kind === 'meeting') {
    out.prompt = typeof input.prompt === 'string' ? text(input.prompt, '会议要求', 8000, false) : ''
    if (input.referenceIds !== undefined) {
      if (
        !Array.isArray(input.referenceIds) ||
        input.referenceIds.length > 10 ||
        input.referenceIds.some((x) => typeof x !== 'string' || !/^[a-f0-9-]{36}$/.test(x))
      ) {
        throw new Error('参考文件无效')
      }
      out.referenceIds = input.referenceIds
    }
  }
  if (kind === 'podcast') {
    out.topic = text(input.topic, '主题', 2000)
    out.script = typeof input.script === 'string' ? text(input.script, '脚本', 24000, false) : ''
    out.action = input.action === 'audio' ? 'audio' : 'script'
    if (out.action === 'audio' && !out.script) {
      throw new Error('请先生成或输入脚本')
    }
  }
  if (kind === 'monitor') {
    out.goal = typeof input.goal === 'string' ? text(input.goal, '监测目标', 8000, false) : ''
    const detected = out.goal.match(/https?:\/\/[^\s<>，。；）)]+/i)?.[0]
    out.url = publicUrl(input.url || detected)
    out.ignore = typeof input.ignore === 'string' ? text(input.ignore, '忽略文本', 1000, false) : ''
  }
  if (kind === 'subscription') {
    out.topic = text(input.topic, '订阅主题', 100)
    out.preferences =
      typeof input.preferences === 'string' ? text(input.preferences, '偏好', 2000, false) : ''
    out.voice = input.voice === true
  }
  if (kind === 'workflow') {
    out.text = typeof input.text === 'string' ? text(input.text, '输入', 20000, false) : ''
    if (!Array.isArray(input.nodes) || !input.nodes.length || input.nodes.length > 12) {
      throw new Error('工作流需要 1～12 个节点')
    }
    out.nodes = input.nodes.map((n) => {
      if (!n || !nodeKinds.includes(n.type)) {
        throw new Error('未知节点类型')
      }
      return {
        type: n.type,
        prompt: typeof n.prompt === 'string' ? text(n.prompt, '节点参数', 8000, false) : '',
      }
    })
    if (out.nodes.some((n) => ['ocr', 'files', 'asr'].includes(n.type)) && !out.fileIds?.length) {
      throw new Error('文件节点需要上传输入文件')
    }
  }
  return out
}
export const normalizePage = (content, ignore = '') =>
  content
    .split('\n')
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        !ignore
          .split('\n')
          .filter(Boolean)
          .some((x) => s.includes(x))
    )
    .join('\n')
export const changedLines = (before, after) => {
  const a = new Set(before.split('\n')),
    b = new Set(after.split('\n'))
  return { added: [...b].filter((x) => !a.has(x)), removed: [...a].filter((x) => !b.has(x)) }
}
