import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspace, setAppSnapshot } from '../../services/workspace.js'
import { locationName } from '../../services/chat/latestReminder.js'
import { useSettings } from '../../services/settings.js'
import {
  prepareAutoRead,
  autoReadReply,
  toggleReadAloud,
  useReadAloud,
  describeReadAloudError,
} from '../../services/speech/readAloud.js'
import { ocrMarkdown } from './ocr.js'
import { OcrResult } from './OcrResult.js'
import { Button } from '../base/Button.js'
import { Markdown } from '../markdown/Markdown.js'
import { copyText } from '../../utils/clipboard.js'
import { showToast } from '../base/toastState.js'
import {
  api,
  assetUrl,
  download,
  type AppKind,
  type AppInput,
  type Asset,
  type Run,
  type Snapshot,
  type FlowNode,
  type NodeKind,
  type Recipe,
} from './api.js'
import styles from './AppsStudio.module.css'

const catalog: { kind: AppKind; name: string; description: string }[] = [
  {
    kind: 'ocr',
    name: 'OCR 工作台',
    description: '批量识别文档，查看逐页文字、区域坐标并导出。',
  },
  {
    kind: 'documents',
    name: '文档分析',
    description: '上传文档，阅读图表、提问或比较多份资料。',
  },
  {
    kind: 'podcast',
    name: '播客生成器',
    description: '搜索主题 → 编辑双人脚本 → 合成可下载的播客。',
  },
  {
    kind: 'meeting',
    name: '会议助手',
    description: '长录音自动分段转写，整理纪要、决策与待办。',
  },
  {
    kind: 'monitor',
    name: '网页监测',
    description: '保存网页快照，定期对比正文变化并生成摘要。',
  },
  {
    kind: 'subscription',
    name: '信息订阅',
    description: '按主题收集资讯、去重并生成可收听的简报。',
  },
  {
    kind: 'workflow',
    name: '工作流',
    description: '组合 API 节点，顺序运行、定时执行或发布本地 API。',
  },
]
const nodeLabels: Record<NodeKind, string> = {
  search: '网页搜索',
  fetch: '网页抓取',
  chat: '模型生成',
  ocr: 'OCR 识别',
  files: '文件分析',
  asr: '语音转写',
  tts: '语音合成',
}
const statusLabel: Record<Run['status'], string> = {
  running: '运行中',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
}
const seed: Record<AppKind, AppInput> = {
  ocr: { fileIds: [], purpose: 'rich_layout_recognition' },
  documents: { fileIds: [], prompt: '总结主要内容，列出依据和需要进一步核实的问题。' },
  podcast: { topic: '', script: '', action: 'script' },
  meeting: { fileIds: [], referenceIds: [], prompt: '' },
  monitor: { url: '', ignore: '' },
  subscription: { topic: '', preferences: '重点关注技术进展与原始来源', voice: false },
  workflow: {
    text: '',
    fileIds: [],
    nodes: [
      { type: 'search', prompt: '{{input}}' },
      { type: 'chat', prompt: '总结以下搜索资料，注明来源：\n{{previous}}' },
    ],
  },
}

export const AppsStudio = () => {
  const mode = useWorkspace((s) => s.function),
    selected = useWorkspace((s) => s.runId)
  const kind: AppKind = mode === 'chat' || mode === 'search' ? 'ocr' : mode
  const settings = useSettings()
  const executionOptions = {
    model: settings.model,
    safetyEnabled: settings.safetyEnabled,
    metadataEnabled: settings.metadataEnabled,
    locale: settings.locale,
    location: locationName(settings.location, settings.locale),
  }
  const [run, setRun] = useState<Run | null>(null)
  const pendingRead = useRef(new Set<string>())
  const [forms, setForms] = useState(seed)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [recipeId, setRecipeId] = useState<string | undefined>()
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [minutes, setMinutes] = useState(1440)
  const input = forms[kind],
    entry = catalog.find((x) => x.kind === kind) ?? catalog[0]
  const generation = useRef(0)
  const setInput = (change: Partial<AppInput>) =>
    setForms((f) => ({ ...f, [kind]: { ...f[kind], ...change } }))
  const refresh = useCallback(async () => {
    const data = await api<Snapshot>('/state')
    setSnapshot(data)
    setAppSnapshot(data)
    return data
  }, [])
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const data = await api<Snapshot>('/state')
        if (alive) {
          setSnapshot(data)
          setAppSnapshot(data)
        }
      } catch (e) {
        if (alive) {
          setError((e as Error).message)
        }
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    generation.current++
    setRecipeId(undefined)
    setName('')
    setEnabled(false)
    setError('')
    setNotice('')
  }, [mode])
  useEffect(() => {
    let alive = true
    const readQueue = pendingRead.current
    if (!selected) {
      setRun(null)
      return
    }
    const poll = async () => {
      try {
        const data = await api<Run>(`/runs/${selected}`)
        if (!alive) {
          return
        }
        setRun(data)
        if (data.status === 'running') {
          timer = setTimeout(poll, 1500)
        } else if (readQueue.delete(data.id) && data.status === 'done') {
          autoReadReply(
            data.id,
            data.result?.documents ? ocrMarkdown(data.result.documents) : (data.result?.text ?? '')
          )
        }
      } catch (e) {
        if (alive) {
          setError((e as Error).message)
          timer = setTimeout(poll, 2000)
        }
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    void poll()
    return () => {
      alive = false
      readQueue.delete(selected)
      clearTimeout(timer)
    }
  }, [selected])
  const action = async (fn: () => Promise<void>) => {
    if (pending) {
      return
    }
    setPending(true)
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }
  const start = (value = input, id = recipeId) => {
    prepareAutoRead()
    void action(async () => {
      const data = await api<Run>('/runs', 'POST', {
        kind,
        input: value,
        recipeId: id,
        message: value.goal || value.prompt || value.topic || value.text || `运行${entry.name}`,
        executionOptions,
      })
      if (useWorkspace.getState().function !== mode || useWorkspace.getState().runId !== selected) {
        await refresh()
        return
      }
      pendingRead.current.clear()
      pendingRead.current.add(data.id)
      useWorkspace.setState({ runId: data.id })
      setRun(data)
      await refresh()
    })
  }
  const save = () =>
    void action(async () => {
      const data = await api<Recipe>('/recipes', 'POST', {
        id: recipeId,
        kind,
        name,
        input,
        enabled,
        intervalMinutes: minutes,
        executionOptions,
      })
      setRecipeId(data.id)
      setNotice('配置已保存')
      await refresh()
    })
  const load = (recipe: Recipe) => {
    generation.current++
    useWorkspace.setState({ runId: null })
    setForms((f) => ({ ...f, [recipe.kind]: recipe.input }))
    setRecipeId(recipe.id)
    setName(recipe.name)
    setEnabled(recipe.enabled)
    setMinutes(recipe.intervalMinutes)
    setError('')
    setNotice('')
  }
  const upload = (files: FileList | null, field: 'fileIds' | 'referenceIds' = 'fileIds') => {
    if (!files?.length) {
      return
    }
    const chosen = [...files],
      target = kind,
      token = generation.current
    void action(async () => {
      const ids = [...(forms[target][field] ?? [])]
      if (ids.length + chosen.length > 20) {
        throw new Error('最多上传 20 个文件')
      }
      for (const file of chosen) {
        if (!file.size || file.size > 100 * 1024 * 1024) {
          throw new Error('文件应为非空且不超过 100 MiB')
        }
        const data = new FormData()
        data.append('file', file)
        const asset = await api<Asset>('/uploads', 'POST', data)
        ids.push(asset.id)
        if (token === generation.current) {
          setForms((f) => ({ ...f, [target]: { ...f[target], [field]: [...ids] } }))
        }
      }
      await refresh()
    })
  }
  const filePicker = (field: 'fileIds' | 'referenceIds' = 'fileIds', audio = false) => (
    <div className={styles.field}>
      <label>
        {field === 'referenceIds' ? '参考资料（可选）' : audio ? '会议录音' : '输入文件'}
      </label>
      <input
        type="file"
        aria-label={field === 'referenceIds' ? '上传参考资料' : '上传文件'}
        disabled={pending}
        multiple={!audio}
        accept={
          audio
            ? 'audio/*,video/mp4'
            : (kind === 'workflow' ? 'audio/*,video/mp4,' : '') +
              '.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.xlsx,.xls'
        }
        onChange={(e) => {
          upload(e.target.files, field)
          e.target.value = ''
        }}
      />
      <div className={styles.files}>
        {(input[field] ?? []).map((id) => (
          <span key={id}>
            {snapshot?.files.find((f) => f.id === id)?.name ?? '已上传文件'}
            <button
              type="button"
              aria-label="移除文件"
              onClick={() => setInput({ [field]: input[field]?.filter((x) => x !== id) })}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  )
  const busy = Boolean(snapshot?.activeId) || pending
  const recipes = snapshot?.recipes.filter((r) => r.kind === kind) ?? []
  const currentRecipe = snapshot?.recipes.find((r) => r.id === recipeId)
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>{entry.name}</h1>
          <p>{entry.description}</p>
        </header>
        {error ? (
          <div className={styles.error} role="alert">
            {error}
            <button
              type="button"
              onClick={() =>
                void action(async () => {
                  await refresh()
                })
              }
            >
              重新连接
            </button>
          </div>
        ) : null}
        {snapshot?.storageError ? (
          <p className={styles.error} role="alert">
            {snapshot.storageError}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        ) : null}
        <div className={styles.layout}>
          <section className={styles.card} aria-label="任务输入">
            {kind === 'ocr' ? (
              <>
                {filePicker()}
                <label className={styles.field}>
                  识别模式
                  <select
                    value={input.purpose}
                    onChange={(e) => setInput({ purpose: e.target.value })}
                  >
                    <option value="rich_layout_recognition">图文混排与区域坐标</option>
                    <option value="text_recognition">文字识别</option>
                  </select>
                </label>
                <p className={styles.hint}>
                  最多 20 个文件，每个不超过 100 MiB。复杂表格会保留在识别文本中，可导出进一步整理。
                </p>
              </>
            ) : null}
            {kind === 'documents' ? (
              <>
                {filePicker()}
                <label className={styles.field}>
                  分析问题
                  <textarea
                    rows={5}
                    value={input.prompt}
                    onChange={(e) => setInput({ prompt: e.target.value })}
                  />
                </label>
                <div className={styles.actions}>
                  {[
                    '总结内容并引用原文证据',
                    '比较这些文档的共同点、差异和矛盾，注明文件名',
                    '提取关键数据与表格，说明无法确认的内容',
                  ].map((s) => (
                    <button type="button" key={s} onClick={() => setInput({ prompt: s })}>
                      {s.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {kind === 'podcast' ? (
              <>
                <label className={styles.field}>
                  播客主题
                  <input
                    value={input.topic}
                    onChange={(e) => setInput({ topic: e.target.value })}
                    placeholder="例如：本周开源 AI 的重要进展"
                  />
                </label>
                <label className={styles.field}>
                  双人脚本（A 女声 / B 男声）
                  <textarea
                    rows={10}
                    value={input.script}
                    onChange={(e) => setInput({ script: e.target.value })}
                    placeholder={'A: 大家好，欢迎收听。\nB: 今天我们聊聊……'}
                  />
                </label>
                <p className={styles.hint}>
                  先生成脚本，编辑确认后合成音频。每行以 A: 或 B: 开头。
                </p>
              </>
            ) : null}
            {kind === 'meeting' ? (
              <>
                {filePicker('fileIds', true)}
                {filePicker('referenceIds')}
                <label className={styles.field}>
                  纪要要求
                  <textarea
                    rows={3}
                    value={input.prompt}
                    onChange={(e) => setInput({ prompt: e.target.value })}
                    placeholder="例如：重点提取项目决策和待办"
                  />
                </label>
                <p className={styles.hint}>
                  自动转为单声道并按 110
                  秒切分。时间为片段起点，不提供逐字时间戳或说话人身份识别。最大 100 MiB，建议不超过
                  3 小时。
                </p>
              </>
            ) : null}
            {kind === 'monitor' ? (
              <>
                <label className={styles.field}>
                  网页地址
                  <input
                    type="url"
                    value={input.url}
                    onChange={(e) => setInput({ url: e.target.value })}
                    placeholder="https://example.com/changelog"
                  />
                </label>
                <label className={styles.field}>
                  检测目标
                  <textarea
                    rows={3}
                    value={input.goal ?? ''}
                    onChange={(e) => setInput({ goal: e.target.value })}
                    placeholder="例如：是否发布新版本？哪些更新影响现有使用方式？"
                  />
                </label>
                <label className={styles.field}>
                  忽略包含以下文本的行（每行一条，可选）
                  <textarea
                    rows={3}
                    value={input.ignore}
                    onChange={(e) => setInput({ ignore: e.target.value })}
                  />
                </label>
                <p className={styles.hint}>
                  填写网页地址与检测目标即可运行。保存配置后可定期比较网页变化。
                </p>
              </>
            ) : null}
            {kind === 'subscription' ? (
              <>
                <label className={styles.field}>
                  订阅主题
                  <input
                    maxLength={100}
                    value={input.topic}
                    onChange={(e) => setInput({ topic: e.target.value })}
                    placeholder="例如：DeepSeek 开源模型"
                  />
                </label>
                <label className={styles.field}>
                  内容偏好
                  <textarea
                    rows={3}
                    value={input.preferences}
                    onChange={(e) => setInput({ preferences: e.target.value })}
                  />
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={input.voice}
                    onChange={(e) => setInput({ voice: e.target.checked })}
                  />
                  同时生成语音简报（前 3500 字）
                </label>
                <p className={styles.hint}>
                  搜索最近一天的资料，按链接和内容去重。简报保存在本地运行记录，不发送外部消息。
                </p>
              </>
            ) : null}
            {kind === 'workflow' ? (
              <>
                <label className={styles.field}>
                  工作流输入
                  <textarea
                    rows={3}
                    value={input.text}
                    onChange={(e) => setInput({ text: e.target.value })}
                    placeholder="输入搜索主题、网页地址或需要处理的文本"
                  />
                </label>
                {filePicker()}
                <FlowEditor nodes={input.nodes ?? []} onChange={(nodes) => setInput({ nodes })} />
              </>
            ) : null}
            <div className={styles.actions}>
              {kind === 'podcast' ? (
                <>
                  <Button
                    disabled={busy || !input.topic?.trim()}
                    onClick={() => start({ ...input, action: 'script' })}
                  >
                    生成脚本
                  </Button>
                  <Button
                    disabled={busy || !input.topic?.trim() || !input.script?.trim()}
                    variant="outlined"
                    onClick={() => start({ ...input, action: 'audio' })}
                  >
                    合成播客
                  </Button>
                </>
              ) : (
                <Button disabled={busy || !snapshot} onClick={() => start()}>
                  运行{entry.name}
                </Button>
              )}
              {snapshot?.activeId ? (
                <Button
                  variant="outlined"
                  disabled={pending}
                  onClick={() =>
                    void action(async () => {
                      await api(`/runs/${snapshot.activeId}/cancel`, 'POST')
                      await refresh()
                    })
                  }
                >
                  取消当前任务
                </Button>
              ) : null}
            </div>
            {snapshot?.activeId ? (
              <p className={styles.hint} role="status">
                有一个任务正在运行，完成或取消后可继续。
              </p>
            ) : null}
            <details
              className={styles.schedule}
              open={kind === 'monitor' || kind === 'subscription' || kind === 'workflow'}
            >
              <summary>保存配置与定时运行</summary>
              <label className={styles.field}>
                配置名称
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`${entry.name}配置`}
                />
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                启用定时执行
              </label>
              <label className={styles.field}>
                间隔（分钟）
                <input
                  type="number"
                  min={15}
                  max={43200}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </label>
              <p className={styles.hint}>
                每天一次填 1440。需在 .env
                配置密钥并保持本地服务运行；关闭浏览器不影响执行。首轮定时任务在保存后的一个间隔执行。
              </p>
              <Button
                size="m"
                variant="outlined"
                disabled={pending || !name.trim() || !snapshot}
                onClick={save}
              >
                {recipeId ? '更新配置' : '保存配置'}
              </Button>
              {kind === 'workflow' && recipeId ? (
                <div className={styles.publish}>
                  <Button
                    size="m"
                    variant="outlined"
                    disabled={pending}
                    onClick={() =>
                      void action(async () => {
                        await api(`/recipes/${recipeId}/publish`, 'POST')
                        await refresh()
                        setNotice('已发布本地 API；再次发布会更换令牌')
                      })
                    }
                  >
                    发布 / 更换 API 令牌
                  </Button>
                  {currentRecipe?.token ? (
                    <>
                      <pre>{`POST ${window.location.origin}/studio-api/published/${recipeId}\nAuthorization: Bearer ${currentRecipe.token}\nContent-Type: application/json\n\n{"text":"你的输入"}`}</pre>
                      <p className={styles.hint}>
                        返回任务 ID 与 resultUrl；携带同一令牌轮询 resultUrl
                        获取结果。仅本机可访问。
                      </p>
                      <Button
                        size="s"
                        variant="outlined"
                        onClick={() =>
                          void action(async () => {
                            await api(`/recipes/${recipeId}/publish`, 'DELETE')
                            await refresh()
                          })
                        }
                      >
                        撤销发布
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </details>
          </section>
          <aside className={styles.side}>
            <section className={styles.card}>
              <h2>已保存配置</h2>
              {recipes.length ? (
                recipes.map((r) => (
                  <div className={styles.saved} key={r.id}>
                    <button type="button" onClick={() => load(r)}>
                      <strong>{r.name}</strong>
                      <span>
                        {r.enabled
                          ? `下次：${new Date(r.nextRunAt ?? 0).toLocaleString()}`
                          : '手动运行'}
                        {r.hasBaseline ? ' · 已有快照' : ''}
                      </span>
                    </button>
                    <div className={styles.actions}>
                      <button type="button" disabled={busy} onClick={() => start(r.input, r.id)}>
                        运行
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          void action(async () => {
                            await api(`/recipes/${r.id}`, 'DELETE')
                            if (recipeId === r.id) {
                              setRecipeId(undefined)
                            }
                            await refresh()
                          })
                        }
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className={styles.hint}>保存常用输入，随时再次运行。</p>
              )}
            </section>
            <section className={styles.card}>
              <h2>运行记录</h2>
              {snapshot?.runs
                .filter((r) => r.kind === kind)
                .slice(0, 30)
                .map((r) => (
                  <button
                    type="button"
                    className={styles.runItem}
                    aria-pressed={selected === r.id}
                    key={r.id}
                    onClick={() => {
                      useWorkspace.setState({ runId: r.id })
                    }}
                  >
                    <span>
                      {statusLabel[r.status]} · {new Date(r.createdAt).toLocaleString()}
                    </span>
                    <small>{r.progress}</small>
                  </button>
                ))}
              {!snapshot?.runs.some((r) => r.kind === kind) ? (
                <p className={styles.hint}>尚无任务。结果会保存在本机。</p>
              ) : null}
            </section>
          </aside>
        </div>
        {run && run.id === selected && run.kind === kind ? (
          <ResultView
            run={run}
            assets={snapshot?.files ?? []}
            onScript={(script) => {
              setInput({ script })
              setNotice('脚本已载入编辑区，可以修改并合成音频')
            }}
            onRetry={() => start(run.input, run.recipeId ?? undefined)}
            busy={busy}
          />
        ) : null}
      </div>
    </div>
  )
}

const FlowEditor = ({
  nodes,
  onChange,
}: {
  nodes: FlowNode[]
  onChange: (nodes: FlowNode[]) => void
}) => {
  const move = (i: number, d: number) => {
    const copy = [...nodes]
    ;[copy[i], copy[i + d]] = [copy[i + d], copy[i]]
    onChange(copy)
  }
  return (
    <div className={styles.flow}>
      <h2>顺序节点</h2>
      <p className={styles.hint}>
        {'{{input}} 为初始输入，{{previous}} 为上一步文字结果。文件节点使用上传的输入文件。'}
      </p>
      {nodes.map((n, i) => (
        <div key={i} className={styles.node}>
          <div className={styles.nodeHeader}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            <select
              aria-label={`节点 ${i + 1} 类型`}
              value={n.type}
              onChange={(e) =>
                onChange(
                  nodes.map((x, j) => (j === i ? { ...x, type: e.target.value as NodeKind } : x))
                )
              }
            >
              {Object.entries(nodeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" disabled={i === 0} aria-label="上移" onClick={() => move(i, -1)}>
              ↑
            </button>
            <button
              type="button"
              disabled={i === nodes.length - 1}
              aria-label="下移"
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="删除节点"
              onClick={() => onChange(nodes.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
          <textarea
            aria-label={`节点 ${i + 1} 参数`}
            rows={3}
            value={n.prompt}
            placeholder="{{previous}}"
            onChange={(e) =>
              onChange(nodes.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))
            }
          />
          {i < nodes.length - 1 ? <div className={styles.arrow}>↓</div> : null}
        </div>
      ))}
      <Button
        size="s"
        variant="outlined"
        disabled={nodes.length >= 12}
        onClick={() => onChange([...nodes, { type: 'chat', prompt: '{{previous}}' }])}
      >
        添加节点
      </Button>
    </div>
  )
}

const ResultView = ({
  run,
  assets,
  onScript,
  onRetry,
  busy,
}: {
  run: Run
  assets: Asset[]
  onScript: (s: string) => void
  onRetry: () => void
  busy: boolean
}) => {
  const result = run.result,
    text = result?.documents
      ? ocrMarkdown(result.documents)
      : (result?.text ?? run.partialText ?? '')
  const reading = useReadAloud((s) => s.messageId === run.id)
  const output = run.status === 'done' ? text : `> 未完成的任务结果\n\n${text}`
  return (
    <section className={styles.result} aria-label="任务结果">
      <div className={styles.resultTop}>
        <div>
          <span className={styles.hint}>{statusLabel[run.status]}</span>
          <h2>{run.progress}</h2>
        </div>
        <div className={styles.actions}>
          <Button
            size="s"
            variant="outlined"
            disabled={!text || run.status !== 'done'}
            onClick={() =>
              toggleReadAloud(run.id, text, (e) => showToast(describeReadAloudError(e)))
            }
          >
            {reading ? '停止朗读' : '朗读回答'}
          </Button>
          <Button
            size="s"
            variant="outlined"
            disabled={!text}
            onClick={async () =>
              showToast({ key: (await copyText(output)) ? 'copied' : 'copyFailed' })
            }
          >
            复制
          </Button>
          <Button
            size="s"
            variant="outlined"
            disabled={!text}
            onClick={() => download(output, `${run.kind}.md`)}
          >
            导出 Markdown
          </Button>
          <Button
            size="s"
            variant="outlined"
            onClick={() =>
              download(JSON.stringify(run, null, 2), `${run.kind}.json`, 'application/json')
            }
          >
            导出 JSON
          </Button>
          <Button size="s" variant="outlined" disabled={busy} onClick={onRetry}>
            重新运行
          </Button>
        </div>
      </div>
      {run.error ? (
        <p role="alert" className={styles.error}>
          {run.error}
        </p>
      ) : null}
      {result?.incomplete ? (
        <p role="alert" className={styles.error}>
          部分 OCR 页面输出达到上限，请拆分文件后重新识别。
        </p>
      ) : null}
      {run.steps.length ? (
        <ol className={styles.steps}>
          {run.steps.map((s) => (
            <li key={s.index}>
              {nodeLabels[s.type as NodeKind]} ·{' '}
              {s.status === 'done'
                ? '完成'
                : s.status === 'error'
                  ? '失败'
                  : run.status === 'cancelled'
                    ? '已取消'
                    : '运行中'}
              {s.preview ? (
                <details>
                  <summary>查看输出</summary>
                  <pre>{s.preview}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {result?.script ? (
        <Button size="m" variant="outlined" onClick={() => onScript(result.script ?? '')}>
          载入脚本编辑
        </Button>
      ) : null}
      {result?.audioId ? (
        <div className={styles.audio}>
          <audio controls src={assetUrl(result.audioId)} />
          <a href={assetUrl(result.audioId)} download="audio.wav">
            下载音频 WAV
          </a>
        </div>
      ) : null}
      {result?.outputs
        ?.filter((x) => x.audioId && x.audioId !== result.audioId)
        .map((x) => <audio key={x.audioId} controls src={assetUrl(x.audioId ?? '')} />) ?? null}
      {result?.documents ? (
        <OcrResult documents={result.documents} assets={assets} />
      ) : (
        <Markdown
          content={output}
          loading={run.status === 'running'}
          cacheKey={run.id}
          disableLink={false}
        />
      )}
      {result?.source ? (
        <a href={result.source} target="_blank" rel="noreferrer">
          查看监测网页
        </a>
      ) : null}
      {result?.diff ? (
        <details>
          <summary>
            原始变化（新增 {result.diff.added.length} 行 / 删除 {result.diff.removed.length} 行）
          </summary>
          <pre>
            {result.diff.added
              .map((s) => '+ ' + s)
              .concat(result.diff.removed.map((s) => '- ' + s))
              .join('\n')}
          </pre>
        </details>
      ) : null}
      {result?.transcript ? (
        <details>
          <summary>完整转写文本</summary>
          <Button
            size="s"
            variant="outlined"
            onClick={() => download(result.transcript ?? '', 'transcript.md')}
          >
            导出转写
          </Button>
          <pre>{result.transcript}</pre>
        </details>
      ) : null}
    </section>
  )
}
