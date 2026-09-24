import { useSpeech } from '../hooks/useSpeech'

export type PlayingState = 'speaking' | 'paused' | 'queued'

/**
 * Where a conversation stands with the voice, from the app's one /speech/now
 * poll: being said, paused mid-reply, or with a reply waiting its turn.
 * null when the voice has nothing of it.
 */
export function usePlaying(session: string | undefined): PlayingState | null {
  const { now } = useSpeech()
  if (!session || !now) return null
  if (now.live && now.session === session) return now.paused ? 'paused' : 'speaking'
  if (now.queued?.some((q) => q.session === session)) return 'queued'
  return null
}

const LABEL: Record<PlayingState, string> = {
  speaking: 'Speaking now',
  paused: 'Paused',
  queued: 'Reply waiting to be said'
}

/** Three bars that move while this conversation is being said. */
export function PlayingMark({ session }: { session: string | undefined }) {
  const state = usePlaying(session)
  if (!state) return null
  return (
    <span className={`playing-mark ${state}`} role="img" aria-label={LABEL[state]} title={LABEL[state]}>
      <i />
      <i />
      <i />
    </span>
  )
}
