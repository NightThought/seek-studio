import {
  functions,
  selectFunction,
  setAppSnapshot,
  useWorkspace,
} from '../../services/workspace.js'
import { Select } from '../base/Select.js'
import clsx from 'clsx'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import {
  IconBrowseOutline16,
  IconChevronDownOutline14,
  IconGlobeLanguageOutline14,
  IconMicOutline16,
  IconPanelLeftOutline16,
  IconPlayMediaOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { api, runStatusLabel, type Snapshot } from '../apps/api.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import {
  BellOutline,
  ChatOutline,
  HistoryOutline,
  ScanOutline,
  WorkflowOutline,
} from './SiderIcons.js'
import styles from './Sider.module.css'

const functionIcons = {
  chat: ChatOutline,
  search: IconSearchOutline16,
  ocr: ScanOutline,
  documents: IconBrowseOutline16,
  podcast: IconPlayMediaOutline16,
  meeting: IconMicOutline16,
  monitor: IconGlobeLanguageOutline14,
  subscription: BellOutline,
  workflow: WorkflowOutline,
}

const HistorySection = ({
  title,
  icon,
  initiallyOpen,
  children,
}: {
  title: string
  icon: ReactNode
  initiallyOpen: boolean
  children: ReactNode
}) => {
  const [open, setOpen] = useState(initiallyOpen)
  const listId = useId()
  return (
    <section className={styles.historyGroup} aria-label={title}>
      <button
        type="button"
        className={styles.historyButton}
        aria-controls={listId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.historyLabel}>
          <span className={styles.controlIcon} aria-hidden="true">
            {icon}
          </span>
          {title}
        </span>
        <span className={styles.historyArrow} aria-hidden="true">
          <IconChevronDownOutline14 />
        </span>
      </button>
      <div className={styles.historyList} id={listId} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  )
}

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const workspace = useWorkspace()
  const historyScope =
    workspace.function === 'chat' ? 'chat' : workspace.function === 'search' ? 'search' : 'apps'
  const appRuns = workspace.snapshot?.runs ?? []
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const functionOptions = useMemo(
    () =>
      functions.map((entry) => {
        const Icon = functionIcons[entry.value]
        return { ...entry, label: t(entry.labelKey), icon: <Icon /> }
      }),
    [t]
  )
  const runDateTime = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale]
  )

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  if (!mobile && collapsed) {
    return (
      <div className={clsx(styles.sider, styles.siderCollapsed)}>
        <div className={styles.railTop}>
          <button
            type="button"
            className={styles.toggleBtn}
            aria-label={t('expandSiderbarButton')}
            title={t('expandSiderbarButton')}
            onClick={() => setCollapsed(false)}
          >
            <IconPanelLeftOutline16 />
          </button>
        </div>
        <button
          type="button"
          className={styles.railPrimaryBtn}
          aria-label={t('newChat')}
          title={t('newChat')}
          onClick={() => {
            selectFunction('chat')
            newChat()
          }}
        >
          <NewChatIcon />
        </button>
        <div className={styles.railDivider} />
        <nav className={styles.railNav} aria-label={t('sidebarSelectFunction')}>
          {functionOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.railItem}
              aria-label={option.label}
              title={option.label}
              data-active={workspace.function === option.value ? 'true' : undefined}
              onClick={() => selectFunction(option.value)}
            >
              {option.icon}
            </button>
          ))}
        </nav>
        <div className={styles.railDivider} />
        <button
          type="button"
          className={styles.railItem}
          aria-label={t('sidebarRunHistory')}
          title={`${t('sidebarChatHistory')} / ${t('sidebarRunHistory')}`}
          onClick={() => setCollapsed(false)}
        >
          <HistoryOutline />
        </button>
        <div className={styles.railBottom}>
          <button
            type="button"
            className={styles.railItem}
            aria-label={t('settings')}
            title={t('settings')}
            onClick={() => openSettings('model')}
          >
            <IconSettingsOutline16 />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        {mobile ? (
          <button type="button" className={styles.closeButton} onClick={closeMobileSider}>
            {t('close')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.toggleBtn}
            aria-label={t('collapseSiderbarButton')}
            title={t('collapseSiderbarButton')}
            onClick={() => setCollapsed(true)}
          >
            <IconPanelLeftOutline16 />
          </button>
        )}
      </div>
      <div className={styles.functionPicker}>
        <span>{t('sidebarFunctionLabel')}</span>
        <Select
          ariaLabel={t('sidebarSelectFunction')}
          className={styles.functionSelect}
          value={workspace.function}
          options={functionOptions}
          matchTriggerWidth
          onChange={(value) => {
            selectFunction(value)
            closeMobileSider()
          }}
        />
      </div>
      {historyScope === 'chat' ? (
        <button
          type="button"
          className={styles.newChat}
          onClick={() => {
            selectFunction('chat')
            newChat()
            closeMobileSider()
          }}
        >
          <span className={styles.controlIcon} aria-hidden="true">
            <NewChatIcon />
          </span>
          {t('newChat')}
        </button>
      ) : null}
      <div className={styles.listWrap} key={historyScope}>
        <HistorySection
          title={t('sidebarChatHistory')}
          icon={<ChatOutline />}
          initiallyOpen={historyScope === 'chat'}
        >
          {groups.length ? (
            groups.map((group) => (
              <div key={group.key} className={styles.section}>
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={historyScope === 'chat' && session.id === activeId}
                    onDelete={() => setDeleting(session)}
                  />
                ))}
              </div>
            ))
          ) : (
            <p className={styles.historyEmpty}>{t('sidebarNoChats')}</p>
          )}
        </HistorySection>
        <HistorySection
          title={t('sidebarRunHistory')}
          icon={<HistoryOutline />}
          initiallyOpen={historyScope === 'apps'}
        >
          {appRuns.length ? (
            appRuns.map((run) => {
              const fnEntry = functions.find((entry) => entry.value === run.kind)
              const kindLabel = fnEntry ? t(fnEntry.labelKey) : run.kind
              const title = run.message || kindLabel
              const createdAt = new Date(run.createdAt)
              return (
                <div key={run.id} className={styles.appThreadRow}>
                  <button
                    type="button"
                    className={styles.appThread}
                    aria-current={workspace.runId === run.id ? 'true' : undefined}
                    onClick={() => {
                      selectFunction(run.kind, run.id)
                      closeMobileSider()
                    }}
                  >
                    <span title={title}>{title}</span>
                    <small>
                      {kindLabel} · {runStatusLabel[run.status]} ·{' '}
                      <time dateTime={createdAt.toISOString()}>
                        {runDateTime.format(createdAt)}
                      </time>
                    </small>
                  </button>
                  <button
                    type="button"
                    className={styles.appThreadDelete}
                    aria-label={t('deleteRunLabel')}
                    disabled={workspace.snapshot?.activeId === run.id}
                    onClick={async (event) => {
                      event.stopPropagation()
                      try {
                        await api(`/runs/${run.id}`, 'DELETE')
                        if (useWorkspace.getState().runId === run.id) {
                          useWorkspace.setState({ runId: null })
                        }
                        const next = await api<Snapshot>('/state')
                        setAppSnapshot(next)
                      } catch {
                        showToast({ key: 'historyDeleteFailed', type: 'error' })
                      }
                    }}
                  >
                    <IconTrashOutline16 />
                  </button>
                </div>
              )
            })
          ) : (
            <p className={styles.historyEmpty}>{t('sidebarNoRuns')}</p>
          )}
        </HistorySection>
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('model')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
