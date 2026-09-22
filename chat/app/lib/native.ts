/**
 * The Android shell (Sasonica Next, com.sasonica.next — chat/android). Every
 * native call goes through here, and each one is a no-op on the web, so
 * nothing else needs to ask where it is running.
 *
 * - SecureStore: secrets sealed under an Android Keystore key
 *   (SecureStorePlugin.java). Used by api/auth.ts for the device token.
 * - OutputSwitcher: Android's media output picker (OutputSwitcherPlugin.java).
 * - Assist: the phone's assistant button (AssistPlugin.java) — opens a new
 *   chat that listens at once (components/NativeHooks.tsx).
 * - SpeechInput: dictation through the platform recogniser
 *   (SpeechInputPlugin.java), for the composer's mic key.
 * - Local notifications for replies elsewhere while the app is in the
 *   background (lib/arrivals.ts calls notifyArrival()). Delivered only while
 *   the WebView is still running JS: see README "Android shell" for what true
 *   background delivery would need.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

export const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

// ── Secure storage ────────────────────────────────────────────────────────

interface SecureStorePlugin {
  get(o: { key: string }): Promise<{ value: string | null }>
  set(o: { key: string; value: string }): Promise<void>
  remove(o: { key: string }): Promise<void>
}
export const SecureStore = registerPlugin<SecureStorePlugin>('SecureStore')

// ── The output picker ─────────────────────────────────────────────────────

interface OutputSwitcherPlugin {
  open(): Promise<{ shown: 'system' | 'bluetooth' }>
}
const OutputSwitcher = registerPlugin<OutputSwitcherPlugin>('OutputSwitcher')

export async function openOutputSwitcher(): Promise<void> {
  if (!isNative()) return
  try {
    await OutputSwitcher.open()
  } catch {
    // No picker on this device; nothing to show.
  }
}

// ── The assistant button ──────────────────────────────────────────────────

interface AssistPlugin {
  addListener(event: 'assist', fn: (e: { at: number }) => void): Promise<{ remove: () => Promise<void> }>
}
const Assist = registerPlugin<AssistPlugin>('Assist')

/** The phone's assistant button was pressed (retained across a cold start). Returns the unsubscribe. */
export function onAssist(fn: () => void): () => void {
  if (!isNative()) return () => {}
  let remove: (() => void) | null = null
  let gone = false
  Assist.addListener('assist', () => fn())
    .then((h) => {
      if (gone) void h.remove()
      else remove = () => void h.remove()
    })
    .catch(() => {})
  return () => {
    gone = true
    remove?.()
  }
}

// ── Dictation ─────────────────────────────────────────────────────────────

interface SpeechInputPlugin {
  available(): Promise<{ available: boolean }>
  listen(o: { prompt: string }): Promise<{ text: string }>
}
const SpeechInput = registerPlugin<SpeechInputPlugin>('SpeechInput')

let canDictateP: Promise<boolean> | null = null
/** Whether the phone has a speech recogniser (asked once). Never on the web. */
export function canDictate(): Promise<boolean> {
  return (canDictateP ??= isNative()
    ? SpeechInput.available()
        .then((r) => !!r.available)
        .catch(() => false)
    : Promise.resolve(false))
}

/** Listen once; the words heard, or '' (cancelled, silence, no recogniser). */
export async function dictate(prompt: string): Promise<string> {
  if (!isNative()) return ''
  try {
    return (await SpeechInput.listen({ prompt })).text.trim()
  } catch {
    return ''
  }
}

// ── Notifications ─────────────────────────────────────────────────────────

const CH_REPLY = 'replies'
const CH_URGENT = 'needs-you'

/** The app is behind another (Capacitor fires `pause`/`resume` on document). */
let backgrounded = false
if (typeof document !== 'undefined') {
  document.addEventListener('pause', () => (backgrounded = true))
  document.addEventListener('resume', () => (backgrounded = false))
}
export const inBackground = () =>
  backgrounded || (typeof document !== 'undefined' && document.visibilityState === 'hidden')

let channelsMade: Promise<void> | null = null
function channels(): Promise<void> {
  return (channelsMade ??= (async () => {
    try {
      await LocalNotifications.createChannel({ id: CH_REPLY, name: 'Replies', description: 'A reply finished in a thread', importance: 3, visibility: 1 })
      await LocalNotifications.createChannel({ id: CH_URGENT, name: 'Needs you', description: 'A question or permission prompt is waiting', importance: 5, visibility: 1, vibration: true })
    } catch {
      // Older Android without channels, or the plugin missing: fine.
    }
  })())
}

/** One notification per session: a newer one replaces it. */
function idFor(session: string): number {
  let h = 0
  for (let i = 0; i < session.length; i++) h = (h * 31 + session.charCodeAt(i)) | 0
  return (h & 0x7fffffff) || 1
}

let asked = false
/** Ask once per run, when there is something to be told about (paired). */
export async function askNotificationPermission(): Promise<void> {
  if (!isNative() || asked) return
  asked = true
  try {
    const p = await LocalNotifications.checkPermissions()
    if (p.display === 'prompt' || p.display === 'prompt-with-rationale') await LocalNotifications.requestPermissions()
  } catch {
    // Not available.
  }
}

/** "New reply · <title>" / "Needs you · <title>", from arrivals.arrive(). */
export async function notifyArrival(session: string, title: string, label: string, urgent: boolean): Promise<void> {
  if (!isNative() || !inBackground()) return
  try {
    await channels()
    await LocalNotifications.schedule({
      notifications: [
        {
          id: idFor(session),
          title: `${label} · ${title || session.slice(0, 8)}`,
          body: urgent ? 'Waiting for you in Sasonica' : 'Tap to open the thread',
          channelId: urgent ? CH_URGENT : CH_REPLY,
          smallIcon: 'ic_notification',
          iconColor: '#7FD1AE',
          autoCancel: true,
          extra: { session }
        }
      ]
    })
  } catch {
    // Permission refused or the plugin missing: the in-app notice still shows.
  }
}

/** The thread was read here: its notification has done its job. */
export function clearArrival(session: string): void {
  if (!isNative()) return
  LocalNotifications.cancel({ notifications: [{ id: idFor(session) }] }).catch(() => {})
}

/** A tap on a notification: open that thread. Returns the unsubscribe. */
export function onNotificationTap(open: (session: string) => void): () => void {
  if (!isNative()) return () => {}
  let remove: (() => void) | null = null
  let gone = false
  LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    const s = e.notification?.extra?.session
    if (typeof s === 'string' && s) open(s)
  })
    .then((h) => {
      if (gone) void h.remove()
      else remove = () => void h.remove()
    })
    .catch(() => {})
  return () => {
    gone = true
    remove?.()
  }
}

// The About page's questions (chat-prototype): in the shell, and its version.
type AppInfo = { version?: string; build?: string }
type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: { App?: { getInfo?: () => Promise<AppInfo> } }
}

function cap(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
}

/** True inside the Android shell. */
export function isNativeShell(): boolean {
  try {
    return !!cap()?.isNativePlatform?.()
  } catch {
    return false
  }
}

/**
 * The shell's own version ("1.2.0 (12)"), when its App plugin is there to
 * ask; null in a browser or when it is not.
 */
export async function nativeVersion(): Promise<string | null> {
  if (!isNativeShell()) return null
  try {
    const info = await cap()?.Plugins?.App?.getInfo?.()
    if (!info?.version) return null
    return info.build && info.build !== info.version ? `${info.version} (${info.build})` : info.version
  } catch {
    return null
  }
}
