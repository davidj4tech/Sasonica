/**
 * Setting up notes on this server (server-contract.md §6.10, /notes/setup):
 * a checklist of what the Notes tab stands on — the notes folder, its sync,
 * the memory store, paragtd — each with the fix the server offers.
 *
 * Quick fixes answer at once. A long one (a clone, an install) runs in a
 * window on the server; the window's screen is shown here, polled, with a
 * line to type into it (a passphrase, a `y`) — the same windows the harness
 * installs use (components/SetupWindow.tsx).
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { hasCredential } from '../api/auth'
import { getNotesSetup, runNotesSetup, type SetupComponent, type SetupRun, type SetupStatus } from '../api/notes'
import { SetupWindow } from '../components/SetupWindow'
import '../notes.css'

const labelOf = (component: string, action: string) => ACTION_LABEL[`${component}:${action}`] || ACTION_LABEL[action] || action

/** What a quick action says it did. */
function doneText(r: SetupRun): string {
  if (r.created?.length) return `Created ${r.created.join(', ')}.`
  if (r.added) return r.added.length ? `Added ${r.added.join(' and ')}.` : 'Nothing was missing.'
  if (typeof r.files === 'number') return `Copied ${r.files} agenda file${r.files === 1 ? '' : 's'}${r.keywords?.length ? ' and your TODO keywords' : ''} from Emacs.`
  return 'Done.'
}

const ACTION_LABEL: Record<string, string> = {
  create: 'Start fresh notes',
  clone: 'Clone my notes',
  enable: 'Turn on sync',
  install: 'Install',
  update: 'Update',
  // Per component, where one action word means different things.
  'agenda:import': 'Copy from Emacs',
  'astro:enable': 'Keep a year ahead',
  'astro:run': 'Add missing years now'
}

const STATE_LABEL: Record<string, string> = {
  ok: 'ready',
  missing: 'not set up',
  off: 'off',
  down: 'not answering'
}

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
      if (r.pane) setPane({ pane: r.pane, label: `${c.label}: ${labelOf(c.name, action)}` })
      else setNote({ text: doneText(r) })
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
                        {busy === `${c.name}:${a}` ? '…' : labelOf(c.name, a)}
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
