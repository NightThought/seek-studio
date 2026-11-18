import { useEffect } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
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
import { SearchStudio } from '../components/searchStudio/SearchStudio.js'
import { AppsStudio } from '../components/apps/AppsStudio.js'
import { functions, useWorkspace } from '../services/workspace.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate(),
    isMobile = useIsMobile(),
    settings = useSettings()
  const mode = useWorkspace((s) => s.function)
  const chat = mode === 'chat'
  const app = !chat && mode !== 'search'
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
                {t('mobileHistoryAndFunctions')}
              </Button>
            ) : null}
            <strong>
              {(() => {
                const entry = functions.find((f) => f.value === mode)
                return entry ? t(entry.labelKey) : mode
              })()}
            </strong>
            {chat && session ? (
              <span
                className={styles.headerSessionTitle}
                title={session.title || t('untitledChat')}
              >
                {session.title || t('untitledChat')}
              </span>
            ) : null}
            <span className={styles.headerModel}>
              {mode === 'search' ? 'deepseek-flash' : settings.model}
            </span>
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
          <div className={styles.searchContent} hidden={mode !== 'search'}>
            <SearchStudio />
          </div>
          <div className={styles.searchContent} hidden={!app}>
            <AppsStudio />
          </div>
        </main>
        {chat ? <SearchPanel /> : null}
      </div>
      <SettingsDialog />
      <Toast />
    </>
  )
}
