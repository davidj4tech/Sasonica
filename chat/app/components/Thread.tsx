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
import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import type { Working } from '../api/types'
import { APPROVAL_TOOL, ASK_TOOL, convertItem, type ChatItem } from '../lib/convert'
import {
  ApprovalToolUI,
  AskToolUI,
  CommandChip,
  LineText,
  OptimisticMark,
  Picture,
  PictureData,
  ThreadActionsContext,
  ToolFallback,
  WorkSummary,
  WorkingIndicator,
  type ThreadActions
} from './parts'

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
  if (empty) return null
  return (
    <MessagePrimitive.Root className={running ? 'msg agent speaking' : 'msg agent'}>
      <WorkSummary />
      <div className="bubble">
        <MessagePrimitive.Parts components={partComponents} />
      </div>
    </MessagePrimitive.Root>
  )
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

export interface ThreadProps {
  items: ChatItem[]
  isRunning: boolean
  working: Working | null
  workingAt: number
  thinking: boolean
  suggestion: string
  /** Send the words; throw to leave them in the box. */
  onSend: (text: string) => Promise<void>
  onStop: (speech: 'auto' | 'silence') => void
  actions: ThreadActions
  /** Shown above the composer: send status, errors. */
  status?: ReactNode
  /** Shown when there are no messages. */
  empty?: ReactNode
  placeholder?: string
  /** Disable the composer (e.g. no place picked yet). */
  disabled?: boolean
}

export function Thread(props: ThreadProps) {
  const { items, isRunning, suggestion, onSend } = props

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = textOf(message)
      if (text) await onSend(text)
    },
    [onSend]
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
        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Viewport className="viewport">
            {items.length === 0 && props.empty}
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            <WorkingIndicator working={props.working} workingAt={props.workingAt} thinking={props.thinking} />
            <ThreadPrimitive.ViewportFooter className="footer">
              {suggestion && (
                <ThreadPrimitive.Suggestion className="suggestion" prompt={suggestion} send={false}>
                  {suggestion}
                </ThreadPrimitive.Suggestion>
              )}
              {props.status}
              <ComposerPrimitive.Root className="composer">
                <ComposerPrimitive.Input className="input" rows={1} placeholder={props.placeholder || 'Say something back…'} />
                {isRunning && (
                  // STUB until §12: the button is here so the gesture exists.
                  <ComposerPrimitive.Cancel className="stop" title="Stop (not in v0)">
                    ■
                  </ComposerPrimitive.Cancel>
                )}
                <ComposerPrimitive.Send className="send">↑</ComposerPrimitive.Send>
              </ComposerPrimitive.Root>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </ThreadActionsContext.Provider>
    </AssistantRuntimeProvider>
  )
}
