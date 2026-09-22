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
import { readNote, sayNote, type NoteText } from '../api/notes'
import { OrgBody, parseHeading, StateBadge } from '../lib/org'
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
  }, [path, at])

  const say = async () => {
    setSaid(null)
    try {
      await sayNote(path, at)
      setSaid({ text: 'Reading it out.' })
    } catch (err) {
      setSaid({ text: err instanceof Error ? err.message : String(err), failed: true })
    }
  }

  // A heading's own line carries its state; the page title shows it once.
  const head = note && at ? parseHeading(note.text.split('\n', 1)[0].replace(/^\*+\s+/, '')) : null
  const where = path.replace(/^roam\//, '').replace(/\.org$/, '')

  return (
    <div className="page note-page">
      <header className="bar">
        <button className="icon" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/notebook'))} title="Back">
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
          {error.changed ? <Link to="/notebook">Back to the list</Link> : error.text}
        </p>
      )}
      {said && <p className={said.failed ? 'notice error' : 'notice'}>{said.text}</p>}
      {!note && !error && <p className="notice">Loading…</p>}

      {note && (
        <article className="note-body">
          <p className="note-where">{at ? `${where} · line ${at}` : where}</p>
          <OrgBody text={note.text} links={note.links} skipFirstHeading={!!at} />
          {note.links.length > 0 && (
            <nav className="note-links" aria-label="Linked notes">
              <h2>Linked</h2>
              {note.links.map((l) => (
                <Link key={`${l.path}:${l.label}`} to={`/notebook/note?path=${encodeURIComponent(l.path)}`}>
                  {l.label}
                </Link>
              ))}
            </nav>
          )}
        </article>
      )}

      <div className="dock">
        <SpeechBar />
      </div>
    </div>
  )
}
