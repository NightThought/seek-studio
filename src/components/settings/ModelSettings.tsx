import { useEffect, useState } from 'react'
import {
  useSettings,
  setModel,
  setSafetyEnabled,
  setMetadataEnabled,
  setAutoRead,
} from '../../services/settings.js'
import { useAudit, type AuditEntry } from '../../services/audit.js'
import { prepareAutoRead, stopReadAloud } from '../../services/speech/readAloud.js'
import { download } from '../apps/api.js'
import styles from './Settings.module.css'
export const ModelSettings = () => {
  const settings = useSettings()
  const extended = settings.safetyEnabled || settings.metadataEnabled
  return (
    <div className={styles.modelSettings}>
      <label>
        模型
        <select
          value={settings.model}
          onChange={(e) =>
            setModel(e.target.value === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash')
          }
        >
          <option value="deepseek-flash">DeepSeek Flash · 支持联网、文件等扩展</option>
          <option value="deepseek-v4-pro" disabled={extended}>
            DeepSeek V4 Pro · 纯文本对话
          </option>
        </select>
      </label>
      <p>联网、文件和应用使用 Flash；关闭下方内容安全及元信息后，可选择 Pro 进行纯文本对话。</p>
      <label>
        <input
          type="checkbox"
          checked={settings.safetyEnabled}
          onChange={(e) => {
            if (e.target.checked) {
              setModel('deepseek-flash')
            }
            setSafetyEnabled(e.target.checked)
          }}
        />
        模型内容安全与审计
      </label>
      <p>开启后请求输入/输出安全校验，并记录审核状态。关闭后使用 API 默认检查；上游仍可能拒答。</p>
      <label>
        <input
          type="checkbox"
          checked={settings.metadataEnabled}
          onChange={(e) => {
            if (e.target.checked) {
              setModel('deepseek-flash')
            }
            setMetadataEnabled(e.target.checked)
          }}
        />
        用户元信息标记
      </label>
      <p>开启后发送日期、语言及已配置的所在地；关闭后不发送这些标记。</p>
      <label>
        <input
          type="checkbox"
          checked={settings.autoRead}
          onChange={(e) => {
            setAutoRead(e.target.checked)
            if (e.target.checked) {
              prepareAutoRead()
            } else {
              stopReadAloud()
            }
          }}
        />
        自动朗读回答
      </label>
      <p>
        新回答完成后自动播放，原文字仍保留。历史回复不会自动重播；可使用回复旁的朗读按钮停止或重播。
      </p>
    </div>
  )
}
const statuses: Record<AuditEntry['status'], string> = {
  completed: '完成，未返回拒答',
  refused: '拒答（上游未提供具体原因）',
  error: '调用失败，审核未确认',
  cancelled: '已取消，审核未确认',
}
export const AuditLog = () => {
  const local = useAudit((s) => s.entries)
  const [remote, setRemote] = useState<AuditEntry[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const response = await fetch('/studio-api/audit')
        if (!response.ok) {
          throw new Error()
        }
        const data = await response.json()
        if (alive) {
          setRemote(data.entries ?? [])
          setError('')
        }
      } catch {
        if (alive) {
          setError('本地服务不可用，正在显示浏览器中的审计记录')
        }
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  const entries = [...new Map([...remote, ...local].map((e) => [e.id, e])).values()].sort(
    (a, b) => b.time - a.time
  )
  return (
    <div className={styles.modelSettings}>
      <h3>安全审计日志</h3>
      <p>
        仅在内容安全开关开启时记录。日志不包含 API
        Key、提问正文或回复正文。“未返回拒答”不代表独立人工审核。
      </p>
      {error ? <p role="status">{error}</p> : null}
      <button
        type="button"
        onClick={() =>
          download(JSON.stringify(entries, null, 2), 'safety-audit.json', 'application/json')
        }
      >
        导出审计日志
      </button>
      {entries.length ? (
        <ol>
          {entries.map((e) => (
            <li key={e.id}>
              <strong>{statuses[e.status]}</strong>
              <div>
                {new Date(e.time).toLocaleString()} · {e.model} · {e.source}
              </div>
              {e.requestId ? <small>请求：{e.requestId}</small> : null}
              {e.safetyTokens !== undefined ? <div>审核 Token：{e.safetyTokens}</div> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p>暂无审计记录。开启模型内容安全后，新请求会显示在这里。</p>
      )}
    </div>
  )
}
