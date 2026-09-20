/**
 * Sasonica: how a live session's state is drawn.
 *
 * One rule for every surface that shows it — the Conversations shelf's cards
 * and the new chat picker — because the dot is the whole signal, and two
 * copies of the mapping drift until the same session reads differently
 * depending on which list you found it in. The states are the canvas's
 * (`/sessions/state`): working, waiting, approval.
 */

const DOT_CLASS = { approval: 'bg-error', working: 'bg-warning animate-pulse' }
const DOT_TITLE = { working: 'working', waiting: 'waiting on you', approval: 'needs approval' }

export function sessionDotClass(state) {
  return DOT_CLASS[state] || 'bg-success'
}

export function sessionDotTitle(state) {
  return DOT_TITLE[state] || 'session running'
}
