/**
 * One thread on assistant-ui's ExternalStoreRuntime (server-contract.md §14).
 *
 * The state lives in the page (the log poll); the runtime reads it through
 * `convertItem` and calls back:
 *   messages  ← /conversation/log lines (+ an approval, + optimistic sends)
 *   isRunning ← `pending` (or `working`, or a send not yet answered)
 *   onNew     → the page's `send` (/reply, or /ask for a new thread)
 *   onCancel  → STUB: POST /session/stop is v1 (§12)
 *   suggestions ← `suggestion`
 *
 * A queue adapter keeps the composer usable while a turn runs: the harness
 * takes typed input mid-turn, so a message sent then goes straight to the
 * server, as the Nuxt reply box does. Nothing is held client-side.
 */
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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Working } from '../api/types'
import { useBottomFirst } from '../hooks/useBottomFirst'
import { useDraft, type DraftHandle } from '../hooks/useDraft'
import { useFollowAlong } from '../hooks/useFollowAlong'
import { APPROVAL_TOOL, ASK_TOOL, convertItem, type ChatItem } from '../lib/convert'
import {
  ApprovalToolUI,
  AskToolUI,
  CommandChip,
  LineText,
  MessageSpeechKey,
  OptimisticMark,
  Picture,
  PictureData,
  ThreadActionsContext,
  ToolFallback,
  WorkSummary,
  WorkingIndicator,
  type ThreadActions
} from './parts'

/** "⌘+Enter" on Apple keyboards, "Ctrl+Enter" elsewhere. */
const SEND_KEYS =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘+Enter' : 'Ctrl+Enter'

const partComponents = {
  Text: LineText,
  Image: Picture,
  data: { by_name: { picture: PictureData } },
  tools: {
    by_name: { [ASK_TOOL]: AskToolUI, [APPROVAL_TOOL]: ApprovalToolUI },
    Fallback: ToolFallback
  }
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="msg user">
      <div className="bubble">
        <CommandChip />
        <MessagePrimitive.Parts components={partComponents} />
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
  const bubbleRef = useRef<HTMLDivElement>(null)
  const tall = useTallBubble(bubbleRef, !empty)
  if (empty) return null
  return (
    <MessagePrimitive.Root className={running ? 'msg agent speaking' : 'msg agent'}>
      <WorkSummary />
      <div className="bubble-row">
        <div className="bubble" ref={bubbleRef}>
          <MessagePrimitive.Parts components={partComponents} />
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
function useNewBelow(items: ChatItem[], liveIndex: number, liveKey: number | null): number {
  const below = liveIndex >= 0 ? items.length - 1 - liveIndex : 0
  const [base, setBase] = useState<{ key: number | null; below: number }>({ key: liveKey, below })
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
  const liveIndex = props.items.findIndex((i) => i.kind === 'line' && !!i.live)
  const liveItem = liveIndex >= 0 ? props.items[liveIndex] : undefined
  const liveClock = liveItem?.kind === 'line' ? liveItem.live : null
  const liveKey = liveItem?.kind === 'line' && liveClock ? liveItem.line.at : null
  const follow = useFollowAlong(viewportRef, liveKey, !!liveClock && !liveClock.paused)
  const newBelow = useNewBelow(props.items, liveIndex, liveKey)

  const { toFoot, guarded } = follow
  const draftRef = useRef<DraftHandle>(null)
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

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadActionsContext.Provider value={props.actions}>
        <DraftKeeper draftKey={props.draftKey} handle={draftRef} />
        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Viewport className="viewport" ref={viewportRef} autoScroll={!follow.guarded} scrollToBottomOnRunStart={!follow.guarded}>
            {items.length === 0 && props.empty}
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            <WorkingIndicator working={props.working} workingAt={props.workingAt} thinking={props.thinking} />
            <ThreadPrimitive.ViewportFooter className="footer">
              {(follow.detached || (newBelow > 0 && follow.guarded)) && (
                <div className="float-pills">
                  {follow.detached && (
                    <button className="follow-pill" onClick={follow.resume}>
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
              {props.speechBar}
              {suggestion && (
                <ThreadPrimitive.Suggestion className="suggestion" prompt={suggestion} send={false}>
                  {suggestion}
                </ThreadPrimitive.Suggestion>
              )}
              {props.status}
              <ComposerPrimitive.Root className="composer">
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
                  className="input"
                  rows={1}
                  maxRows={8}
                  submitMode="ctrlEnter"
                  enterKeyHint="enter"
                  placeholder={props.placeholder || 'Say something back…'}
                />
                {isRunning && (
                  // STUB until §12: the button is here so the gesture exists.
                  <ComposerPrimitive.Cancel className="stop" title="Stop (not in v0)">
                    ■
                  </ComposerPrimitive.Cancel>
                )}
                <ComposerPrimitive.Send className="send">↑</ComposerPrimitive.Send>
              </ComposerPrimitive.Root>
              {/* Only where there is a real keyboard: app.css hides it on touch-only devices. */}
              <p className="send-hint">{SEND_KEYS} to send</p>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </ThreadActionsContext.Provider>
    </AssistantRuntimeProvider>
  )
}
