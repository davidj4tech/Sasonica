/**
 * One note, or one heading of a GTD file (`?path=…&at=<line>`), rendered
 * from its Org text (lib/org.tsx). The play key hands it to the voice
 * (`POST /notes/say`), which reads it like any reply. A to-do's date is a
 * key: tapped, a sheet picks a new one (`POST /notes/date`). A 409 means the
 * file changed under us since the list was drawn: back to the list to refresh.
 */
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { hasCredential } from '../api/auth'
import { ApiError } from '../api'
import { readNote, refileNote, sayNote, triggeredText, setNoteDate, setNotePriority, setNoteState, type DateKind, type NoteState, type NoteText, type RefileTargetInfo } from '../api/notes'
import { doneWordOf, statesOf, useNotesMeta } from '../lib/notesMeta'
import { DateSheet } from '../components/DateSheet'
import { MoveSheet } from '../components/MoveSheet'
import { PrioritySheet } from '../components/PrioritySheet'
import { NoteAsk } from '../components/NoteAsk'
import { useGoBack } from '../components/Nav'
import { noteHref as noteHrefOf, OrgBody, ownPlanning, parseHeading, planStamps, StateBadge } from '../lib/org'
import { IconPlay, SpeechBar } from '../components/SpeechBar'
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
  const goBack = useGoBack()
  const [note, setNote] = useState<NoteText | null>(null)
  const [error, setError] = useState<{ text: string; changed?: boolean } | null>(null)
  const [said, setSaid] = useState<{ text: string; failed?: boolean } | null>(null)
  const [moving, setMoving] = useState(false)
  const [prioritising, setPrioritising] = useState(false)
  const [dating, setDating] = useState<{ kind: DateKind; date: string; time: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // This file's keywords: what the state keys offer, and which one is "done".
  const meta = useNotesMeta()
  const fileStates = note?.states || statesOf(meta, path)
  const doneWord = fileStates.done.includes('DONE') ? 'DONE' : fileStates.done[0] || doneWordOf(meta, path)
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
      const said = r.repeated ? `Repeats — next on ${r.next}.` : state === doneWord ? 'Done.' : `Now ${state || 'a plain heading'}.`
      setSaid({ text: [said, triggeredText(r)].filter(Boolean).join(' ') })
      if (r.at !== at) navigate(noteHrefOf(r.path, r.at), { replace: true })
      else setReload((n) => n + 1)
    } catch (err) {
      setSaid({ text: err instanceof Error ? err.message : String(err), failed: true })
    } finally {
      setBusy(false)
    }
  }

  const move = async (to: RefileTargetInfo, date?: string) => {
    if (!note) return
    setMoving(false)
    setBusy(true)
    setSaid(null)
    try {
      const r = await refileNote(path, at, note.title, to.name, date)
      navigate(noteHrefOf(r.path, r.at), { replace: true })
      setSaid({ text: `Moved to ${to.label}${date ? ` for ${date}` : ''}.` })
    } catch (err) {
      setSaid({ text: err instanceof Error ? err.message : String(err), failed: true })
    } finally {
      setBusy(false)
    }
  }

  const changePriority = async (priority: string) => {
    if (!note || busy) return
    setPrioritising(false)
    setBusy(true)
    setSaid(null)
    try {
      const r = await setNotePriority(path, at, note.title, priority)
      setSaid({ text: r.priority ? `Priority ${r.priority}.` : 'No priority.' })
      if (r.at !== at) navigate(noteHrefOf(r.path, r.at), { replace: true })
      else setReload((n) => n + 1)
    } catch (err) {
      setSaid({ text: err instanceof Error ? err.message : String(err), failed: true })
    } finally {
      setBusy(false)
    }
  }

  const changeDate = async (date: string, time: string) => {
    if (!note || !dating) return
    const { kind } = dating
    setDating(null)
    setBusy(true)
    setSaid(null)
    try {
      // An untouched time is left out, so a range (19:00-20:00) survives.
      const r = await setNoteDate(path, at, note.title, kind, date, time === dating.time ? undefined : time)
      const what = kind === 'deadline' ? 'Deadline' : 'Scheduled'
      setSaid({ text: r.date ? `${what} for ${r.date}${r.time ? ` at ${r.time}` : ''}.` : `${what} date removed.` })
      if (r.at !== at) navigate(noteHrefOf(r.path, r.at), { replace: true })
      else setReload((n) => n + 1)
    } catch (err) {
      setSaid({ text: err instanceof Error ? err.message : String(err), failed: true })
    } finally {
      setBusy(false)
    }
  }

  // A heading's own line carries its state; the page title shows it once.
  const head = note && at ? parseHeading(note.text.split('\n', 1)[0].replace(/^\*+\s+/, ''), new Set([...fileStates.open, ...fileStates.done])) : null
  const where = path.replace(/^roam\//, '').replace(/\.org$/, '')
  const editable = meta.editable.has(path)
  const datable = !!note && !!head && editable
  const stamps = note && at ? planStamps(ownPlanning(note.text)) : []

  return (
    <div className="page note-page">
      {/* The conversation's title bar (thread.tsx): the title has the first
          row to itself; ←, where the note lives and the play key sit under it. */}
      <header className="bar thread-bar note-bar">
        <div className="note-bar-text">
          <h1>
            {head && <StateBadge state={head.state} />} {note?.title || where}
          </h1>
          <div className="thread-sub">
            <button className="icon back" onClick={goBack} title="Back" aria-label="Back">
              ←
            </button>
            <span className="thread-project">{at ? `${where} · line ${at}` : where}</span>
            {note && (
              <button className="msg-key note-play" onClick={() => void say()} title="Read aloud" aria-label="Read aloud">
                <IconPlay />
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <p className="notice error">
          {error.changed ? 'This note changed since the list was drawn. ' : ''}
          {error.changed ? <Link to="/organiser">Back to the list</Link> : error.text}
        </p>
      )}
      {said && <p className={said.failed ? 'notice error' : 'notice'}>{said.text}</p>}
      {note && head && editable && (
        <div className="note-actions">
          {[...fileStates.open, doneWord].map((st) => (
            <button key={st} className={head.state === st ? 'state-key on' : 'state-key'} disabled={busy || head.state === st} onClick={() => void changeState(st)}>
              {st === doneWord ? '✓ Done' : st}
            </button>
          ))}
          {!stamps.some((st) => st.kind === 'SCHEDULED') && (
            <button className="state-key" disabled={busy} onClick={() => setDating({ kind: 'scheduled', date: '', time: '' })}>
              Schedule…
            </button>
          )}
          <button className={head.priority ? 'state-key prio-set' : 'state-key'} disabled={busy} onClick={() => setPrioritising(true)}>
            {head.priority ? `Priority ${head.priority}` : 'Priority…'}
          </button>
          <button className="state-key move" disabled={busy} onClick={() => setMoving(true)}>
            Move to…
          </button>
        </div>
      )}
      {prioritising && head && <PrioritySheet current={head.priority} onPick={(p) => void changePriority(p)} onClose={() => setPrioritising(false)} />}
      {moving && <MoveSheet from={path} onMove={(to, date) => void move(to, date)} onClose={() => setMoving(false)} />}
      {dating && <DateSheet {...dating} onSave={(date, time) => void changeDate(date, time)} onClose={() => setDating(null)} />}
      {!note && !error && <p className="notice">Loading…</p>}

      {note && (
        <article className="note-body">
          <OrgBody
            text={note.text}
            links={note.links}
            skipFirstHeading={!!at}
            onDate={datable && !busy ? (st) => st.kind !== 'CLOSED' && setDating({ kind: st.kind === 'DEADLINE' ? 'deadline' : 'scheduled', date: st.date, time: st.time }) : undefined}
          />
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
