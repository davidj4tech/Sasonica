/**
 * One thread on assistant-ui's ExternalStoreRuntime (server-contract.md §14).
 *
 * The state lives in the page (the thread's stream, hooks/useThread.ts); the
 * runtime reads it through `convertItem` and calls back:
 *   messages  ← §6.2.2 messages (+ an approval, + optimistic sends)
 *   isRunning ← state "working", the last message's turn.running, `working`,
 *               a derived pending, or a send not yet answered
 *   onNew     → the page's `send` (/reply, or /ask for a new thread)
 *   onCancel  → STUB: POST /session/stop is v1 (§12)
 *   suggestions ← `suggestion`
 *
 * A queue adapter keeps the composer usable while a turn runs: the harness
 * takes typed input mid-turn, so a message sent then goes straight to the
 * server, as the Nuxt reply box does. Nothing is held client-side.
 */
import { useNavigate } from 'react-router'
import { AutoGrowTextarea } from './AutoGrow'
import { MentionPicker } from './MentionPicker'
import { AttachButton } from './AttachButton'
import { Sheet } from './SessionSheets'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type AppendMessage,
  type ExternalThreadQueueAdapter,
  type ThreadSuggestion
} from '@assistant-ui/react'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Working } from '../api/types'
import { useBottomFirst } from '../hooks/useBottomFirst'
import { useDictation, type Carry } from '../hooks/useDictation'
import { handOff, handOffTargets, type HandOffTarget } from '../lib/native'
import { useDraft, type DraftHandle } from '../hooks/useDraft'
import { NEW_CHAT, readDraft, writeDraft } from '../lib/drafts'
import { useFollowAlong } from '../hooks/useFollowAlong'
import { useFollowOn } from '../lib/followOn'
import { lightTerms } from '../lib/highlight'
import { APPROVAL_TOOL, ASK_TOOL, convertItem, groupParts, type ChatItem } from '../lib/convert'
import {
  ApprovalToolUI,
  AskToolUI,
  CommandChip,
  LineText,
  MessageSpeechKey,
  OptimisticMark,
  PartGroup,
  PeerNote,
  Picture,
  PictureData,
  Reasoning,
  ThreadActionsContext,
  ToolStep,
  useCustom,
  WorkingIndicator,
  type ThreadActions
} from './parts'

/** "⌘+Enter" on Apple keyboards, "Ctrl+Enter" elsewhere. */
export const SEND_KEYS =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘+Enter' : 'Ctrl+Enter'

const partComponents = {
  Text: LineText,
  Reasoning,
  Image: Picture,
  data: { by_name: { picture: PictureData } },
  tools: {
    by_name: { [ASK_TOOL]: AskToolUI, [APPROVAL_TOOL]: ApprovalToolUI },
    Fallback: ToolStep
  },
  Group: PartGroup
}

function UserMessage() {
  const { peer } = useCustom()
  const id = useAuiState((s) => s.message.id)
  return (
    <MessagePrimitive.Root className={peer ? 'msg user peer' : 'msg user'} data-mid={id}>
      <PeerNote />
      <div className="bubble">
        <CommandChip />
        <MessagePrimitive.Unstable_PartsGrouped groupingFunction={groupParts} components={partComponents} />
        <OptimisticMark />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  const running = useAuiState((s) => s.message.status?.type === 'running')
  // While isRunning and the last line is the listener's, the runtime adds an
  // empty assistant placeholder. The WorkingIndicator is our in-progress
  // display (§14), so the placeholder draws nothing.
  const empty = useAuiState((s) => s.message.content.length === 0)
  const id = useAuiState((s) => s.message.id)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const tall = useTallBubble(bubbleRef, !empty)
  if (empty) return null
  return (
    <MessagePrimitive.Root className={running ? 'msg agent speaking' : 'msg agent'} data-mid={id}>
      <div className="bubble-row">
        <div className="bubble" ref={bubbleRef}>
          {/* Tool steps (and the reasoning between them) fold into "Worked ·
              N steps" blocks, mounted only when opened (lib/convert.ts
              groupParts, parts.tsx PartGroup). */}
          <MessagePrimitive.Unstable_PartsGrouped groupingFunction={groupParts} components={partComponents} />
        </div>
        {/* The play/pause key at the foot of a spoken reply, and — on a
            reply too tall to see whole — the same key at its top, so a long
            reply can be started or paused without scrolling to its end. Both
            read the same state, so they always agree. */}
        <div className="msg-keys">
          {tall && <MessageSpeechKey />}
          <MessageSpeechKey />
        </div>
      </div>
    </MessagePrimitive.Root>
  )
}

/** The composer's draft (hooks/useDraft.ts); needs the runtime's context, so it is a component. */
function DraftKeeper({ draftKey, handle }: { draftKey?: string; handle: React.Ref<DraftHandle> }) {
  useDraft(draftKey, handle)
  return null
}

/** Its children only while the box is empty, or while `unless` holds. */
function WhileEmpty({ unless, children }: { unless?: boolean; children: ReactNode }) {
  const empty = useAuiState((s) => !s.composer.text.trim())
  return empty || unless ? <>{children}</> : null
}

/** Further than this (in viewport heights) from an end, its pill shows. */
const AWAY_SCREENS = 0.75
/** The pills go this long after the reader's hand last moved the thread. */
const PILLS_IDLE_MS = 3000
const HAND_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

/**
 * Whether the view is well away from the top and from the bottom, for the
 * ↑ / ↓ pills — and only while the reader is moving through the thread by
 * hand (wheel, touch, paging keys) and for PILLS_IDLE_MS after: at the
 * right edge they sit where a reply's play key can be, so they must not
 * stay over it. Programmatic scrolls (follow-along) do not show them.
 * Read on scroll and every second (content grows without a scroll event);
 * only a change re-renders.
 */
function useAwayFromEnds(ref: React.RefObject<HTMLElement | null>) {
  const [away, setAway] = useState({ top: false, bottom: false })
  const [active, setActive] = useState(false)
  const idleRef = useRef(0)
  /** The reader moved the thread (or pressed a pill): show, and start the idle clock again. */
  const poke = useCallback(() => {
    setActive(true)
    window.clearTimeout(idleRef.current)
    idleRef.current = window.setTimeout(() => setActive(false), PILLS_IDLE_MS)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const hand = poke
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
      if (HAND_KEYS.has(e.key)) hand()
    }
    el.addEventListener('wheel', hand, { passive: true })
    el.addEventListener('touchmove', hand, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(idleRef.current)
      el.removeEventListener('wheel', hand)
      el.removeEventListener('touchmove', hand)
      window.removeEventListener('keydown', onKey)
    }
  }, [ref, poke])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const check = () => {
      raf = 0
      const far = el.clientHeight * AWAY_SCREENS
      const top = el.scrollTop > far
      const bottom = el.scrollHeight - el.clientHeight - el.scrollTop > far
      setAway((a) => (a.top === top && a.bottom === bottom ? a : { top, bottom }))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const id = window.setInterval(check, 1000)
    check()
    return () => {
      el.removeEventListener('scroll', onScroll)
      window.clearInterval(id)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [ref])
  return { ...(active ? away : { top: false, bottom: false }), poke }
}

/** Two keys need at least this much height to not sit on top of each other. */
const TWO_KEYS_PX = 2 * 44 + 32

/**
 * Whether a bubble gets a second key at its top: taller than two keys, and
 * taller than the visible band (the viewport less the sticky footer) — a
 * reply that fits on the screen has its foot key in view already. So in
 * landscape, where the band is short, more replies get one.
 */
function useTallBubble(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  const [tall, setTall] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!on || !el || typeof ResizeObserver === 'undefined') return
    const view = el.closest<HTMLElement>('.viewport')
    const check = () => {
      const footer = view?.querySelector<HTMLElement>('.footer')
      const band = (view?.clientHeight || window.innerHeight) - (footer?.offsetHeight || 0)
      setTall(el.offsetHeight > Math.max(TWO_KEYS_PX, band))
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (view) ro.observe(view)
    return () => ro.disconnect()
  }, [ref, on])
  return tall
}

function textOf(message: AppendMessage): string {
  return message.content
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('')
    .trim()
}

/** Double-press bookkeeping for stop (§12): a second press within 5 s means "silence". */
function useStop(onStop: (speech: 'auto' | 'silence') => void) {
  const lastRef = useRef(0)
  return useCallback(async () => {
    const now = Date.now()
    const speech = now - lastRef.current < 5000 ? 'silence' : 'auto'
    lastRef.current = now
    onStop(speech)
  }, [onStop])
}

/**
 * How many messages arrived below the live line since it went live — shown
 * as a hint instead of scrolling to them (the view is following the voice).
 * Resets with each new live line.
 */
function useNewBelow(items: ChatItem[], liveIndex: number, liveKey: string | null): number {
  const below = liveIndex >= 0 ? items.length - 1 - liveIndex : 0
  const [base, setBase] = useState<{ key: string | null; below: number }>({ key: liveKey, below })
  useEffect(() => {
    if (base.key !== liveKey) setBase({ key: liveKey, below })
  }, [liveKey, below, base.key])
  if (liveKey === null || base.key !== liveKey) return 0
  return Math.max(0, below - base.below)
}

export interface ThreadProps {
  items: ChatItem[]
  isRunning: boolean
  working: Working | null
  workingAt: number
  thinking: boolean
  suggestion: string
  /**
   * Send the words. Throw to put them back in the box (where nothing else
   * holds them); resolve `false` for a failure that keeps them elsewhere
   * (the failed bubble with Retry) — the draft is kept either way. The page
   * clears the draft on success (lib/drafts.ts draftSent).
   */
  onSend: (text: string) => Promise<void | boolean>
  /** Keep the composer's text as a draft under this key (a session, or NEW_CHAT). */
  draftKey?: string
  /** For the page: put text in the box at the caret (the ⋮ menu's Insert a thread…). */
  composerRef?: React.Ref<{ insert(text: string): void }>
  onStop: (speech: 'auto' | 'silence') => void
  actions: ThreadActions
  /** Shown above the composer: send status, errors. */
  status?: ReactNode
  /** Shown when there are no messages. */
  empty?: ReactNode
  placeholder?: string
  /** Disable the composer (e.g. no place picked yet). */
  disabled?: boolean
  /** Docked at the top of the footer, above the composer: the speech bar. */
  speechBar?: ReactNode
  /** On the reply box, just above it: what this send will do (the Stops/Keep reading chip). */
  composerChip?: ReactNode
  /**
   * A small New chat button above the send button: where it goes (a thread's
   * page passes '/new'). What is typed goes along, into the new chat's draft.
   */
  newChatTo?: string
  /**
   * The dialog the session is stopped on (David, 23 Sep 2026): docked above
   * the speech bar, where it stays in view until it is answered rather than
   * sitting at the foot of a reply taller than the screen. It scrolls when
   * it is taller than the room there is.
   */
  dock?: ReactNode
  /** Messages exist above the first one (§6.2 paging). */
  older?: boolean
  /** Fetch the page before the first message; resolves true when some came. */
  onLoadEarlier?: () => Promise<boolean>
  earlierLoading?: boolean
  earlierError?: string
  /** No composer: a subagent's thread (§6.12) is read, never written to. */
  readOnly?: boolean
  /** A search hit (§6.14): scroll to this message and light these words, once it is on screen. */
  jumpTo?: { id: string; terms: string[] } | null
  /**
   * "Follow along" was pressed: re-read where the voice actually is, as
   * well as putting the bold sentence back on screen (routes/thread.tsx
   * useElapsedSkew resync). The pill is the one place a reader says "this
   * is not where you are" — a drifted bold is what sends them scrolling in
   * the first place.
   */
  onResync?: () => void
  /** A new value listens at once and sends the words after a countdown (the assistant button; hooks/useDictation.ts). */
  listenNow?: number
  /** Words brought from another thread's "New chat instead": placed with the countdown. */
  carry?: Carry
  /** After the assistant button: a "New chat instead" chip, which takes the words there. */
  onNewChatInstead?: (text: string) => void
  /** The other assistants' chips all the time, not only after the button (a new chat). */
  handOffAlways?: boolean
}

/** How long a jump waits for its message to be drawn before giving up. */
const JUMP_WAIT_MS = 8000
/** How long after landing the jump holds its place against the opening scroll. */
const JUMP_HOLD_MS = 1500

/**
 * Take the view to `jumpTo`'s message and flash it (search, §6.14). The
 * thread opens at its foot (useBottomFirst, then assistant-ui's own scroll
 * to the bottom), so once the message is in the DOM it is put in the middle
 * of the view and held there for JUMP_HOLD_MS — unless a hand scrolls first.
 */
function useJump(viewportRef: React.RefObject<HTMLDivElement | null>, jumpTo: ThreadProps['jumpTo']) {
  const id = jumpTo?.id || ''
  const termsKey = (jumpTo?.terms || []).join('\u0000')
  useEffect(() => {
    if (!id) return
    const terms = termsKey ? termsKey.split('\u0000') : []
    let stopped = false
    let clearLight = () => {}
    const started = Date.now()
    let landed = 0
    let raf = 0
    let flashT = 0
    const stop = () => {
      stopped = true
    }
    const vp = viewportRef.current
    const onHand = () => {
      if (landed) stop()
    }
    vp?.addEventListener('wheel', onHand, { passive: true })
    vp?.addEventListener('touchmove', onHand, { passive: true })
    const find = () => viewportRef.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`) || null
    const tick = () => {
      if (stopped) return
      const el = find()
      const now = Date.now()
      if (!el) {
        if (now - started < JUMP_WAIT_MS) raf = requestAnimationFrame(tick)
        return
      }
      const view = viewportRef.current
      if (view) {
        // Its top, in the viewport's scroll coordinates; centred when it
        // fits, its top just below the view's top when it does not.
        const r = el.getBoundingClientRect()
        const at = view.scrollTop + r.top - view.getBoundingClientRect().top
        const want = Math.max(0, at - Math.max(8, (view.clientHeight - r.height) / 2))
        if (Math.abs(view.scrollTop - want) > 2) view.scrollTop = want
      }
      if (!landed) {
        landed = now
        el.classList.add('jump-hit')
        flashT = window.setTimeout(() => el.classList.remove('jump-hit'), 2600)
        clearLight = lightTerms(el, terms, 5000)
      }
      if (now - landed < JUMP_HOLD_MS) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      window.clearTimeout(flashT)
      clearLight()
      vp?.removeEventListener('wheel', onHand)
      vp?.removeEventListener('touchmove', onHand)
    }
  }, [id, termsKey, viewportRef])
}

/** How long the reader's place is held while an older page is added above. */
const PREPEND_HOLD_MS = 1200

/**
 * Keep the view where the reader has it while content is added ABOVE them
 * (an older page): pinned by its distance from the bottom, through every
 * DOM change for PREPEND_HOLD_MS (assistant-ui renders the new messages a
 * commit or two later). scrollTop writes, not scrollTo, so the follow-along
 * guard lets it through.
 */
function holdPlace(el: HTMLElement): () => void {
  const fromBottom = el.scrollHeight - el.scrollTop
  const prev = el.style.overflowAnchor
  el.style.overflowAnchor = 'none'
  const pin = () => {
    const top = Math.max(0, el.scrollHeight - fromBottom)
    if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top
  }
  const mo = new MutationObserver(pin)
  mo.observe(el, { childList: true, subtree: true, characterData: true })
  let done = false
  const stop = () => {
    if (done) return
    done = true
    mo.disconnect()
    el.style.overflowAnchor = prev
  }
  // A hand on the scroll ends the hold at once.
  el.addEventListener('wheel', stop, { once: true, passive: true })
  el.addEventListener('touchmove', stop, { once: true, passive: true })
  window.setTimeout(stop, PREPEND_HOLD_MS)
  return stop
}

export function Thread(props: ThreadProps) {
  const { isRunning, suggestion, onSend } = props
  // Newest messages first, older ones added above once those are painted
  // (hooks/useBottomFirst.ts). Mount one Thread per conversation.
  const viewportRef = useRef<HTMLDivElement>(null)
  const items = useBottomFirst(props.items, viewportRef)
  // While the live line plays, the view follows its bold sentence instead
  // of sticking to the bottom (hooks/useFollowAlong.ts).
  // Driven only by "this thread has a live line" and "it is not paused" —
  // never by how many messages there are or what follows the live one.
  const liveIndex = props.items.findIndex((i) => i.kind === 'message' && !!i.live)
  const liveItem = liveIndex >= 0 ? props.items[liveIndex] : undefined
  const liveClock = liveItem?.kind === 'message' ? liveItem.live : null
  const liveKey = liveItem?.kind === 'message' && liveClock ? liveItem.message.id : null
  const followOn = useFollowOn()
  const follow = useFollowAlong(viewportRef, liveKey, !!liveClock && !liveClock.paused, followOn)
  const newBelow = useNewBelow(props.items, liveIndex, liveKey)
  const away = useAwayFromEnds(viewportRef)
  useJump(viewportRef, props.jumpTo)

  const { toFoot, guarded, toTop } = follow

  // Older pages (§6.2 `before`): the "Load earlier" button at the top keeps
  // the reader's place; the ↑ pill loads one and goes to its top.
  const { onLoadEarlier } = props
  const loadEarlier = useCallback(async () => {
    const el = viewportRef.current
    if (!onLoadEarlier || !el) return false
    const stop = holdPlace(el)
    const got = await onLoadEarlier()
    if (!got) stop()
    return got
  }, [onLoadEarlier])
  const toTopOrEarlier = useCallback(async () => {
    if (props.older && onLoadEarlier) {
      await onLoadEarlier()
      // Let the page render before going to its top.
      window.setTimeout(toTop, 150)
      return
    }
    toTop()
  }, [props.older, onLoadEarlier, toTop])
  const draftRef = useRef<DraftHandle>(null)
  const [attachNote, setAttachNote] = useState<{ text: string; failed?: boolean } | null>(null)
  useImperativeHandle(props.composerRef, () => ({ insert: (t: string) => draftRef.current?.insert(t) }), [])
  const navigate = useNavigate()
  const newChat = () => {
    const t = draftRef.current?.take().trim()
    if (t) {
      // Added to whatever the new chat already holds, never over it.
      const prev = readDraft(NEW_CHAT).text.replace(/\s+$/, '')
      writeDraft(NEW_CHAT, prev ? `${prev}\n\n${t}` : t)
    }
    if (props.newChatTo) navigate(props.newChatTo)
  }
  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = textOf(message)
      if (!text) return
      try {
        if ((await onSend(text)) === false) draftRef.current?.keep(text)
      } catch (err) {
        draftRef.current?.restore(text)
        throw err
      }
      // A send is the reader taking over: show them their words, even
      // while a reply is being followed.
      if (guarded) toFoot()
    },
    [onSend, guarded, toFoot]
  )
  const onCancel = useStop(props.onStop)

  const suggestions = useMemo<ThreadSuggestion[]>(() => (suggestion ? [{ prompt: suggestion }] : []), [suggestion])

  const queue = useMemo<ExternalThreadQueueAdapter>(
    () => ({
      items: [],
      steerItems: [],
      enqueue: (m) => void onNew(m),
      steer: (m) => void onNew(m),
      move: () => {},
      edit: () => {},
      remove: () => {}
    }),
    [onNew]
  )

  // Is a card on screen waiting to be answered — a question, or a permission
  // prompt? Either placement counts: on its message's pending ask part, or as
  // its own item at the foot (lib/convert.ts buildItems).
  const asking = useMemo(
    () => items.some((it) => it.kind === 'approval' || (it.kind === 'message' && !!it.approval)),
    [items]
  )

  const runtime = useExternalStoreRuntime<ChatItem>({
    messages: items,
    convertMessage: convertItem,
    isRunning,
    isDisabled: props.disabled,
    onNew,
    onCancel,
    suggestions,
    queue
  })
  const dictation = useDictation(runtime, props.listenNow, props.placeholder || 'Say something back', props.carry)
  const [targets, setTargets] = useState<HandOffTarget[]>([])
  const [pickingAssistant, setPickingAssistant] = useState(false)
  const offering = dictation.offer || !!props.handOffAlways
  useEffect(() => {
    if (!offering) return
    let live = true
    void handOffTargets().then((t) => live && setTargets(t))
    return () => {
      live = false
    }
  }, [offering])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadActionsContext.Provider value={props.actions}>
        <DraftKeeper draftKey={props.draftKey} handle={draftRef} />
        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Viewport className="viewport" ref={viewportRef} autoScroll={!follow.guarded} scrollToBottomOnRunStart={!follow.guarded}>
            {items.length === 0 && props.empty}
            {items.length > 0 && props.older && (
              <div className="earlier">
                <button className="earlier-button" disabled={props.earlierLoading} onClick={() => void loadEarlier()}>
                  {props.earlierLoading ? 'Loading…' : 'Load earlier'}
                </button>
                {props.earlierError && <p className="error">{props.earlierError}</p>}
              </div>
            )}
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            <WorkingIndicator working={props.working} workingAt={props.workingAt} thinking={props.thinking} asking={asking} />
            <ThreadPrimitive.ViewportFooter className="footer">
              {(follow.detached || (newBelow > 0 && follow.guarded)) && (
                <div className="float-pills">
                  {follow.detached && (
                    <button
                      className="follow-pill"
                      onClick={() => {
                        props.onResync?.()
                        follow.resume()
                      }}
                    >
                      Follow along
                    </button>
                  )}
                  {newBelow > 0 && follow.guarded && (
                    <button className="follow-pill new-below" onClick={follow.toFoot}>
                      {newBelow === 1 ? 'New message' : `${newBelow} new messages`} ↓
                    </button>
                  )}
                </div>
              )}
              {(away.top || (away.bottom && !(newBelow > 0 && follow.guarded))) && (
                <div className="jump-pills">
                  {away.top && (
                    <button className="jump-pill" aria-label="To the top" title="To the top" onClick={() => (away.poke(), void toTopOrEarlier())}>
                      ↑
                    </button>
                  )}
                  {away.bottom && !(newBelow > 0 && follow.guarded) && (
                    <button className="jump-pill" aria-label="To the bottom" title="To the bottom" onClick={() => (away.poke(), follow.toFoot())}>
                      ↓
                    </button>
                  )}
                </div>
              )}
              {props.dock && <div className="ask-dock">{props.dock}</div>}
              {props.speechBar}
              {suggestion && (
                <ThreadPrimitive.Suggestion className="suggestion" prompt={suggestion} send={false}>
                  {suggestion}
                </ThreadPrimitive.Suggestion>
              )}
              {props.status}
              {!props.readOnly && (
              <>
              {props.composerChip}
              <ComposerPrimitive.Root className="composer">
                <MentionPicker />
                {/*
                  Enter is a new line, everywhere: a message to an agent is
                  often several lines, and a stray Enter must not send half
                  of one. Ctrl/Cmd+Enter sends (assistant-ui's
                  submitMode="ctrlEnter"), and so does the button. On the
                  phone the soft keyboard shows a return key (enterKeyHint),
                  not "send". The box grows with its content up to maxRows,
                  and app.css caps it further on a short (landscape) screen.
                  The server flattens newlines when it types into the pane
                  (§6.3 compose()), but records the text as written.
                */}
                <ComposerPrimitive.Input
                  asChild
                  className="input"
                  submitMode="ctrlEnter"
                  enterKeyHint="enter"
                  placeholder={props.placeholder || 'Say something back…'}
                  onPointerDown={dictation.hold}
                >
                  {/* One line when empty, up to 8 as it fills (AutoGrow.tsx says why not assistant-ui's). */}
                  <AutoGrowTextarea rows={1} maxRows={8} />
                </ComposerPrimitive.Input>
                {isRunning && (
                  // STUB until §12: the button is here so the gesture exists.
                  <ComposerPrimitive.Cancel className="stop" title="Stop (not in v0)">
                    ■
                  </ComposerPrimitive.Cancel>
                )}
                {/* Attach sits on top of the mic, the way New chat sits on Send. */}
                <div className="mic-stack">
                  <AttachButton onPicked={(t) => draftRef.current?.insert(t)} onStatus={setAttachNote} />
                  {dictation.can && (
                    <button
                      type="button"
                      className={dictation.listening ? 'mic listening' : 'mic'}
                      aria-label="Dictate"
                      title="Dictate"
                      disabled={dictation.listening}
                      onClick={dictation.listen}
                    >
                      🎙
                    </button>
                  )}
                </div>
                {props.newChatTo ? (
                  // Inside the box, stacked on the send button: a new chat that takes the words.
                  <div className="send-stack">
                    <button type="button" className="new-chat-mini" title="New chat (takes what is typed)" aria-label="New chat" onClick={newChat}>
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                      </svg>
                    </button>
                    <ComposerPrimitive.Send className="send">↑</ComposerPrimitive.Send>
                  </div>
                ) : (
                  <ComposerPrimitive.Send className="send">↑</ComposerPrimitive.Send>
                )}
              </ComposerPrimitive.Root>
              {offering && ((dictation.offer && props.onNewChatInstead) || targets.length > 0) && (
                // The assistant button's words, taken somewhere else instead.
                // Shown all the time (a new chat), they go once typing starts:
                // by then Sasonica is the assistant being written to.
                <WhileEmpty unless={dictation.offer}>
                  <div className="chips handoff">
                    {dictation.offer && props.onNewChatInstead && (
                      <button type="button" className="chip" onClick={() => props.onNewChatInstead?.(dictation.take())}>
                        New chat instead
                      </button>
                    )}
                    {/* One other assistant keeps its chip; more fold into one, as New chat's pickers do. */}
                    {targets.length === 1 ? (
                      <button type="button" className="chip" onClick={() => void handOff(targets[0], dictation.take()).catch(() => {})}>
                        {targets[0].label} →
                      </button>
                    ) : targets.length > 1 ? (
                      <button type="button" className="chip" onClick={() => (dictation.hold(), setPickingAssistant(true))}>
                        Other assistants <span aria-hidden="true">▾</span>
                      </button>
                    ) : null}
                  </div>
                </WhileEmpty>
              )}
              {pickingAssistant && (
                // Outside the offer: it can run out while the sheet is open.
                <Sheet label="Other assistants" onClose={() => setPickingAssistant(false)} className="action-sheet">
                  <p className="action-title">Send to another assistant</p>
                  <div role="menu" className="action-list">
                    {targets.map((t) => (
                      <button
                        key={t.id}
                        role="menuitem"
                        onClick={() => (setPickingAssistant(false), void handOff(t, dictation.take()).catch(() => {}))}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </Sheet>
              )}
              {attachNote && <p className={attachNote.failed ? 'status failed' : 'status'}>{attachNote.text}</p>}
              {dictation.sendIn > 0 && <p className="status">Sending in {dictation.sendIn}… tap to edit it</p>}
              {/* Only where there is a real keyboard: app.css hides it on touch-only devices. */}
              <p className="send-hint">{SEND_KEYS} to send</p>
              </>
              )}
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </ThreadActionsContext.Provider>
    </AssistantRuntimeProvider>
  )
}
