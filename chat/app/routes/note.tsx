/**
 * One note, or one heading of a GTD file (`?path=…&at=<line>`), rendered
 * from its Org text (lib/org.tsx). The speaker key hands it to the voice
 * (`POST /notes/say`), which reads it like any reply. A 409 means the file
 * changed under us since the list was drawn: back to the list to refresh.
 */
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { hasCredential } from '../api/auth'
import { ApiError } from '../api'
import { isEditable, readNote, refileNote, REFILE_LABELS, sayNote, setNoteState, type NoteState, type NoteText, type RefileTarget } from '../api/notes'
import { MoveSheet } from '../components/MoveSheet'
import { NoteAsk } from '../components/NoteAsk'
import { noteHref as noteHrefOf, OrgBody, parseHeading, StateBadge } from '../lib/org'
import { SpeechBar } from '../components/SpeechBar'
import '../notes.css'

export default function Note() {
  if (!hasCredential()) return <Navigate to="/pairing" replace />
  return <NotePage />
}

function NotePage() {
  const [params] = useSearchParams()
  const path = params.get('path') || ''
  const at = Number(params.get('at') || 0) || 0
  const navigate = useNavigate()
  const [note, setNote] = useState<NoteText | null>(null)
  const [error, setError] = useState<{ text: string; changed?: boolean } | null>(null)
  const [said, setSaid] = useState<{ text: string; failed?: boolean } | null>(null)
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    setNote(null)
    setError(null)
    readNote(path, at, ac.signal)
      .then(setNote)
      .catch((err) => {
        if ((err as Error)?.name === 'AbortError') return
        setError({ text: err instanceof Error ? err.message : String(err), changed: err instanceof ApiError && err.status === 409 })
      })
    return () => ac.abort()
  }, [path, at, reload])

  const say = async () => {
    setSaid(null)
    try {
      await sayNote(path, at)
      setSaid({ text: 'Reading it out.' })
    } catch (err) {
      setSaid({ text: err instanceof Error ? err.message : String(err), failed: true })
    }
  }

  // The heading's state, or a move: rewritten in the file, then shown from it.
  const changeState = async (state: NoteState) => {
    if (!note || busy) return
    setBusy(true)
    setSaid(null)
    try {
      const r = await setNoteState(path, at, note.title, state)
      setSaid({ text: r.repeated ? `Repeats — next on ${r.next}.` : state === 'DONE' ? 'Done.' : `Now ${state || 'a plain heading'}.` })
      if (r.at !== at) navigate(noteHrefOf(r.path, r.at), { replace: true })
      else setReload((n) => n + 1)
    } catch (err) {
      setSaid({ text: err instanceof Error ? err.message : String(err), failed: true })
    } finally {
      setBusy(false)
    }
  }

  const move = async (to: RefileTarget, date?: string) => {
    if (!note) return
    setMoving(false)
    setBusy(true)
    setSaid(null)
    try {
      const r = await refileNote(path, at, note.title, to, date)
      navigate(noteHrefOf(r.path, r.at), { replace: true })
      setSaid({ text: `Moved to ${REFILE_LABELS[to].replace(/ \(.*\)$/, '')}${date ? ` for ${date}` : ''}.` })
    } catch (err) {
      setSaid({ text: err instanceof Error ? err.message : String(err), failed: true })
    } finally {
      setBusy(false)
    }
  }

  // A heading's own line carries its state; the page title shows it once.
  const head = note && at ? parseHeading(note.text.split('\n', 1)[0].replace(/^\*+\s+/, '')) : null
  const where = path.replace(/^roam\//, '').replace(/\.org$/, '')

  return (
    <div className="page note-page">
      <header className="bar">
        <button className="icon" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/organiser'))} title="Back">
          ←
        </button>
        <h1>
          {head && <StateBadge state={head.state} />} {note?.title || where}
        </h1>
        {note && (
          <button className="icon" onClick={() => void say()} title="Read aloud">
            🔊
          </button>
        )}
      </header>

      {error && (
        <p className="notice error">
          {error.changed ? 'This note changed since the list was drawn. ' : ''}
          {error.changed ? <Link to="/organiser">Back to the list</Link> : error.text}
        </p>
      )}
      {said && <p className={said.failed ? 'notice error' : 'notice'}>{said.text}</p>}
      {note && head && isEditable(path) && (
        <div className="note-actions">
          {(['TODO', 'NEXT', 'WAITING', 'DONE'] as const).map((st) => (
            <button key={st} className={head.state === st ? 'state-key on' : 'state-key'} disabled={busy || head.state === st} onClick={() => void changeState(st)}>
              {st === 'DONE' ? '✓ Done' : st}
            </button>
          ))}
          <button className="state-key move" disabled={busy} onClick={() => setMoving(true)}>
            Move to…
          </button>
        </div>
      )}
      {moving && <MoveSheet from={path} onMove={(to, date) => void move(to, date)} onClose={() => setMoving(false)} />}
      {!note && !error && <p className="notice">Loading…</p>}

      {note && (
        <article className="note-body">
          <p className="note-where">{at ? `${where} · line ${at}` : where}</p>
          <OrgBody text={note.text} links={note.links} skipFirstHeading={!!at} />
          {note.links.length > 0 && (
            <nav className="note-links" aria-label="Linked notes">
              <h2>Linked</h2>
              {note.links.map((l) => (
                <Link key={`${l.path}:${l.label}`} to={`/organiser/note?path=${encodeURIComponent(l.path)}`}>
                  {l.label}
                </Link>
              ))}
            </nav>
          )}
        </article>
      )}

      <div className="dock">
        <SpeechBar />
        {note && <NoteAsk key={`${path}#${at}`} path={path} at={at} title={note.title} chats={note.chats || []} />}
      </div>
    </div>
  )
}
