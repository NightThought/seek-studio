import { useSettings } from '../../services/settings.js'
export type AppKind =
  | 'ocr'
  | 'documents'
  | 'podcast'
  | 'meeting'
  | 'monitor'
  | 'subscription'
  | 'workflow'
export type NodeKind = 'search' | 'fetch' | 'chat' | 'ocr' | 'files' | 'asr' | 'tts'
export type FlowNode = { type: NodeKind; prompt: string }
export type AppInput = {
  fileIds?: string[]
  referenceIds?: string[]
  purpose?: string
  prompt?: string
  topic?: string
  script?: string
  action?: string
  goal?: string
  url?: string
  ignore?: string
  preferences?: string
  voice?: boolean
  text?: string
  nodes?: FlowNode[]
}
export type Asset = { id: string; name: string; mime: string; size: number }
export type Result = {
  text: string
  script?: string
  audioId?: string
  transcript?: string
  incomplete?: boolean
  source?: string
  changed?: boolean
  diff?: { added: string[]; removed: string[] }
  documents?: {
    fileId: string
    name: string
    pages: { index: number; text: string; finish_reason: string }[]
  }[]
  outputs?: Result[]
}
export type Run = {
  id: string
  kind: AppKind
  input: AppInput
  conversationId?: string
  message?: string
  recipeId: string | null
  status: 'running' | 'done' | 'error' | 'cancelled'
  createdAt: number
  finishedAt?: number
  progress: string
  error?: string
  partialText?: string
  result?: Result
  steps: { index: number; type: string; status: string; preview?: string }[]
}
export const runStatusLabel: Record<Run['status'], string> = {
  running: '运行中',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
}
export type Recipe = {
  id: string
  kind: AppKind
  name: string
  input: AppInput
  enabled: boolean
  intervalMinutes: number
  nextRunAt: number | null
  token: string | null
  hasBaseline: boolean
}
export type Snapshot = {
  configured: boolean
  storageError: string | null
  activeId: string | null
  files: Asset[]
  recipes: Recipe[]
  runs: Run[]
}
export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const key = useSettings.getState().apiKey
  if (key) {
    headers['x-studio-key'] = key
  }
  if (data && !(data instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(`/studio-api${path}`, {
    method,
    headers,
    body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data),
  })
  const type = response.headers.get('Content-Type') ?? ''
  if (!type.includes('application/json')) {
    throw new Error('应用后端不可用，请用 pnpm dev 启动本地服务')
  }
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(result.error ?? '请求失败')
  }
  return result
}
export const assetUrl = (id: string) => `/studio-api/assets/${encodeURIComponent(id)}`
export const download = (text: string, name: string, type = 'text/markdown;charset=utf-8') => {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
