/**
 * A window the server opened to run something long — a notes clone, a
 * harness install or sign-in — as the desk sees it: its screen, polled until
 * the command prints `[finished: N]`, and a line to type into it (a pasted
 * OAuth code, a passphrase, a `y`). /harnesses/screen, /keys and /close
 * answer for every such window, whichever page opened it.
 */
import { useEffect, useState } from 'react'
import { closeSetupWindow, getSetupScreen, setupKeys, type SetupScreen } from '../api/notes'
import '../notes.css'

/** How often a running window's screen is asked for. */
const SCREEN_POLL_MS = 1500

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A running setup window's screen, and a line to type into it. */
export function SetupWindow({ pane, label, onClose }: { pane: string; label: string; onClose: () => void }) {
  const [screen, setScreen] = useState<SetupScreen | null>(null)
  const [error, setError] = useState('')
  const [line, setLine] = useState('')

  useEffect(() => {
    let alive = true
    let timer = 0
    const ac = new AbortController()
    const tick = () => {
      getSetupScreen(pane, ac.signal)
        .then((s) => {
          if (!alive) return
          setScreen(s)
          setError('')
          if (!s.done) timer = window.setTimeout(tick, SCREEN_POLL_MS)
        })
        .catch((err) => {
          if (!alive || (err as Error)?.name === 'AbortError') return
          setError(message(err))
          timer = window.setTimeout(tick, SCREEN_POLL_MS * 2)
        })
    }
    tick()
    return () => {
      alive = false
      ac.abort()
      window.clearTimeout(timer)
    }
  }, [pane])

  const type = async (input: { text?: string; key?: string }) => {
    try {
      await setupKeys(pane, input)
    } catch (err) {
      setError(message(err))
    }
  }

  const close = async () => {
    try {
      await closeSetupWindow(pane)
    } catch {
      // Gone already: nothing to close.
    }
    onClose()
  }

  const finished = screen?.done
  return (
    <section className="setup-window" aria-label={label}>
      <div className="setup-window-head">
        <span className="grow">{label}</span>
        {finished && <span className={screen?.exit === 0 ? 'setup-exit ok' : 'setup-exit bad'}>{screen?.exit === 0 ? 'finished' : `failed (${screen?.exit})`}</span>}
        <button className="notes-button" onClick={() => void close()}>
          {finished ? 'Done' : 'Stop'}
        </button>
      </div>
      {screen?.cmd && <p className="setup-cmd">{screen.cmd}</p>}
      <pre className="setup-screen">{screen ? screen.lines.join('\n') : 'Starting…'}</pre>
      {error && <p className="notice error">{error}</p>}
      {!finished && (
        <form
          className="setup-type"
          onSubmit={(e) => {
            e.preventDefault()
            const t = line
            setLine('')
            void type(t ? { text: t, key: 'Enter' } : { key: 'Enter' })
          }}
        >
          <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="Type into it (Enter sends)" aria-label="Type into the window" autoCapitalize="off" autoCorrect="off" />
          <button className="notes-button" type="submit">
            ⏎
          </button>
          <button className="notes-button" type="button" onClick={() => void type({ key: 'C-c' })} title="Interrupt">
            ^C
          </button>
        </form>
      )}
    </section>
  )
}
