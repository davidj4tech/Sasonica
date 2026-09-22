/**
 * What the Android shell needs from the app's life, rendered once in root:
 * a tap on a "New reply" notification opens that thread, the phone's
 * assistant button opens a new chat that listens at once, and once paired
 * the app asks (once) to be allowed to post notifications, then starts the
 * background notifier (lib/native.ts syncBackgroundNotify). Nothing on the web.
 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { hasCredential, serverBase } from '../api/auth'
import { askNotificationPermission, isNative, onAssist, onNotificationTap, syncBackgroundNotify } from '../lib/native'

export function NativeHooks() {
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => onNotificationTap((session) => navigate(`/t/${encodeURIComponent(session)}`)), [navigate])
  // The assistant button: /new with a fresh `assist` stamp (routes/new.tsx
  // listens on each new one). Replace when already there, so pressing it
  // twice does not stack two empty new chats. Not before pairing: there is
  // nowhere to send the words.
  useEffect(
    () =>
      onAssist(() => {
        if (!hasCredential()) return
        navigate('/new', { replace: window.location.pathname === '/new', state: { assist: Date.now() } })
      }),
    [navigate]
  )
  // Then the background service (NotifyService): on by default once the
  // permission is there, so it is told after the question is answered — and
  // again whenever the page changes, which is cheap and covers a pairing
  // just made or undone (the service re-reads the credentials each time).
  useEffect(() => {
    if (!isNative() || location.pathname === '/pairing') return
    if (!hasCredential()) {
      void syncBackgroundNotify(serverBase())
      return
    }
    void askNotificationPermission().then(() => syncBackgroundNotify(serverBase()))
  }, [location.pathname])
  return null
}
