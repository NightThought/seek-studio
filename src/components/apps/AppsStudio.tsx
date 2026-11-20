import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react'
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
import { AppFilePicker } from './AppFilePicker.js'
import { Button } from '../base/Button.js'
import {
  IconBrowseOutline16,
  IconChevronDownOutline14,
  IconGlobeLanguageOutline14,
  IconMicOutline16,
  IconPlayMediaOutline16,
  IconSearchOutline16,
} from '../base/icons.js'
import { ChatOutline, ScanOutline } from '../sider/SiderIcons.js'
import { Markdown } from '../markdown/Markdown.js'
import { copyText } from '../../utils/clipboard.js'
import { showToast } from '../base/toastState.js'
import {
  api,
  assetUrl,
  download,
  runStatusLabel,
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
    description: '批量识别文档和图片，将文字和表格转成 Markdown，并对照原文。',
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
const ocrModes = [
  { value: 'rich_layout_recognition', label: '图文混排', detail: '识别版式与原文区域' },
  { value: 'text_recognition', label: '文字识别', detail: '仅提取文字内容' },
]
const documentTypes = '.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.xlsx,.xls'
const audioTypes = 'audio/*,video/mp4'
type FileField = 'fileIds' | 'referenceIds'

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
      { type: 'search', prompt: '' },
      { type: 'chat', prompt: '总结以上搜索资料，注明来源与关键依据。' },
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
    ttsVoice: settings.ttsVoice,
  }
  const [run, setRun] = useState<Run | null>(null)
  const resultRef = useRef<HTMLElement>(null)
  const taskHeadingId = useId()
  const pendingRead = useRef(new Set<string>())
  const [forms, setForms] = useState(seed)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [uploading, setUploading] = useState<{ kind: AppKind; field: FileField } | null>(null)
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
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
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
    const timer = setInterval(() => {
      const state = useWorkspace.getState()
      const inApps = state.function !== 'chat' && state.function !== 'search'
      if (inApps || state.snapshot?.activeId) {
        void poll()
      }
    }, 2000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void poll()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  useEffect(() => {
    generation.current++
    setRecipeId(undefined)
    setName('')
    setEnabled(false)
    setError('')
    setNotice('')
    if (mode !== 'chat' && mode !== 'search') {
      void refresh().catch(() => {})
    }
  }, [mode, refresh])
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
      const matchedRecipe = id ? snapshot?.recipes.find((r) => r.id === id) : undefined
      if (
        matchedRecipe &&
        id === recipeId &&
        ['monitor', 'subscription'].includes(kind) &&
        JSON.stringify(value) !== JSON.stringify(matchedRecipe.input)
      ) {
        await api<Recipe>('/recipes', 'POST', {
          id: matchedRecipe.id,
          kind,
          name: name.trim() || matchedRecipe.name,
          input: value,
          enabled,
          intervalMinutes: minutes,
          executionOptions,
        })
      }
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
  const upload = (files: FileList, field: FileField, limit: number) => {
    const chosen = [...files]
    const token = generation.current
    void action(async () => {
      const ids = limit === 1 ? [] : [...(input[field] ?? [])]
      if (ids.length + chosen.length > limit) {
        throw new Error(`最多选择 ${limit} 个文件`)
      }
      if (chosen.some((file) => !file.size || file.size > 100 * 1024 * 1024)) {
        throw new Error('文件应为非空且不超过 100 MiB')
      }
      setUploading({ kind, field })
      try {
        for (const file of chosen) {
          const data = new FormData()
          data.append('file', file)
          const asset = await api<Asset>('/uploads', 'POST', data)
          ids.push(asset.id)
          if (token === generation.current) {
            setInput({ [field]: [...ids] })
          }
        }
        await refresh()
      } finally {
        setUploading(null)
      }
    })
  }
  const filePicker = (field: FileField = 'fileIds') => {
    const references = field === 'referenceIds'
    const audio = kind === 'meeting' && !references
    const limit = references ? 10 : audio ? 1 : 20
    return (
      <AppFilePicker
        key={field}
        title={references ? '参考资料（可选）' : audio ? '会议录音' : '输入文件'}
        inputLabel={references ? '上传参考资料' : '上传文件'}
        accept={
          audio
            ? audioTypes
            : kind === 'workflow'
              ? `${audioTypes},${documentTypes}`
              : documentTypes
        }
        limit={limit}
        files={(input[field] ?? []).map((id) => ({
          id,
          name: snapshot?.files.find((file) => file.id === id)?.name ?? '已上传文件',
        }))}
        uploading={uploading?.kind === kind && uploading.field === field}
        disabled={pending}
        onUpload={(files) => upload(files, field, limit)}
        onRemove={(id) => setInput({ [field]: input[field]?.filter((fileId) => fileId !== id) })}
      />
    )
  }
  const busy = Boolean(snapshot?.activeId) || pending
  const missingFiles = ['ocr', 'documents', 'meeting'].includes(kind) && !input.fileIds?.length
  const currentRun = run?.id === selected && run.kind === kind ? run : null
  const recipes = snapshot?.recipes.filter((r) => r.kind === kind) ?? []
  const currentRecipe = snapshot?.recipes.find((r) => r.id === recipeId)
  return (
    <div
      className={styles.page}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'none'
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
        }
      }}
    >
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
          <section className={styles.taskCard} aria-labelledby={taskHeadingId}>
            <header className={styles.taskHeader}>
              <h2 id={taskHeadingId}>任务输入</h2>
            </header>
            <div className={styles.taskBody}>
              {kind === 'ocr' ? (
                <>
                  {filePicker()}
                  <fieldset className={styles.modeField}>
                    <legend>识别模式</legend>
                    <div className={styles.modeOptions}>
                      {ocrModes.map(({ value, label, detail }) => (
                        <label className={styles.modeOption} key={value}>
                          <input
                            type="radio"
                            name="ocr-mode"
                            value={value}
                            checked={(input.purpose ?? seed.ocr.purpose) === value}
                            onChange={() => setInput({ purpose: value })}
                          />
                          <span>
                            <strong>{label}</strong>
                            <small>{detail}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
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
                      <Button
                        size="s"
                        variant="outlined"
                        key={s}
                        onClick={() => setInput({ prompt: s })}
                      >
                        {s.slice(0, 8)}
                      </Button>
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
                  {filePicker()}
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
                    秒切分。时间为片段起点，不提供逐字时间戳或说话人身份识别。最大 100
                    MiB，建议不超过 3 小时。
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
                  <FlowEditor
                    nodes={input.nodes ?? []}
                    fileCount={(input.fileIds ?? []).length}
                    onChange={(nodes) => setInput({ nodes })}
                  />
                </>
              ) : null}
            </div>
            <div className={styles.taskFooter}>
              <div className={styles.taskFeedback}>
                {snapshot?.activeId ? <span role="status">有任务正在运行</span> : null}
                {currentRun ? (
                  <button
                    type="button"
                    className={styles.jumpToResult}
                    onClick={() => {
                      resultRef.current?.focus({ preventScroll: true })
                      resultRef.current?.scrollIntoView({ block: 'start' })
                    }}
                  >
                    查看结果 <IconChevronDownOutline14 />
                  </button>
                ) : null}
              </div>
              <div className={styles.runActions}>
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
                  <Button disabled={busy || !snapshot || missingFiles} onClick={() => start()}>
                    {kind === 'ocr' ? '开始识别' : `运行${entry.name}`}
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
            </div>
            <details
              key={kind}
              className={styles.schedule}
              open={kind === 'monitor' || kind === 'subscription' || kind === 'workflow'}
            >
              <summary>
                <span>保存配置与定时运行</span>
                <IconChevronDownOutline14 />
              </summary>
              <div className={styles.scheduleFields}>
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
                {enabled && snapshot && !snapshot.configured ? (
                  <p className={styles.error} role="status">
                    当前未检测到服务端 .env 密钥（DEEPSEEK_API_KEY），请配置后再启用定时执行。
                  </p>
                ) : null}
                <div className={styles.actions}>
                  <Button
                    size="m"
                    variant="outlined"
                    disabled={pending || !name.trim() || !snapshot}
                    onClick={save}
                  >
                    {recipeId ? '更新配置' : '保存配置'}
                  </Button>
                  {recipeId ? (
                    <Button
                      size="m"
                      variant="outlined"
                      disabled={pending}
                      onClick={() => {
                        setRecipeId(undefined)
                        setName('')
                        setEnabled(false)
                        setNotice('已切换为新建配置模式')
                      }}
                    >
                      新建配置
                    </Button>
                  ) : null}
                </div>
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
              </div>
            </details>
          </section>
          <aside className={styles.card} aria-label="已保存配置">
            <h2>已保存配置</h2>
            {recipes.length ? (
              <div className={styles.railList}>
                {recipes.map((r) => (
                  <div className={styles.saved} key={r.id}>
                    <button
                      type="button"
                      className={styles.savedTitle}
                      aria-pressed={recipeId === r.id}
                      disabled={pending}
                      onClick={() => load(r)}
                    >
                      <strong>{r.name}</strong>
                      <span>
                        {r.enabled
                          ? `下次：${new Date(r.nextRunAt ?? 0).toLocaleString()}`
                          : '手动运行'}
                        {r.hasBaseline ? ' · 已有快照' : ''}
                      </span>
                    </button>
                    <div className={styles.actions}>
                      <Button
                        size="s"
                        variant="outlined"
                        disabled={busy}
                        onClick={() => start(r.input, r.id)}
                      >
                        运行
                      </Button>
                      <Button
                        size="s"
                        variant="outlined"
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
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyRail}>在「保存配置与定时运行」中保存常用参数。</p>
            )}
          </aside>
        </div>
        {currentRun ? (
          <ResultView
            run={currentRun}
            sectionRef={resultRef}
            assets={snapshot?.files ?? []}
            onScript={(script) => {
              setInput({ script })
              setNotice('脚本已载入编辑区，可以修改并合成音频')
            }}
            onLoadInput={() => {
              setForms((f) => ({
                ...f,
                [currentRun.kind]: {
                  ...f[currentRun.kind],
                  ...currentRun.input,
                  ...(currentRun.result?.script ? { script: currentRun.result.script } : {}),
                },
              }))
              setNotice('已将该次任务的参数回填至输入区')
            }}
            onRetry={() => start(currentRun.input, currentRun.recipeId ?? undefined)}
            busy={busy}
          />
        ) : null}
      </div>
    </div>
  )
}

type NodeMeta = {
  label: string
  icon: ReactNode
  badge: string
  description: string
  usesPrompt: boolean
  promptLabel?: string
  placeholder?: string
  defaultPrompt: (index: number) => string
  presets?: { label: string; prompt: string }[]
}

const nodeMeta: Record<NodeKind, NodeMeta> = {
  search: {
    label: '网页搜索',
    icon: <IconSearchOutline16 />,
    badge: '文本 → 搜索资料 JSON',
    description: '联网检索实时网页资讯，返回标题、摘要与链接列表供下一步分析。',
    usesPrompt: false,
    defaultPrompt: () => '',
  },
  fetch: {
    label: '网页抓取',
    icon: <IconGlobeLanguageOutline14 />,
    badge: 'URL → 网页正文',
    description: '自动读取上游传入的公开网页地址（https://），抓取网页正文传给下一步。',
    usesPrompt: false,
    defaultPrompt: () => '',
  },
  chat: {
    label: '模型生成',
    icon: <ChatOutline />,
    badge: '上游文本 → AI 生成结果',
    description: '上游结果会自动传入模型，你只需填写希望模型如何处理的指令。',
    usesPrompt: true,
    promptLabel: '处理要求（上游内容已自动带入，无需手动引用）',
    placeholder: '例如：总结核心要点，注明来源；留空则直接由模型处理上游内容',
    defaultPrompt: (i) => (i === 0 ? '' : '总结以上内容的核心要点，并注明关键依据。'),
    presets: [
      {
        label: '总结要点与来源',
        prompt: '总结以上资料的核心要点，注明来源与关键依据。',
      },
      {
        label: '提取结构化表格',
        prompt: '从以上内容中提取关键数据与结论，整理为 Markdown 表格。',
      },
      {
        label: '改写为播报口播稿',
        prompt: '将以上内容改写为自然流畅、适合语音朗读的中文简报（控制在 800 字以内）。',
      },
    ],
  },
  ocr: {
    label: 'OCR 识别',
    icon: <ScanOutline />,
    badge: '上方输入文件 → Markdown 文本',
    description: '自动批量识别上方上传的 PDF 或图片，提取版面文字与表格为 Markdown。',
    usesPrompt: false,
    defaultPrompt: () => '',
  },
  files: {
    label: '文件分析',
    icon: <IconBrowseOutline16 />,
    badge: '上方输入文件 + 指令 → 分析报告',
    description: '自动关联上方上传的多份文档（及上一步输出），按你的要求进行深度分析或对比。',
    usesPrompt: true,
    promptLabel: '文档分析要求（上传的文档与上游内容已自动带入）',
    placeholder: '例如：总结上传文档的主要结论，列出原文依据',
    defaultPrompt: (i) =>
      i === 0 ? '总结上传文档的主要内容，列出原文依据。' : '结合上传文档与上一步结果进行对比分析。',
    presets: [
      { label: '总结文档并附依据', prompt: '总结上传文档的核心内容，并引用原文依据与文件名。' },
      { label: '对比多份文档差异', prompt: '比较上传文档的共同点、差异和矛盾，注明文件名。' },
    ],
  },
  asr: {
    label: '语音转写',
    icon: <IconMicOutline16 />,
    badge: '上方录音文件 → 带时间戳转写文本',
    description: '自动将上方上传的 1 个音频/视频文件切分并转写为带时间段的文字记录。',
    usesPrompt: false,
    defaultPrompt: () => '',
  },
  tts: {
    label: '语音合成',
    icon: <IconPlayMediaOutline16 />,
    badge: '上游文本 → 音频 WAV（≤4000 字）',
    description: '自动将上一步生成的文本（或初始输入）合成为可收听、可下载的语音音频。',
    usesPrompt: false,
    defaultPrompt: () => '',
  },
}

const workflowTemplates: {
  name: string
  detail: string
  nodes: FlowNode[]
}[] = [
  {
    name: '联网调研总结',
    detail: '网页搜索 → 模型总结',
    nodes: [
      { type: 'search', prompt: '' },
      { type: 'chat', prompt: '总结以上搜索资料，注明来源与关键依据。' },
    ],
  },
  {
    name: '网页精读播报',
    detail: '网页抓取 → 提炼简报 → 语音合成',
    nodes: [
      { type: 'fetch', prompt: '' },
      {
        type: 'chat',
        prompt: '提炼以上网页的核心内容，改写为 600 字以内适合朗读的中文简报。',
      },
      { type: 'tts', prompt: '' },
    ],
  },
  {
    name: '扫描件 OCR 提炼',
    detail: 'OCR 识别 → 结构化整理',
    nodes: [
      { type: 'ocr', prompt: '' },
      {
        type: 'chat',
        prompt: '整理以上 OCR 识别文本，修正版式并提取核心信息与表格。',
      },
    ],
  },
  {
    name: '录音转写纪要',
    detail: '语音转写 → 会议纪要与待办',
    nodes: [
      { type: 'asr', prompt: '' },
      {
        type: 'chat',
        prompt: '根据以上录音转写内容整理会议纪要、关键决策与待办事项表格。',
      },
    ],
  },
]

const cleanLegacyPrompt = (prompt: string) =>
  prompt
    .replace(/\n*\{\{(input|previous)\}\}\n*/g, '')
    .replace(/以下/g, '以上')
    .trim()

const FlowEditor = ({
  nodes,
  fileCount = 0,
  onChange,
}: {
  nodes: FlowNode[]
  fileCount?: number
  onChange: (nodes: FlowNode[]) => void
}) => {
  const move = (i: number, d: number) => {
    const copy = [...nodes]
    ;[copy[i], copy[i + d]] = [copy[i + d], copy[i]]
    onChange(copy)
  }
  const changeNodeType = (index: number, nextType: NodeKind) => {
    onChange(
      nodes.map((node, j) =>
        j === index ? { type: nextType, prompt: nodeMeta[nextType].defaultPrompt(index) } : node
      )
    )
  }
  const appendNode = (type: NodeKind) => {
    if (nodes.length >= 12) {
      return
    }
    const nextIndex = nodes.length
    onChange([...nodes, { type, prompt: nodeMeta[type].defaultPrompt(nextIndex) }])
  }
  const describeSource = (n: FlowNode, i: number) => {
    const prevNode = i > 0 ? nodes[i - 1] : null
    const prevLabel = prevNode
      ? `步骤 ${String(i).padStart(2, '0')}（${nodeMeta[prevNode.type].label}）的输出结果`
      : '上方「工作流输入」填写的内容'
    if (n.type === 'ocr') {
      return fileCount > 0
        ? `✓ 数据来源：自动读取上方已上传的 ${fileCount} 个文档/图片`
        : '等待上传文件：请先在上方「输入文件」中选择 PDF 或图片'
    }
    if (n.type === 'asr') {
      return fileCount === 1
        ? '✓ 数据来源：自动读取上方已上传的 1 个录音文件'
        : fileCount > 1
          ? `提示：语音转写仅需 1 个录音文件（当前已上传 ${fileCount} 个）`
          : '等待上传录音：请先在上方「输入文件」中上传 1 个音频或视频文件'
    }
    if (n.type === 'files') {
      return fileCount > 0
        ? `✓ 数据来源：自动读取上方已上传的 ${fileCount} 个文件${i > 0 ? ` + ${prevLabel}` : ''}`
        : '等待上传文件：请先在上方「输入文件」中上传需要分析的文档'
    }
    return `✓ 数据来源：自动带入${prevLabel}`
  }
  return (
    <div className={styles.flow}>
      <div className={styles.flowTop}>
        <div>
          <h2>顺序节点（共 {nodes.length} 步）</h2>
          <p className={styles.hint}>上一步的输出会自动传给下一步，无需手动填写任何变量占位符。</p>
        </div>
        <div className={styles.templateBar} aria-label="常用工作流模板">
          <span className={styles.templateLabel}>常用模板：</span>
          {workflowTemplates.map((tpl) => (
            <button
              key={tpl.name}
              type="button"
              className={styles.templateBtn}
              title={tpl.detail}
              onClick={() => onChange(tpl.nodes.map((n) => ({ ...n })))}
            >
              <strong>{tpl.name}</strong>
              <small>{tpl.detail}</small>
            </button>
          ))}
        </div>
      </div>
      {nodes.map((n, i) => {
        const meta = nodeMeta[n.type]
        const needsFile = ['ocr', 'asr', 'files'].includes(n.type)
        const sourceReady = !needsFile || (n.type === 'asr' ? fileCount === 1 : fileCount > 0)
        const displayPrompt = cleanLegacyPrompt(n.prompt)
        return (
          <div key={i} className={styles.node}>
            <div className={styles.nodeHeader}>
              <span className={styles.nodeStepBadge}>步骤 {String(i + 1).padStart(2, '0')}</span>
              <strong className={styles.nodeTitle}>{meta.label}</strong>
              <span className={styles.nodeFlowBadge}>{meta.badge}</span>
              <div className={styles.nodeMoveGroup}>
                <button
                  type="button"
                  disabled={i === 0}
                  aria-label="上移"
                  title="上移此步骤"
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={i === nodes.length - 1}
                  aria-label="下移"
                  title="下移此步骤"
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="删除节点"
                  title="删除此步骤"
                  disabled={nodes.length <= 1}
                  onClick={() => onChange(nodes.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            </div>
            <div
              className={styles.nodeTypeGrid}
              role="radiogroup"
              aria-label={`节点 ${i + 1} 类型`}
            >
              {(Object.keys(nodeMeta) as NodeKind[]).map((kindKey) => {
                const item = nodeMeta[kindKey]
                const active = n.type === kindKey
                return (
                  <button
                    key={kindKey}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={styles.nodeTypePill}
                    data-active={active ? 'true' : undefined}
                    onClick={() => changeNodeType(i, kindKey)}
                  >
                    <span className={styles.nodeTypePillIcon} aria-hidden="true">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
            <div className={styles.nodeFileCard} data-ready={sourceReady ? 'true' : undefined}>
              <strong>{describeSource(n, i)}</strong>
              <span>{meta.description}</span>
            </div>
            {meta.usesPrompt ? (
              <div className={styles.nodeParamBox}>
                <div className={styles.nodeParamToolbar}>
                  <span className={styles.nodeParamLabel}>{meta.promptLabel}</span>
                  {meta.presets?.length ? (
                    <div className={styles.nodePresetBar}>
                      <span>快捷指令：</span>
                      {meta.presets.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          className={styles.presetChip}
                          onClick={() =>
                            onChange(
                              nodes.map((x, j) => (j === i ? { ...x, prompt: preset.prompt } : x))
                            )
                          }
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <textarea
                  aria-label={`节点 ${i + 1} 参数`}
                  rows={2}
                  value={displayPrompt}
                  placeholder={meta.placeholder}
                  onChange={(e) =>
                    onChange(nodes.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))
                  }
                />
              </div>
            ) : null}
            {i < nodes.length - 1 ? <div className={styles.arrow}>↓</div> : null}
          </div>
        )
      })}
      <div className={styles.addNodePanel}>
        <Button
          size="s"
          variant="outlined"
          disabled={nodes.length >= 12}
          onClick={() =>
            onChange([
              ...nodes,
              { type: 'chat', prompt: nodeMeta.chat.defaultPrompt(nodes.length) },
            ])
          }
        >
          添加节点
        </Button>
        <div className={styles.quickAddGroup}>
          <span>或直接添加：</span>
          {(Object.keys(nodeMeta) as NodeKind[]).map((kindKey) => (
            <button
              key={kindKey}
              type="button"
              className={styles.quickAddChip}
              disabled={nodes.length >= 12}
              onClick={() => appendNode(kindKey)}
            >
              + {nodeMeta[kindKey].label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const ResultView = ({
  run,
  sectionRef,
  assets,
  onScript,
  onLoadInput,
  onRetry,
  busy,
}: {
  run: Run
  sectionRef: Ref<HTMLElement>
  assets: Asset[]
  onScript: (s: string) => void
  onLoadInput: () => void
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
    <section className={styles.result} aria-label="任务结果" ref={sectionRef} tabIndex={-1}>
      <div className={styles.resultTop}>
        <div>
          <span className={styles.hint}>{runStatusLabel[run.status]}</span>
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
          <Button size="s" variant="outlined" disabled={busy} onClick={onLoadInput}>
            回填参数
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
        <OcrResult
          key={run.id}
          documents={result.documents}
          assets={assets}
          includeFigures={run.input.purpose !== 'text_recognition'}
        />
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
