/**
 * What the Android shell needs from the app's life, rendered once in root:
 * a tap on a "New reply" notification opens that thread, the phone's
 * assistant button listens at once — into the thread on screen, else in a
 * new chat — and once paired
 * the app asks (once) to be allowed to post notifications, then starts the
 * background notifier (lib/native.ts syncBackgroundNotify). Nothing on the web.
 */
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { hasCredential, serverBase } from '../api/auth'
import { askNotificationPermission, isNative, onAssist, onNotificationTap, syncBackgroundNotify } from '../lib/native'

/** A press this soon after one that listened into a thread opens a new chat instead. */
const AGAIN_MS = 20_000

export function NativeHooks() {
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => onNotificationTap((session) => navigate(`/t/${encodeURIComponent(session)}`)), [navigate])
  // The assistant button. With a thread on screen (the app was showing, not
  // just left there), it listens into that thread: the same path with a
  // fresh `assist` stamp, which routes/thread.tsx hands to the composer.
  // Otherwise /new with the stamp (routes/new.tsx listens on each new one),
  // replacing when already there so two presses do not stack two empty new
  // chats. A second press soon after one that went into a thread means "no,
  // a new chat". Not before pairing: there is nowhere to send the words.
  const here = useRef(location)
  here.current = location
  const lastIntoThread = useRef(0)
  useEffect(
    () =>
      onAssist((shown) => {
        if (!hasCredential()) return
        const at = Date.now()
        const loc = here.current
        const again = at - lastIntoThread.current < AGAIN_MS
        lastIntoThread.current = 0
        if (shown && !again && loc.pathname.startsWith('/t/')) {
          lastIntoThread.current = at
          const state = { ...((loc.state as object | null) || {}), assist: at }
          navigate(loc.pathname + loc.search, { replace: true, state })
          return
        }
        navigate('/new', { replace: loc.pathname === '/new', state: { assist: at } })
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
