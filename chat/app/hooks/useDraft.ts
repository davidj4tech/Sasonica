/**
 * Keeps one composer's text as a draft (lib/drafts.ts). Used inside the
 * thread's AssistantRuntimeProvider (it reads and sets the composer).
 *
 * - Opening: the local copy goes into the box at once; then the server's
 *   copy is asked for and the newer `at` wins. A newer server copy replaces
 *   the box only if nothing was typed since open; otherwise what was typed
 *   stays and is pushed.
 * - Every change is saved locally at once and pushed to the server 800 ms
 *   after typing stops, and at once when the tab is hidden, the page goes
 *   away, or the thread is left (keepalive: the request outlives the page).
 * - A send empties the box, and that is saved like any edit (the runtime
 *   calls onNew a beat after it empties the box, so it cannot be told apart
 *   in time). A failed send then writes the words back: `keep` as the draft
 *   only (the failed bubble shows them), `restore` into the box as well.
 *   The page clears the draft when the send succeeds (draftSent).
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { adoptDraft, pushDraft, readDraft, reconcileDraft, writeDraft } from '../lib/drafts'

const PUSH_AFTER_MS = 800

export interface DraftHandle {
  /** A send failed and its bubble holds the words: keep them as the draft (not in the box), unless something new was typed. */
  keep(text: string): void
  /** A send failed where nothing else holds the words: back into the box, if it is still empty. */
  restore(text: string): void
  /** Put `text` in the box where the caret was (the end when it never had one), spaced from its neighbours. */
  insert(text: string): void
}

export function useDraft(key: string | undefined, ref: Ref<DraftHandle>) {
  const aui = useAui()
  const text = useAuiState((s) => s.composer.text)
  /** The last text seen or set by us; null until the draft has been loaded. */
  const seenRef = useRef<string | null>(null)
  const typedRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  /** Text we set that the composer's state has not shown yet (it lands a render later). */
  const landingRef = useRef<string | null>(null)
  const apply = (t: string) => {
    seenRef.current = t
    landingRef.current = t
    aui.composer().setText(t)
  }

  useImperativeHandle(
    ref,
    () => ({
      keep(t) {
        if (!key || aui.composer().getState().text.trim()) return
        writeDraft(key, t)
        void pushDraft(key)
      },
      restore(t) {
        if (!key || aui.composer().getState().text.trim()) return
        writeDraft(key, t)
        apply(t)
        void pushDraft(key)
      },
      insert(t) {
        // A textarea keeps its selection after it loses focus, so the caret
        // from before a menu was opened is still there to read.
        const ta = document.querySelector<HTMLTextAreaElement>('.composer textarea')
        const now = aui.composer().getState().text
        const at = ta && document.body.contains(ta) ? Math.min(ta.selectionStart ?? now.length, now.length) : now.length
        const before = now.slice(0, at)
        const after = now.slice(at)
        const lead = before && !/\s$/.test(before) ? ' ' : ''
        const tail = /^\s/.test(after) ? '' : ' '
        const next = before + lead + t + tail + after
        apply(next)
        if (key) {
          writeDraft(key, next)
          void pushDraft(key)
        }
        const caret = (before + lead + t + tail).length
        window.requestAnimationFrame(() => {
          const box = document.querySelector<HTMLTextAreaElement>('.composer textarea')
          if (!box) return
          box.focus()
          box.setSelectionRange(caret, caret)
        })
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, aui]
  )

  // Open: local at once, then the server's if newer.
  useEffect(() => {
    if (!key) return
    typedRef.current = false
    const local = readDraft(key).text
    if (local) apply(local)
    else seenRef.current = aui.composer().getState().text
    const ctl = new AbortController()
    void reconcileDraft(key, ctl.signal).then((server) => {
      if (!server || ctl.signal.aborted) return
      if (typedRef.current) {
        // Typed since open: what is in the box is newer to the person.
        void pushDraft(key)
        return
      }
      adoptDraft(key, server)
      apply(server.text)
    })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Every change: here at once, the server after a pause. `text` is only
  // the trigger; the composer's own state is read. A set of ours lands a
  // render later, and the text read before it lands is not an edit.
  useEffect(() => {
    if (!key || seenRef.current === null) return
    const now = aui.composer().getState().text
    if (landingRef.current !== null) {
      // Until our own set shows, what is read is the text from before it.
      if (now === landingRef.current) landingRef.current = null
      return
    }
    if (now === seenRef.current) return
    seenRef.current = now
    typedRef.current = true
    writeDraft(key, now)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void pushDraft(key)
    }, PUSH_AFTER_MS)
  }, [key, text, aui])

  // Flush now: hidden, page going away, thread left.
  useEffect(() => {
    if (!key) return
    const flush = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
      void pushDraft(key, true)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [key])
}
