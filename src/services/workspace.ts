import { create } from 'zustand'
import type { AppKind, Snapshot } from '../components/apps/api.js'
import type { TranslationKey } from '../i18n/index.js'
import { stopReadAloud } from './speech/readAloud.js'
export type WorkspaceFunction = 'chat' | 'search' | AppKind
export const functions: {
  value: WorkspaceFunction
  label: string
  labelKey: TranslationKey
}[] = [
  { value: 'chat', label: '对话', labelKey: 'func_chat' },
  { value: 'search', label: '联网搜索', labelKey: 'func_search' },
  { value: 'ocr', label: 'OCR 识别', labelKey: 'func_ocr' },
  { value: 'documents', label: '文档分析', labelKey: 'func_documents' },
  { value: 'podcast', label: '播客生成', labelKey: 'func_podcast' },
  { value: 'meeting', label: '会议助手', labelKey: 'func_meeting' },
  { value: 'monitor', label: '网页监测', labelKey: 'func_monitor' },
  { value: 'subscription', label: '信息订阅', labelKey: 'func_subscription' },
  { value: 'workflow', label: '工作流', labelKey: 'func_workflow' },
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
