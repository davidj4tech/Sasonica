/**
 * Dictation into a thread's composer (the mic key), and the assistant
 * button's hands-free send.
 *
 * - The mic key listens once (lib/native.ts dictate(): the platform
 *   recogniser's own screen) and puts the words in the box, after anything
 *   already there. Nothing is sent: the send key or Ctrl+Enter does that.
 * - `listenNow` changing (the assistant button, via routes/new.tsx or
 *   routes/thread.tsx) listens
 *   at once, and the words then wait AUTO_SEND_S seconds before they send
 *   themselves, as in the old app: a button pressed to say something should
 *   not then need a tap, but the recogniser gets words wrong, and a message
 *   that has gone cannot be fixed. A tap on the box or any edit stops the
 *   countdown and leaves the words to edit; the send key sends at once.
 *   If a draft was already in the box there is no countdown: the words join
 *   it and wait for a send.
 *
 * - After the assistant button's listen, `offer` is up for OFFER_S seconds
 *   (and while the countdown runs): the chips that take the words somewhere
 *   else — a new chat, another assistant (components/Thread.tsx). `take()`
 *   stops the countdown and lifts the words out of the box. An edit or a
 *   send ends the offer.
 * - `carry` changing puts words in the box as if just dictated, countdown
 *   and all: the words a "New chat instead" chip brought along.
 *
 * Only in the Android shell with a recogniser (`can`); the web has no key.
 */
import type { AssistantRuntime } from '@assistant-ui/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { canDictate, dictate } from '../lib/native'

const AUTO_SEND_S = 3
const OFFER_S = 8
/** A press older than this is history's, not the button's. */
const STALE_MS = 15_000

export interface Dictation {
  /** A recogniser is there: show the mic key. */
  can: boolean
  listening: boolean
  /** Seconds left before the dictated words send themselves; 0 = no countdown. */
  sendIn: number
  /** The mic key. */
  listen: () => void
  /** A tap on the box: stop the countdown, keep the words. */
  hold: () => void
  /** The assistant button just listened: offer to take the words elsewhere. */
  offer: boolean
  /** Stop the countdown, end the offer, and lift the words out of the box. */
  take: () => string
}

export interface Carry {
  text: string
  at: number
}

export function useDictation(
  runtime: AssistantRuntime,
  listenNow: number | undefined,
  prompt: string,
  carry?: Carry
): Dictation {
  const [can, setCan] = useState(false)
  const [listening, setListening] = useState(false)
  const [sendIn, setSendIn] = useState(0)
  const [offer, setOffer] = useState(false)
  const busy = useRef(false)
  /** The text dictation put in the box; any other text means it was edited. */
  const placed = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    void canDictate().then((ok) => live && setCan(ok))
    return () => {
      live = false
    }
  }, [])

  /** Put words in the box after any draft; a countdown only when the box was empty. */
  const place = useCallback(
    (words: string, autoSend: boolean) => {
      const composer = runtime.thread.composer
      const had = composer.getState().text
      const text = had.trim() ? `${had.trimEnd()} ${words}` : words
      placed.current = text
      composer.setText(text)
      // Never send a draft that was waiting in the box along with the words.
      if (autoSend && !had.trim()) setSendIn(AUTO_SEND_S)
    },
    [runtime]
  )

  const run = useCallback(
    async (autoSend: boolean) => {
      if (busy.current) return
      busy.current = true
      setSendIn(0)
      setListening(true)
      const heard = await dictate(prompt)
      busy.current = false
      setListening(false)
      if (heard) place(heard, autoSend)
      else placed.current = runtime.thread.composer.getState().text
      if (autoSend) setOffer(true)
    },
    [runtime, prompt, place]
  )

  // Words carried over from another thread: once per stamp.
  const carried = useRef(0)
  useEffect(() => {
    if (!carry?.text || carried.current === carry.at) return
    carried.current = carry.at
    place(carry.text, true)
  }, [carry, place])

  // The offer: OFFER_S seconds, longer while the countdown runs; an edit or a send ends it.
  useEffect(() => {
    if (!offer) return
    const composer = runtime.thread.composer
    const off = composer.subscribe(() => {
      if (placed.current !== null && composer.getState().text !== placed.current) setOffer(false)
    })
    const t = window.setTimeout(() => setOffer(false), OFFER_S * 1000)
    return () => {
      off()
      window.clearTimeout(t)
    }
  }, [offer, runtime])

  // The assistant button: once per new value, and only once a recogniser is known.
  const seen = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!listenNow || !can || seen.current === listenNow) return
    // A stamp left in history: coming Back to the page is not a press.
    if (Date.now() - listenNow > STALE_MS) return
    seen.current = listenNow
    void run(true)
  }, [listenNow, can, run])

  // The countdown, and what stops it: an edit, a send, or the box emptied.
  useEffect(() => {
    if (!sendIn) return
    const composer = runtime.thread.composer
    const off = composer.subscribe(() => {
      if (composer.getState().text !== placed.current) setSendIn(0)
    })
    const t = window.setTimeout(() => {
      if (sendIn > 1) return setSendIn(sendIn - 1)
      setSendIn(0)
      if (composer.getState().text.trim()) composer.send()
    }, 1000)
    return () => {
      off()
      window.clearTimeout(t)
    }
  }, [sendIn, runtime])

  const listen = useCallback(() => void run(false), [run])
  const hold = useCallback(() => setSendIn(0), [])
  const take = useCallback(() => {
    setSendIn(0)
    setOffer(false)
    const composer = runtime.thread.composer
    const text = composer.getState().text
    placed.current = null
    composer.setText('')
    return text
  }, [runtime])
  return { can, listening, sendIn, listen, hold, offer: offer || sendIn > 0, take }
}
