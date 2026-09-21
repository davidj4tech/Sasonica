/**
 * Sasonica: what a new chat can be pointed at.
 *
 * The canvas answers this in one call (`GET /targets`): `places` are the
 * directories sessions have actually run in — newest first, the one a session
 * is running in right now ahead of the rest — and `sessions` are the
 * conversations running or lately shelved.
 *
 * It used to be worked out here, from the series of an Audiobookshelf library
 * that had to be named Conversations. That was this desk's setup, not the
 * app's business: another canvas answers with its own directories and nothing
 * here changes.
 *
 * @param {Vue} vm - any component (for `$store`, `$localStore`, `$nativeHttp`)
 * @param {number} [limit=6] - how many places to keep; 0 for all of them
 * @returns {Promise<{places: object[], sessions: object[]}>} empty lists when
 *          there is no canvas configured, or it cannot be reached
 */
export async function fetchTargets(vm, limit = 6) {
  const empty = { places: [], sessions: [] }
  const token = vm.$store.getters['user/getToken']
  if (!token) return empty
  const base = await vm.$localStore.agentMediaBaseUrl(vm.$store.state.user.serverConnectionConfig?.address)
  if (!base) return empty
  try {
    const res = await vm.$nativeHttp.request('GET', `${base}/targets`, null, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const places = res?.places || []
    return { places: limit > 0 ? places.slice(0, limit) : places, sessions: res?.sessions || [] }
  } catch (error) {
    // No canvas, or one too old to know the route: the list is simply empty.
    console.error('[sasonica] failed to fetch targets', error)
    return empty
  }
}
