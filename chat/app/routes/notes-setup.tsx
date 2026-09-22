/**
 * Setting up notes on this server (server-contract.md §6.10, /notes/setup):
 * a checklist of what the Notes tab stands on — the notes folder, its sync,
 * the memory store, paragtd — each with the fix the server offers.
 *
 * Quick fixes answer at once. A long one (a clone, an install) runs in a
 * window on the server; the window's screen is shown here, polled, with a
 * line to type into it (a passphrase, a `y`) — the same windows the harness
 * installs use (/harnesses/screen, /keys, /close).
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { hasCredential } from '../api/auth'
import {
  closeSetupWindow,
  getNotesSetup,
  getSetupScreen,
  runNotesSetup,
  setupKeys,
  type SetupComponent,
  type SetupScreen,
  type SetupStatus
} from '../api/notes'
import '../notes.css'

const ACTION_LABEL: Record<string, string> = {
  create: 'Start fresh notes',
  clone: 'Clone my notes',
  enable: 'Turn on sync',
  install: 'Install',
  update: 'Update'
}

const STATE_LABEL: Record<string, string> = {
  ok: 'ready',
  missing: 'not set up',
  off: 'off',
  down: 'not answering'
}

/** How often a running window's screen is asked for. */
const SCREEN_POLL_MS = 1500

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default function NotesSetup() {
  if (!hasCredential()) return <Navigate to="/pairing" replace />
  return <SetupPage />
}

function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState<{ text: string; failed?: boolean } | null>(null)
  const [pane, setPane] = useState<{ pane: string; label: string } | null>(null)

  const load = useCallback((signal?: AbortSignal) => {
    getNotesSetup(signal)
      .then((s) => {
        setStatus(s)
        setError('')
      })
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') setError(message(err))
      })
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const run = async (c: SetupComponent, action: string) => {
    setBusy(`${c.name}:${action}`)
    setNote(null)
    try {
      const r = await runNotesSetup(c.name, action)
      if (r.pane) setPane({ pane: r.pane, label: `${c.label}: ${ACTION_LABEL[action] || action}` })
      else setNote({ text: r.created?.length ? `Created ${r.created.join(', ')}.` : 'Done.' })
      load()
    } catch (err) {
      setNote({ text: message(err), failed: true })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="page notes-setup">
      <header className="bar">
        <Link className="icon" to="/organiser" title="Organiser">
          ←
        </Link>
        <h1>Set up the organiser</h1>
        <button className="icon" onClick={() => load()} title="Check again">
          ↻
        </button>
      </header>

      {error && <p className="notice error">{error}</p>}
      {note && <p className={note.failed ? 'notice error' : 'notice'}>{note.text}</p>}
      {!status && !error && <p className="notice">Checking…</p>}

      <div className="note-list">
        {status && (
          <ul className="setup-list">
            {status.components.map((c) => (
              <li key={c.name} className={`setup-item ${c.state}`}>
                <div className="setup-head">
                  <span className={`setup-dot ${c.state}`} aria-hidden />
                  <span className="setup-label">{c.label}</span>
                  {c.optional && <span className="setup-optional">optional</span>}
                  <span className="setup-state">{STATE_LABEL[c.state] || c.state}</span>
                </div>
                <p className="setup-detail">{c.detail}</p>
                {c.why && <p className="setup-why">{c.why}</p>}
                {c.actions.length > 0 && (
                  <div className="setup-actions">
                    {c.actions.map((a) => (
                      <button key={a} className={c.state === 'ok' ? 'notes-button' : 'notes-button primary'} disabled={!!busy || !!pane} onClick={() => void run(c, a)}>
                        {busy === `${c.name}:${a}` ? '…' : ACTION_LABEL[a] || a}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {status && <p className="setup-foot">Search uses {status.search === 'ripgrep' ? 'ripgrep' : 'the built-in scan (install ripgrep for speed)'}.</p>}
        {pane && (
          <SetupWindow
            pane={pane.pane}
            label={pane.label}
            onClose={() => {
              setPane(null)
              load()
            }}
          />
        )}
      </div>
    </div>
  )
}

/** A running setup window's screen, and a line to type into it. */
function SetupWindow({ pane, label, onClose }: { pane: string; label: string; onClose: () => void }) {
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
