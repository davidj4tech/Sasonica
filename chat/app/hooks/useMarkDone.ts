/**
 * Ticking a heading done from a list — the Organiser's rows and Home's
 * Agenda section. The row goes at once (`hidden`), the server rewrites the
 * file (/notes/state), and a toast says what happened: Undo for an ordinary
 * item, the next date for a repeating one (which is not closed; it moves
 * on). A refusal brings the row back and says why. `onChanged` is the
 * caller's refetch; `hidden` clears when the caller's list is replaced.
 */
import { useCallback, useState } from 'react'
import { setNoteState, type NoteHeading, type NoteState } from '../api/notes'

export interface DoneToast {
  text: string
  failed?: boolean
  undo?: () => void
}

const keyOf = (h: Pick<NoteHeading, 'path' | 'at'>) => `${h.path}:${h.at}`

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useMarkDone(onChanged: () => void) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [toast, setToast] = useState<DoneToast | null>(null)

  const markDone = useCallback(
    async (h: NoteHeading) => {
      const key = keyOf(h)
      setHidden((s) => new Set(s).add(key))
      setToast(null)
      try {
        const r = await setNoteState(h.path, h.at, h.title, 'DONE')
        if (r.repeated) setToast({ text: `${h.title} — next on ${r.next}` })
        else
          setToast({
            text: `Done: ${h.title}`,
            undo: () => {
              setToast(null)
              void setNoteState(r.path, r.at, h.title, h.state as NoteState)
                .then(onChanged)
                .catch((err) => setToast({ text: message(err), failed: true }))
            }
          })
      } catch (err) {
        setHidden((s) => {
          const next = new Set(s)
          next.delete(key)
          return next
        })
        setToast({ text: message(err), failed: true })
      }
      onChanged()
    },
    [onChanged]
  )

  return {
    markDone,
    isHidden: (h: Pick<NoteHeading, 'path' | 'at'>) => hidden.has(keyOf(h)),
    /** Call when a fresh list lands: what was hidden is gone from it anyway. */
    resetHidden: useCallback(() => setHidden(new Set()), []),
    toast,
    dismiss: useCallback(() => setToast(null), [])
  }
}
