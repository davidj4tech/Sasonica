// Sasonica: what each live agent-media session is doing, from the canvas's
// /sessions/state — `{<author>/<title> folder tail: 'working' | 'waiting' |
// 'approval'}`. Filled only while a Conversations bookshelf is on screen, and
// emptied when it goes, so a card never shows a state nobody is refreshing.

export const state = () => ({
  sessionStates: {}
})

export const getters = {
  getSessionState: (state) => (path) => {
    const parts = String(path || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
    return state.sessionStates[parts.slice(-2).join('/')] || null
  }
}

export const mutations = {
  setSessionStates(state, rows) {
    const next = {}
    for (const row of rows || []) {
      if (row && row.tail) next[row.tail] = row.state
    }
    state.sessionStates = next
  }
}
