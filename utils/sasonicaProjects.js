/**
 * Sasonica: the projects a new chat can open in.
 *
 * A project is a series in the Conversations library — the directory its
 * conversations ran in. Asked for by name, not id: that is what `/ask` takes.
 *
 * There are more of them than belong in a menu, and the interesting ones are
 * the ones lately talked in, so they come back newest-first by their most
 * recently touched conversation (a live one is touched all the time) and only
 * the first few are handed back. The rest are on the Projects shelf.
 *
 * @param {Vue} vm - any component (for `$store` and `$nativeHttp`)
 * @param {number} [limit=6] - how many to keep; 0 for all of them
 * @returns {Promise<string[]>} project names, or [] when there is no such library
 */
export async function fetchProjects(vm, limit = 6) {
  const library = (vm.$store.state.libraries.libraries || []).find((lib) => (lib.name || '').trim().toLowerCase() === 'conversations')
  if (!library) return []
  const payload = await vm.$nativeHttp.get(`/api/libraries/${library.id}/series?limit=200&page=0&minified=1`).catch((error) => {
    console.error('[sasonica] failed to fetch projects', error)
    return null
  })
  const series = (payload?.results || []).filter((s) => !!s.name)
  series.sort((a, b) => lastTouched(b) - lastTouched(a))
  const names = series.map((s) => s.name)
  return limit > 0 ? names.slice(0, limit) : names
}

function lastTouched(series) {
  return (series.books || []).reduce((latest, book) => Math.max(latest, book.updatedAt || book.addedAt || 0), series.updatedAt || 0)
}
