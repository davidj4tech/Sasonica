/**
 * Exit and Archive (§6.4): optimistic everywhere (lib/sessionFlags.ts),
 * then POST /session/close or /session/archive, rolled back if the server
 * refuses. On success the saved list and the rows seen in this page load
 * are patched, so a cold start (or the next thread page) agrees.
 *
 * Exit & archive is two requests, close then archive (§6.4: "archiving ends
 * nothing"); a refused close stops there, archiving nothing.
 *
 * Move (§6.15) is not optimistic: it restarts a running session, so what the
 * row says waits for the server to say it happened.
 */
import { useCallback } from 'react'
import { archiveSession, closeSession, moveSession } from '../api'
import { clearArchivedOverride, clearEnded, setArchivedOverride, setEnded, setProjectOverride } from '../lib/sessionFlags'
import { patchTargetRow } from '../lib/snapshots'
import { noteRow } from './useThreads'

export interface ActionOutcome {
  ok: boolean
  /** What to say, quietly. */
  message: string
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function exit(session: string): Promise<ActionOutcome> {
  setEnded(session)
  try {
    const res = await closeSession(session)
    patchTargetRow(session, { live: false, pane: null })
    noteRow(session, { live: false, pane: null })
    return { ok: true, message: res.closed ? 'Session ended. Send a message to resume it.' : 'The session was not running.' }
  } catch (err) {
    clearEnded(session)
    return { ok: false, message: `Not ended: ${why(err)}` }
  }
}

async function archive(session: string, archived: boolean): Promise<ActionOutcome> {
  setArchivedOverride(session, archived)
  try {
    const res = await archiveSession(session, archived)
    patchTargetRow(session, { archived: res.archived })
    noteRow(session, { archived: res.archived })
    return { ok: true, message: res.archived ? 'Archived.' : 'Unarchived.' }
  } catch (err) {
    clearArchivedOverride(session)
    return { ok: false, message: `${archived ? 'Not archived' : 'Not unarchived'}: ${why(err)}` }
  }
}

async function move(session: string, project: string): Promise<ActionOutcome> {
  try {
    const res = await moveSession(session, { project })
    setProjectOverride(session, res.project)
    patchTargetRow(session, { project: res.project, cwd: res.cwd })
    noteRow(session, { project: res.project, cwd: res.cwd })
    // Its files could not follow (§6.15): the thread moved, so this is not a
    // failure — but it is the one thing about a move worth hearing about.
    if (res.folder_error) return { ok: false, message: `Moved to ${project}, but its files stayed put: ${res.folder_error}` }
    return {
      ok: true,
      message: res.restarted ? `Moved to ${project}. The session restarted there.` : `Moved to ${project}.`
    }
  } catch (err) {
    return { ok: false, message: `Not moved: ${why(err)}` }
  }
}

async function exitAndArchive(session: string): Promise<ActionOutcome> {
  // Both show at once; the archive waits for the close to be accepted.
  setArchivedOverride(session, true)
  const closed = await exit(session)
  if (!closed.ok) {
    clearArchivedOverride(session)
    return closed
  }
  const filed = await archive(session, true)
  return filed.ok ? { ok: true, message: 'Session ended and archived.' } : { ok: false, message: `Ended, but ${filed.message[0].toLowerCase()}${filed.message.slice(1)}` }
}

export function useSessionActions() {
  return {
    exit: useCallback(exit, []),
    archive: useCallback(archive, []),
    move: useCallback(move, []),
    exitAndArchive: useCallback(exitAndArchive, [])
  }
}
