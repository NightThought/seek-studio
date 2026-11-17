import { useEffect, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings, setThinking, setSearch } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { Welcome } from '../components/session/Welcome.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { closeMobileSider, openMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { AppsStudio } from '../components/apps/AppsStudio.js'
import { functions, useWorkspace } from '../services/workspace.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate(),
    isMobile = useIsMobile(),
    settings = useSettings()
  const mode = useWorkspace((s) => s.function),
    configOpen = useWorkspace((s) => s.configOpen)
  const chat = mode === 'chat' || mode === 'search'
  const [configHost, setConfigHost] = useState<HTMLDivElement | null>(null)
  const ready = useChatStore((s) => s.ready),
    initError = useChatStore((s) => s.initError)
  const activeId = useChatStore((s) => s.activeId)
  const session = useChatStore((s) => (s.activeId ? s.sessionCache[s.activeId] : undefined))
  const streaming = useChatStore((s) => (s.activeId ? Boolean(s.streaming[s.activeId]) : false))
  const saveError = useChatStore((s) => Object.values(s.sessionSaveErrors).some(Boolean))
  const loadError = useChatStore((s) =>
    s.activeId ? Boolean(s.sessionLoadErrors[s.activeId]) : false
  )
  const frameRef = useMobileViewport(isMobile)
  usePreventPageScroll(isMobile)
  useEffect(() => {
    document.documentElement.lang = settings.locale
  }, [settings.locale])
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])
  useEffect(closeSearchPanel, [activeId, mode])
  useEffect(stopReadAloud, [activeId, mode])
  useEffect(closeMobileSider, [activeId, mode, isMobile])
  useEffect(() => {
    void initChat()
    ensureApiKey()
  }, [])
  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : <Sider />}
        <main className={styles.main}>
          <header className={styles.unifiedHeader}>
            {isMobile ? (
              <Button size="s" variant="outlined" onClick={openMobileSider}>
                历史与功能
              </Button>
            ) : null}
            <strong>{functions.find((f) => f.value === mode)?.label}</strong>
            <span>{settings.model}</span>
            <Button
              size="s"
              variant="outlined"
              onClick={() => useWorkspace.setState({ configOpen: !configOpen })}
            >
              {configOpen ? '收起配置' : '功能配置'}
            </Button>
          </header>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              {t('sessionSaveFailed')}
              <Button size="s" onClick={retrySaveSessions}>
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content} hidden={!chat}>
            {!ready || (activeId && !session) ? (
              <div className={styles.loadingState} role="status">
                {initError || loadError ? t('sessionLoadFailed') : t('sessionLoading')}
                <Button
                  size="s"
                  variant="outlined"
                  onClick={() => (activeId ? selectSession(activeId) : void initChat())}
                >
                  {t('retry')}
                </Button>
              </div>
            ) : session ? (
              <SessionView session={session} streaming={streaming} siderCollapsed={false} />
            ) : (
              <Welcome />
            )}
          </div>
          <div className={styles.searchContent} hidden={chat}>
            <AppsStudio configHost={chat ? null : configHost} />
          </div>
        </main>
        <aside className={styles.configuration} hidden={!configOpen} aria-label="功能配置">
          <div className={styles.configHeading}>
            功能配置
            <button type="button" onClick={() => useWorkspace.setState({ configOpen: false })}>
              关闭
            </button>
          </div>
          {chat ? (
            <div className={styles.chatConfig}>
              <label>
                <input
                  type="checkbox"
                  checked={settings.search}
                  onChange={(e) => setSearch(e.target.checked)}
                />
                联网搜索
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.thinking}
                  onChange={(e) => setThinking(e.target.checked)}
                />
                深度思考
              </label>
              <p>
                消息中的链接会自动读取，并结合当前对话上下文作答。联网和文件功能使用 DeepSeek
                Flash。
              </p>
              <p>模型、安全审计、用户元信息和自动朗读可在左下角「设置」中配置。</p>
            </div>
          ) : null}
          <div ref={setConfigHost} />
        </aside>
        {chat ? <SearchPanel /> : null}
      </div>
      <SettingsDialog />
      <Toast />
    </>
  )
}
