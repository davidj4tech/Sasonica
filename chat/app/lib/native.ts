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
 *   the WebView is still running JS.
 * - BackgroundNotify: true background delivery (NotifyService.java) — a
 *   foreground service holding one GET /sessions/events stream (§6.13) while
 *   the app is closed. While it runs it owns the system notifications, and
 *   notifyArrival() stands aside. Settings has its toggle.
 * - Speech: replies played by this app (speech/SpeechService.java) — a
 *   Media3 player behind the mpv socket agent-media already drives, on its
 *   own port while the old Sasonica app still has 6613. Settings has its
 *   toggle; it is off until turned on.
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

/** Another assistant on the phone the words can be handed to (AssistPlugin.java targets()). */
export interface HandOffTarget {
  id: string
  label: string
  share: string
}

interface AssistPlugin {
  addListener(event: 'assist', fn: (e: { at: number; shown?: boolean }) => void): Promise<{ remove: () => Promise<void> }>
  targets(): Promise<{ targets: HandOffTarget[] }>
  handOff(o: { id: string; share: string; text: string }): Promise<void>
}
const Assist = registerPlugin<AssistPlugin>('Assist')

/**
 * The phone's assistant button was pressed (retained across a cold start).
 * `shown`: the app was on screen at the press. Returns the unsubscribe.
 */
export function onAssist(fn: (shown: boolean) => void): () => void {
  if (!isNative()) return () => {}
  let remove: (() => void) | null = null
  let gone = false
  Assist.addListener('assist', (e) => fn(e?.shown === true))
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

let targetsP: Promise<HandOffTarget[]> | null = null
/** The other assistants that take shared text (asked once a page load). Never on the web. */
export function handOffTargets(): Promise<HandOffTarget[]> {
  if (!isNative()) return Promise.resolve([])
  targetsP ??= Assist.targets()
    .then((r) => r.targets || [])
    .catch(() => [])
  return targetsP
}

/** Share the words to another assistant; with none, open it as its assistant. */
export async function handOff(t: HandOffTarget, text: string): Promise<void> {
  await Assist.handOff({ id: t.id, share: t.share, text })
}

// ── Shared to the app ─────────────────────────────────────────────────────

/** A file another app shared, copied into the app's cache (ShareInPlugin.java). */
export interface SharedFile {
  path: string
  name: string
  mime: string
  size: number
}

/** What arrived from the share sheet. `failed`: files that could not be read. */
export interface SharedIn {
  at: number
  text: string
  subject: string
  files: SharedFile[]
  failed: number
}

interface ShareInPlugin {
  addListener(event: 'share', fn: (e: SharedIn) => void): Promise<{ remove: () => Promise<void> }>
  upload(o: { path: string; url: string; headers: Record<string, string> }): Promise<{ status: number; body: string }>
  clear(): Promise<void>
}
const ShareIn = registerPlugin<ShareInPlugin>('ShareIn')

/** Something was shared to the app (retained across a cold start). Returns the unsubscribe. */
export function onShare(fn: (s: SharedIn) => void): () => void {
  if (!isNative()) return () => {}
  let remove: (() => void) | null = null
  let gone = false
  ShareIn.addListener('share', (e) => fn({ ...e, files: e.files || [], failed: e.failed || 0 }))
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

/** Stream a shared file to `url` (the server's /upload) from native code; the answer's status and text. */
export function uploadShared(path: string, url: string, headers: Record<string, string>) {
  return ShareIn.upload({ path, url, headers })
}

/** Drop the copies of shared files once they are sent or let go. */
export async function clearShared(): Promise<void> {
  if (!isNative()) return
  try {
    await ShareIn.clear()
  } catch {
    // Left in the cache, which Android empties when it needs the room.
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
  // The background service posts these itself (the same words, per thread).
  if (!isNative() || !inBackground() || backgroundNotifying) return
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
  BackgroundNotify.clear({ session }).catch(() => {})
}

/** A tap on a notification (the app's own, or the background service's): open that thread. Returns the unsubscribe. */
export function onNotificationTap(open: (session: string) => void): () => void {
  if (!isNative()) return () => {}
  const removers: (() => void)[] = []
  let gone = false
  const keep = (p: Promise<{ remove: () => Promise<void> }>) =>
    p
      .then((h) => {
        if (gone) void h.remove()
        else removers.push(() => void h.remove())
      })
      .catch(() => {})
  keep(
    LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
      const s = e.notification?.extra?.session
      if (typeof s === 'string' && s) open(s)
    })
  )
  keep(
    BackgroundNotify.addListener('open', (e) => {
      if (typeof e?.session === 'string' && e.session) open(e.session)
    })
  )
  return () => {
    gone = true
    removers.forEach((r) => r())
  }
}

// ── Background notifications (NotifyService.java) ─────────────────────────

export interface BackgroundNotifyStatus {
  /** The Settings toggle: on unless turned off. */
  enabled: boolean
  /** Whether the toggle was ever touched (else it is on by default). */
  decided: boolean
  /** Android lets the app post notifications. */
  permitted: boolean
  /** The service is up. */
  running: boolean
  /** What its persistent notification says ("" when not running). */
  state: string
}

interface BackgroundNotifyPlugin {
  status(): Promise<BackgroundNotifyStatus>
  setEnabled(o: { enabled: boolean }): Promise<BackgroundNotifyStatus>
  sync(o: { base: string }): Promise<BackgroundNotifyStatus>
  clear(o: { session: string }): Promise<void>
  addListener(event: 'open', fn: (e: { session: string }) => void): Promise<{ remove: () => Promise<void> }>
}
const BackgroundNotify = registerPlugin<BackgroundNotifyPlugin>('BackgroundNotify')

/** The service is on (so notifyArrival stands aside). */
let backgroundNotifying = false
const noted = (s: BackgroundNotifyStatus) => {
  backgroundNotifying = !!(s.enabled && s.permitted)
  return s
}

/** Where background notifications stand; null on the web or an older shell. */
export async function backgroundNotifyStatus(): Promise<BackgroundNotifyStatus | null> {
  if (!isNative()) return null
  try {
    return noted(await BackgroundNotify.status())
  } catch {
    return null
  }
}

/** The Settings toggle. */
export async function setBackgroundNotify(enabled: boolean): Promise<BackgroundNotifyStatus | null> {
  if (!isNative()) return null
  try {
    return noted(await BackgroundNotify.setEnabled({ enabled }))
  } catch {
    return null
  }
}

/**
 * Tell the service where the server is and that the credentials may have
 * changed (paired, unpaired, permission just granted): it starts, retries
 * or stops to match. Cheap; call it after any of those.
 */
export async function syncBackgroundNotify(base: string): Promise<BackgroundNotifyStatus | null> {
  if (!isNative()) return null
  try {
    return noted(await BackgroundNotify.sync({ base }))
  } catch {
    return null
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

// ── Speech in this app (speech/SpeechService.java) ────────────────────────

export interface SpeechStatus {
  /** The Settings toggle: off until turned on. */
  enabled: boolean
  /** The service is up. */
  running: boolean
  /** Where it listens ("100.x.y.z:6614"), or "" when it is not up yet. */
  listening: string
  /** A reply is playing here now. */
  speaking: boolean
  /** One line on what the holds are doing (dictation, a voice session, a call). */
  holding: string
  /** The microphone watch is alive. False means nothing will ever hold. */
  watchingMic: boolean
  /** The port it takes; 6613 is the old Sasonica app's. */
  port: number
}

interface SpeechPlugin {
  status(): Promise<SpeechStatus>
  setEnabled(o: { enabled: boolean }): Promise<SpeechStatus>
}
const Speech = registerPlugin<SpeechPlugin>('Speech')

/** Where speech-in-this-app stands; null on the web or an older shell. */
export async function speechStatus(): Promise<SpeechStatus | null> {
  if (!isNative()) return null
  try {
    return await Speech.status()
  } catch {
    return null
  }
}

/** The Settings toggle. Starts or stops the player at once. */
export async function setSpeechHere(enabled: boolean): Promise<SpeechStatus | null> {
  if (!isNative()) return null
  try {
    return await Speech.setEnabled({ enabled })
  } catch {
    return null
  }
}
