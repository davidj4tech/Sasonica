/**
 * A small Server-Sent Events reader over fetch, for the per-thread stream
 * (server-contract.md §11).
 *
 * Why not `EventSource`: it cannot set the Authorization header, and the
 * alternative (`?access_token=` in the URL) puts the device token in every
 * proxy log on the way. Why not `@microsoft/fetch-event-source`: its own
 * retry and visibility handling would fight the thread hook's (which owns
 * backoff, the heartbeat watchdog and the polling fallback), and what is
 * left is forty lines.
 *
 * Parses the wire format as the spec does: `event:`, `data:` (joined with
 * newlines), `id:`, `retry:`, comments (`:`), any of CRLF / LF / CR as the
 * line end; a blank line dispatches. `onBytes` fires on every chunk — the
 * watchdog's "something arrived", pings included.
 */

export interface SseFrame {
  event: string
  data: string
  id: string
}

export interface SseHandlers {
  onFrame: (frame: SseFrame) => void
  /** Any bytes at all (for a heartbeat watchdog). */
  onBytes?: () => void
}

/** Reads `body` until it ends or `signal` aborts. Resolves on a clean end. */
export async function readSse(body: ReadableStream<Uint8Array>, handlers: SseHandlers, signal?: AbortSignal): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let event = ''
  let data: string[] = []
  let id = ''
  const onAbort = () => void reader.cancel().catch(() => {})
  signal?.addEventListener('abort', onAbort)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      handlers.onBytes?.()
      buf += decoder.decode(value, { stream: true })
      // Split on any line end; keep the last (maybe partial) line. A lone CR
      // at the very end may be the first half of a CRLF: keep it too.
      let start = 0
      for (let i = 0; i < buf.length; i++) {
        const ch = buf[i]
        if (ch !== '\n' && ch !== '\r') continue
        if (ch === '\r' && i === buf.length - 1) break
        const line = buf.slice(start, i)
        if (ch === '\r' && buf[i + 1] === '\n') i++
        start = i + 1
        if (line === '') {
          if (data.length) handlers.onFrame({ event: event || 'message', data: data.join('\n'), id })
          event = ''
          data = []
          continue
        }
        if (line[0] === ':') continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        let val = colon < 0 ? '' : line.slice(colon + 1)
        if (val[0] === ' ') val = val.slice(1)
        if (field === 'event') event = val
        else if (field === 'data') data.push(val)
        else if (field === 'id') id = val
        // `retry` is ignored: the hook owns the backoff.
      }
      buf = buf.slice(start)
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
