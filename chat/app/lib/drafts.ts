/**
 * What is typed in a composer and not sent yet — per thread, kept here at
 * once (localStorage) and on the server (§6.2 `/draft`), so it survives
 * switching threads, the tab being backgrounded or killed, a reload, and
 * shows up on another device.
 *
 * Keys are sessions; the new-chat screen, which has no session yet, uses
 * NEW_CHAT and stays on this device only.
 *
 * `at` is the writer's clock in epoch seconds (the server stores it as
 * given). An emptied draft is kept as a tombstone `{text: '', at}` rather
 * than removed, so an older copy elsewhere (the server, when the delete
 * could not be sent) never wins over the deletion.
 *
 * Every storage access is in try/catch: private mode or blocked site data
 * just means no local copy.
 */
import { getDraft, postDraft } from '../api'

export const NEW_CHAT = '(new chat)'
const PREFIX = 'sasonica.chat.draft.'

export interface Draft {
  text: string
  /** Epoch seconds, the writer's clock; 0 = never written. */
  at: number
}

const nowS = () => Date.now() / 1000

export function readDraft(key: string): Draft {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (!raw) return { text: '', at: 0 }
    const d = JSON.parse(raw) as Draft
    return { text: typeof d.text === 'string' ? d.text : '', at: Number(d.at) || 0 }
  } catch {
    return { text: '', at: 0 }
  }
}

export function writeDraft(key: string, text: string, at = nowS()) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ text, at }))
  } catch {
    // Not kept on this device; the server copy still goes.
  }
}

/** For the thread list's "Draft" marker. */
export function hasDraft(key: string): boolean {
  return !!readDraft(key).text.trim()
}

const isSession = (key: string) => !!key && key !== NEW_CHAT

/** The local `at` last handed to the server, per session: nothing to push when it matches. */
const posted = new Map<string, number>()

/**
 * Send this device's copy to the server if it has not been sent yet.
 * `keepalive` for the flushes that race the page going away (hidden,
 * pagehide, leaving the thread): the request outlives the page. A failure
 * leaves it unsent, so the next change or flush tries again.
 */
export async function pushDraft(key: string, keepalive = false) {
  if (!isSession(key)) return
  const d = readDraft(key)
  if (!d.at || posted.get(key) === d.at) return
  posted.set(key, d.at)
  try {
    await postDraft(key, d.text, d.at, { keepalive })
  } catch {
    if (posted.get(key) === d.at) posted.delete(key)
  }
}

/**
 * On opening a thread: ask the server for its copy and settle which wins —
 * the newer `at`. Returns the server's text when it should replace what the
 * composer shows (the caller decides whether the person has typed since
 * open), else null. A local copy newer than the server's is pushed.
 */
export async function reconcileDraft(key: string, signal?: AbortSignal): Promise<Draft | null> {
  if (!isSession(key)) return null
  const local = readDraft(key)
  let server: Draft
  try {
    const res = await getDraft(key, signal)
    server = { text: String(res.text || ''), at: Number(res.at) || 0 }
  } catch {
    // Offline or refused: the local copy stands, and is pushed on the next change.
    return null
  }
  if (server.text === local.text) {
    if (local.at) posted.set(key, local.at)
    return null
  }
  if (server.at > local.at) return server
  if (local.at) {
    // The server holds something else now, whatever was sent before.
    posted.delete(key)
    void pushDraft(key)
  }
  return null
}

/** Take the server's copy as this device's (it is on the server already). */
export function adoptDraft(key: string, d: Draft) {
  writeDraft(key, d.text, d.at)
  posted.set(key, d.at)
}

/**
 * A send succeeded: clear the draft, here and on the server — but only if it
 * still holds the words that were sent. Anything typed since (while the send
 * was out) is a new draft and stays.
 */
export function draftSent(key: string, text: string) {
  const d = readDraft(key)
  if (d.text.trim() && d.text.trim() !== text.trim()) return
  writeDraft(key, '')
  void pushDraft(key)
}
