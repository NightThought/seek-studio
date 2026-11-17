import { create } from 'zustand'
export type AuditEntry = {
  id: string
  time: number
  model: string
  status: 'completed' | 'refused' | 'error' | 'cancelled'
  source: string
  runId?: string
  requestId?: string
  safetyTokens?: number
}
const key = 'seek-studio:audit'
const read = (): AuditEntry[] => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}
export const useAudit = create(() => ({ entries: read() }))
export const recordAudit = (entry: AuditEntry) => {
  if (typeof window === 'undefined') {
    return
  }
  const entries = [entry, ...useAudit.getState().entries].slice(0, 1000)
  useAudit.setState({ entries })
  try {
    localStorage.setItem(key, JSON.stringify(entries))
  } catch {
    /* Logging must not discard a completed answer. */
  }
  void fetch('/studio-api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).catch(() => {})
}
