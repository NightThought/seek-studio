import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { selectFunction, useWorkspace } from '../../services/workspace.js'
import { autoReadReply, prepareAutoRead } from '../../services/speech/readAloud.js'
import { setDraftText } from '../../services/chat/drafts.js'
import { getReplyText } from '../../services/chat/reply.js'
import { newChat } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { createLatestReminder } from '../../services/chat/latestReminder.js'
import { describeReply } from '../../services/chat/describe.js'
import type { AssistantMessage } from '../../services/chat/types.js'
import { exportSearchMarkdown, runSearch, sourceHref } from '../../services/search/task.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { Markdown } from '../markdown/Markdown.js'
import { useReplyView } from '../messages/useReplyView.js'
import { SourceCard } from '../search/SourceCard.js'
import { ensureApiKey, openSettings } from '../settings/settingsDialogState.js'
import styles from './SearchStudio.module.css'

type SearchHistoryItem = {
  id: string
  query: string
  reply: AssistantMessage
  createdAt: number
}

const SEARCH_HISTORY_KEY = 'seek-studio:search-history'

const loadSearchHistory = (): SearchHistoryItem[] => {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
    return raw ? (JSON.parse(raw) as SearchHistoryItem[]) : []
  } catch {
    return []
  }
}

const saveSearchHistory = (items: SearchHistoryItem[]) => {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(items.slice(0, 10)))
  } catch {
    // ignore quota errors
  }
}

export const SearchStudio = () => {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [reply, setReply] = useState<AssistantMessage | null>(null)
  const [history, setHistory] = useState<SearchHistoryItem[]>(loadSearchHistory)
  const controller = useRef<AbortController | null>(null)
  const busy = reply?.status === 'pending' || reply?.status === 'streaming'
  useEffect(() => () => controller.current?.abort(), [])

  const search = async (question: string) => {
    if (controller.current || !question.trim() || !ensureApiKey()) {
      return
    }
    prepareAutoRead()
    const request = new AbortController()
    controller.current = request
    const trimmed = question.trim()
    setSubmitted(trimmed)
    const settings = useSettings.getState()
    try {
      const result = await runSearch(
        settings.apiKey ?? '',
        trimmed,
        settings.metadataEnabled ? createLatestReminder(settings) : undefined,
        request.signal,
        setReply,
        settings.safetyEnabled
      )
      if (result.status === 'done' && result.stopReason !== 'refusal') {
        setHistory((prev) => {
          const next = [
            { id: result.id, query: trimmed, reply: result, createdAt: Date.now() },
            ...prev.filter((item) => item.query !== trimmed),
          ].slice(0, 10)
          saveSearchHistory(next)
          return next
        })
        if (useWorkspace.getState().function === 'search') {
          autoReadReply(result.id, getReplyText(result))
        }
      }
    } finally {
      controller.current = null
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.intro}>
          <span className={styles.eyebrow}>SEEKSTUDIO / SEARCH</span>
          <h1>{t('searchStudio')}</h1>
          <p>{t('searchIntro')}</p>
        </header>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            void search(query)
          }}
        >
          <label htmlFor="search-query">{t('searchQuestion')}</label>
          <textarea
            id="search-query"
            rows={3}
            maxLength={8000}
            value={query}
            placeholder={t('searchPlaceholder')}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                void search(query)
              }
            }}
          />
          <div className={styles.formFooter}>
            <span>{t('searchSessionOnly')}</span>
            {busy ? (
              <Button variant="outlined" onClick={() => controller.current?.abort()}>
                {t('searchStop')}
              </Button>
            ) : (
              <Button type="submit" disabled={!query.trim()}>
                {t('searchStart')}
              </Button>
            )}
          </div>
        </form>
        {history.length ? (
          <div className={styles.recentBar}>
            <span className={styles.recentLabel}>{t('searchRecentHistory')}</span>
            <div className={styles.recentList}>
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.recentChip}
                  aria-pressed={reply?.id === item.id}
                  disabled={busy}
                  onClick={() => {
                    setQuery(item.query)
                    setSubmitted(item.query)
                    setReply(item.reply)
                  }}
                >
                  {item.query}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.clearHistory}
              disabled={busy}
              onClick={() => {
                setHistory([])
                saveSearchHistory([])
              }}
            >
              {t('searchClearHistory')}
            </button>
          </div>
        ) : null}
        {reply ? (
          <SearchResult
            query={submitted}
            reply={reply}
            busy={busy}
            onRetry={() => void search(submitted)}
          />
        ) : (
          <div className={styles.empty}>
            <h2>{t('searchEmptyTitle')}</h2>
            <p>{t('searchEmptyDescription')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

const SearchResult = ({
  query,
  reply,
  busy,
  onRetry,
}: {
  query: string
  reply: AssistantMessage
  busy: boolean
  onRetry: () => void
}) => {
  const t = useTranslate()
  const view = useReplyView(reply, busy)
  const refused = reply.stopReason === 'refusal'
  const answer = view.answer
  const sources = view.sources.filter((source) => sourceHref(source.url))
  const notice = busy ? null : describeReply(reply)
  const markdown = exportSearchMarkdown(query, reply, {
    sources: t('searchSources'),
    incomplete: t('searchIncomplete'),
  })
  const failedTool = view.steps.some(
    (step) =>
      (step.type === 'search' && step.status === 'failed') ||
      (step.type === 'open' && step.pages.some((page) => page.status === 'failed'))
  )
  const status = refused
    ? 'replyRefusedStatus'
    : busy
      ? 'searchRunning'
      : reply.status === 'error'
        ? 'searchFailed'
        : reply.status === 'stopped'
          ? 'searchStopped'
          : 'searchFinished'

  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `seek-search-${
      query
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .slice(0, 60) || 'report'
    }.md`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className={styles.result} aria-label={t('searchResult')}>
      <div className={styles.resultHeader}>
        <div>
          <span role="status" aria-live="polite" className={styles.status}>
            {t(status)}
          </span>
          <h2>{query}</h2>
        </div>
        <div className={styles.actions}>
          <Button
            size="s"
            variant="outlined"
            disabled={busy || !markdown}
            onClick={async () => {
              showToast({ key: (await copyText(markdown)) ? 'copied' : 'copyFailed' })
            }}
          >
            {t('copy')}
          </Button>
          <Button size="s" variant="outlined" disabled={busy || !markdown} onClick={download}>
            {t('searchExport')}
          </Button>
          <Button
            size="s"
            variant="outlined"
            disabled={busy || !answer?.markdown}
            onClick={() => {
              newChat()
              setDraftText(
                null,
                `基于以下联网搜索结果继续深入讨论：\n\n问题：${query}\n\n回答摘要：\n${(answer?.markdown ?? '').slice(0, 4000)}\n\n我想继续了解：`
              )
              selectFunction('chat')
            }}
          >
            {t('searchContinueInChat')}
          </Button>
          <Button size="s" variant="outlined" disabled={busy} onClick={onRetry}>
            {t('retry')}
          </Button>
        </div>
      </div>
      {notice || reply.status === 'error' ? (
        <div className={styles.notice} role="alert">
          {notice?.text || t('searchFailed')}
          {notice?.action === 'apiKey' ? (
            <Button size="s" variant="outlined" onClick={() => openSettings('model')}>
              {t('settings')}
            </Button>
          ) : null}
          {notice?.action === 'topUp' ? (
            <a href="https://platform.deepseek.com/top_up" target="_blank" rel="noreferrer">
              {t('topUp')}
            </a>
          ) : null}
        </div>
      ) : null}
      {!busy &&
      !refused &&
      (reply.status === 'stopped' ||
        reply.status === 'error' ||
        reply.stopReason === 'max_tokens') ? (
        <p className={styles.notice}>{t('searchIncomplete')}</p>
      ) : null}
      {!busy && !refused && failedTool ? (
        <p className={styles.notice}>{t('searchToolFailed')}</p>
      ) : null}
      <div className={styles.columns}>
        <article className={styles.answer}>
          <h3>{t('searchAnswer')}</h3>
          {answer ? (
            <Markdown
              content={answer.markdown}
              loading={busy}
              cacheKey={reply.id}
              disableLink={false}
              sources={sources}
            />
          ) : (
            <p className={styles.muted}>
              {t(busy ? 'searchWaiting' : refused ? 'replyRefused' : 'searchNoAnswer')}
            </p>
          )}
        </article>
        <aside className={styles.sources}>
          <h3>
            {t('searchSources')} <span>{sources.length}</span>
          </h3>
          {sources.length ? (
            sources.map((source) => (
              <div className={styles.source} key={source.url}>
                <span className={styles.sourceNumber}>{source.index}</span>
                <SourceCard source={source} />
              </div>
            ))
          ) : (
            <p className={styles.muted}>{t(busy ? 'searchSourcesWaiting' : 'searchNoSources')}</p>
          )}
        </aside>
      </div>
    </section>
  )
}
