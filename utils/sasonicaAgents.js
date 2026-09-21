/**
 * Sasonica: getting an agent onto the desk, and signing into it, from here.
 *
 * A new chat can be pointed at Claude, Codex, pi or Hermes — as long as the
 * harness is installed on that host and signed in. Those two things were the
 * last that could only be done at the desk, and they are the two you notice
 * from an armchair: a fresh machine, or a token that expired overnight.
 *
 * The canvas answers all of it (`agents.py`): `GET /harnesses` is the state of
 * the four, `POST /harnesses/run` opens the install or the sign-in in a tmux
 * window on that host, and `/harnesses/screen` and `/harnesses/keys` are that
 * window's screen and keyboard — enough to paste an OAuth code back. Only
 * windows the canvas opened for this can be read or typed into; it is not a
 * terminal.
 */

async function canvas(vm, method, route, body) {
  const token = vm.$store.getters['user/getToken']
  if (!token) return null
  const base = await vm.$localStore.agentMediaBaseUrl(vm.$store.state.user.serverConnectionConfig?.address)
  if (!base) return null
  try {
    return await vm.$nativeHttp.request(method, `${base}${route}`, body || null, {
      headers: { Authorization: `Bearer ${token}` }
    })
  } catch (error) {
    // No canvas, or one too old to know the route.
    console.error('[sasonica] agents call failed', route, error)
    return null
  }
}

/**
 * The four harnesses and what each needs.
 * @returns {Promise<object[]>} `[{name, present, version, auth, account,
 *          actions, installed_action}]`; empty when there is no canvas.
 */
export async function fetchAgents(vm) {
  const res = await canvas(vm, 'GET', '/harnesses')
  return res?.agents || []
}

/**
 * Install (or update) an agent, or sign into it.
 * @param {string} agent - claude | codex | pi | hermes
 * @param {string} action - install | login
 * @returns {Promise<object|null>} `{pane, cmd}` — the window it opened
 */
export async function runAgentAction(vm, agent, action) {
  const res = await canvas(vm, 'POST', '/harnesses/run', { agent, action })
  return res?.ok ? res : null
}

/** That window's screen: `{lines, done, exit}`, or null when it is gone. */
export async function agentScreen(vm, pane) {
  const res = await canvas(vm, 'GET', `/harnesses/screen?pane=${encodeURIComponent(pane)}`)
  return res?.ok ? res : null
}

/** Type into it — a pasted code, a y, a bare Enter. */
export async function agentKeys(vm, pane, text, key) {
  const res = await canvas(vm, 'POST', '/harnesses/keys', { pane, text: text || '', key: key || '' })
  return !!res?.ok
}

/** End the window. */
export async function closeAgentWindow(vm, pane) {
  const res = await canvas(vm, 'POST', '/harnesses/close', { pane })
  return !!res?.ok
}
