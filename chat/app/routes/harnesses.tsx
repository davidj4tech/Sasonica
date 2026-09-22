/**
 * Coding agents (server-contract.md §6.6, /harnesses): which of Claude,
 * Codex, pi and Hermes the server has, which are signed in, and the two
 * things that used to need the desk — installing one, and signing into it.
 * A fresh machine, or a token that expired overnight, is what makes "new
 * codex chat" answer `codex: not found`; this page is the fix from the chair.
 *
 * Install and sign-in both run in a window on the server, watched here
 * through components/SetupWindow — the sign-in's OAuth code is pasted back
 * into its line. Signing out is the odd one: it deletes the stored
 * credentials and exits, so there is no window, and it is the only button
 * here that takes something away — it asks first, in the row.
 * Reached from Settings.
 */
import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { getHarnesses, logoutHarness, runHarness, type HarnessRow } from '../api'
import { hasCredential } from '../api/auth'
import { BackLink } from '../components/Nav'
import { SetupWindow } from '../components/SetupWindow'
import '../notes.css'

const LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex', pi: 'pi', hermes: 'Hermes' }

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** "0.155.1 · signed in (you@example.com)", or "not installed". */
function describe(h: HarnessRow): string {
  if (!h.present) return 'not installed'
  const bits = [h.version || 'installed']
  if (h.auth === 'in') bits.push(h.account ? `signed in (${h.account})` : 'signed in')
  else if (h.auth === 'out') bits.push('signed out')
  return bits.join(' · ')
}

/** The dot: ready, needs something, or can't tell (pi and Hermes won't say). */
function dot(h: HarnessRow): string {
  if (!h.present || h.auth === 'out') return 'missing'
  return h.auth === 'in' ? 'ok' : 'unknown'
}

export default function Harnesses() {
  if (!hasCredential()) return <Navigate to="/pairing" replace />
  return <HarnessesPage />
}

function HarnessesPage() {
  const [rows, setRows] = useState<HarnessRow[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  // A line under the header: a failure, or (signing out) what just happened.
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [pane, setPane] = useState<{ pane: string; label: string } | null>(null)
  // Which row is asking "sign out?" — one at a time, cleared on any answer.
  const [confirm, setConfirm] = useState('')

  const load = useCallback((signal?: AbortSignal) => {
    getHarnesses(signal)
      .then((r) => {
        setRows(r.agents)
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

  const run = async (h: HarnessRow, action: 'install' | 'login') => {
    setBusy(`${h.name}:${action}`)
    setNote(null)
    try {
      const r = await runHarness(h.name, action)
      const what = action === 'login' ? 'Sign in' : h.installed_action === 'update' ? 'Update' : 'Install'
      setPane({ pane: r.pane, label: `${LABEL[h.name] || h.name}: ${what}` })
    } catch (err) {
      setNote({ text: message(err), bad: true })
    } finally {
      setBusy('')
    }
  }

  const signOut = async (h: HarnessRow) => {
    setConfirm('')
    setBusy(`${h.name}:logout`)
    setNote(null)
    try {
      const r = await logoutHarness(h.name)
      // Its own last words when it complained; otherwise say what happened,
      // since the row alone changing is easy to miss.
      setNote(r.exit === 0
        ? { text: `${LABEL[h.name] || h.name}: signed out.` }
        : { text: r.lines.join(' ') || `exit ${r.exit}`, bad: true })
    } catch (err) {
      setNote({ text: message(err), bad: true })
    } finally {
      setBusy('')
      load()
    }
  }

  return (
    <div className="page notes-setup harnesses">
      <header className="bar">
        <BackLink />
        <h1 className="grow">Coding agents</h1>
        <button className="icon" onClick={() => load()} title="Check again" aria-label="Check again">
          ↻
        </button>
      </header>

      {error && <p className="notice error">{error}</p>}
      {note && <p className={note.bad ? 'notice error' : 'notice'}>{note.text}</p>}
      {!rows && !error && <p className="notice">Checking…</p>}

      <div className="note-list">
        {rows && (
          <ul className="setup-list">
            {rows.map((h) => (
              <li key={h.name} className="setup-item" data-agent={h.name}>
                <div className="setup-head">
                  <span className={`setup-dot ${dot(h)}`} aria-hidden />
                  <span className="setup-label">{LABEL[h.name] || h.name}</span>
                </div>
                <p className="setup-detail">{describe(h)}</p>
                {confirm === h.name ? (
                  <>
                    <p className="setup-why">
                      Sign {LABEL[h.name] || h.name} out on the server? New {LABEL[h.name] || h.name} chats
                      will not start until it is signed in again from this page.
                    </p>
                    <div className="setup-actions">
                      <button className="notes-button danger" onClick={() => void signOut(h)}>
                        Sign out
                      </button>
                      <button className="notes-button" onClick={() => setConfirm('')}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : h.actions.length > 0 && (
                  <div className="setup-actions">
                    {h.actions.includes('install') && (
                      <button className={h.present ? 'notes-button' : 'notes-button primary'} disabled={!!busy || !!pane} onClick={() => void run(h, 'install')}>
                        {busy === `${h.name}:install` ? '…' : h.installed_action === 'update' ? 'Update' : 'Install'}
                      </button>
                    )}
                    {h.actions.includes('login') && (
                      <button className={h.auth === 'out' ? 'notes-button primary' : 'notes-button'} disabled={!!busy || !!pane} onClick={() => void run(h, 'login')}>
                        {busy === `${h.name}:login` ? '…' : 'Sign in'}
                      </button>
                    )}
                    {h.actions.includes('logout') && (
                      <button className="notes-button" disabled={!!busy || !!pane} onClick={() => setConfirm(h.name)}>
                        {busy === `${h.name}:logout` ? '…' : 'Sign out'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {rows && (
          <p className="setup-foot">
            Installs and sign-ins run in a window on the server, also visible at the desk. A sign-in that shows a link: open it, then paste the code back here.
          </p>
        )}
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
