import { functions, selectFunction, useWorkspace } from '../../services/workspace.js'
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconSettingsOutline16, NewChatIcon } from '../base/icons.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const workspace = useWorkspace()
  const appThreads = [
    ...new Map(
      [...(workspace.snapshot?.runs ?? [])]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((r) => [r.conversationId ?? r.id, r])
    ).values(),
  ].sort((a, b) => b.createdAt - a.createdAt)
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)

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

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        {mobile ? (
          <button type="button" onClick={closeMobileSider}>
            关闭
          </button>
        ) : null}
      </div>
      <label className={styles.functionPicker}>
        功能
        <select
          aria-label="选择功能"
          value={workspace.function}
          onChange={(e) => {
            selectFunction(e.target.value as typeof workspace.function)
            closeMobileSider()
          }}
        >
          {functions.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          useWorkspace.setState({ conversationId: null })
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {appThreads.length ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>应用会话</div>
              {appThreads.map((run) => (
                <button
                  type="button"
                  key={run.conversationId ?? run.id}
                  className={styles.appThread}
                  aria-current={
                    workspace.conversationId === (run.conversationId ?? run.id) ? 'true' : undefined
                  }
                  onClick={() => {
                    selectFunction(run.kind, run.conversationId ?? run.id)
                    closeMobileSider()
                  }}
                >
                  <span>{run.message || functions.find((f) => f.value === run.kind)?.label}</span>
                  <small>
                    {functions.find((f) => f.value === run.kind)?.label} ·{' '}
                    {new Date(run.createdAt).toLocaleDateString()}
                  </small>
                </button>
              ))}
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={
                    (workspace.function === 'chat' || workspace.function === 'search') &&
                    session.id === activeId
                  }
                  onDelete={() => setDeleting(session)}
                />
              ))}
            </div>
          ))}
        </div>
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
