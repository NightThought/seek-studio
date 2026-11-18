import { create } from 'zustand'
import type { AppKind, Snapshot } from '../components/apps/api.js'
import { stopReadAloud } from './speech/readAloud.js'
export type WorkspaceFunction = 'chat' | 'search' | AppKind
export const functions: { value: WorkspaceFunction; label: string }[] = [
  { value: 'chat', label: '对话' },
  { value: 'search', label: '联网搜索' },
  { value: 'ocr', label: 'OCR 识别' },
  { value: 'documents', label: '文档分析' },
  { value: 'podcast', label: '播客生成' },
  { value: 'meeting', label: '会议助手' },
  { value: 'monitor', label: '网页监测' },
  { value: 'subscription', label: '信息订阅' },
  { value: 'workflow', label: '工作流' },
]
export const useWorkspace = create(() => ({
  function: 'chat' as WorkspaceFunction,
  runId: null as string | null,
  snapshot: null as Snapshot | null,
}))
export const selectFunction = (value: WorkspaceFunction, runId: string | null = null) => {
  stopReadAloud()
  useWorkspace.setState({ function: value, runId })
}
export const setAppSnapshot = (snapshot: Snapshot) => useWorkspace.setState({ snapshot })
