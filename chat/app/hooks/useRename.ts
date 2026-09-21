/**
 * Rename a thread: optimistic everywhere (lib/titles.ts), POST /rename
 * {session, title}, rolled back if the server refuses. The saved list is
 * patched on success so a cold start shows the new name too.
 */
import { useCallback } from 'react'
import { renameThread } from '../api'
import { clearTitleOverride, setTitleOverride } from '../lib/titles'
import { renameInTargets } from '../lib/snapshots'
import { noteRenamed } from './useThreads'

export interface RenameOutcome {
  ok: boolean
  /** What to say, quietly: "Renamed.", the server's `why`, or the refusal. */
  message: string
}

function sentence(why: string): string {
  const s = why.trim().replace(/\.$/, '')
  return s ? s[0].toUpperCase() + s.slice(1) + '.' : ''
}

export function useRename() {
  return useCallback(async (session: string, title: string): Promise<RenameOutcome> => {
    const name = title.trim()
    if (!name) return { ok: false, message: 'A name cannot be empty.' }
    setTitleOverride(session, name)
    try {
      const res = await renameThread(session, name)
      const final = res.title || name
      if (final !== name) setTitleOverride(session, final)
      renameInTargets(session, final)
      noteRenamed(session, final)
      // terminal:false is not a failure: the shelf has the name (§6.4).
      return { ok: true, message: res.terminal || !res.why ? 'Renamed.' : `Renamed. ${sentence(res.why)}` }
    } catch (err) {
      clearTitleOverride(session)
      return { ok: false, message: `Not renamed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }, [])
}
