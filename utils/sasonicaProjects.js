/**
 * Sasonica: the projects a new chat can open in.
 *
 * A project is a series in the Conversations library — the directory its
 * conversations ran in. Asked for by name, not id: that is what `/ask` takes.
 *
 * @param {Vue} vm - any component (for `$store` and `$nativeHttp`)
 * @returns {Promise<string[]>} project names, or [] when there is no such library
 */
export async function fetchProjects(vm) {
  const library = (vm.$store.state.libraries.libraries || []).find((lib) => (lib.name || '').trim().toLowerCase() === 'conversations')
  if (!library) return []
  const payload = await vm.$nativeHttp.get(`/api/libraries/${library.id}/series?limit=200&page=0&minified=1`).catch((error) => {
    console.error('[sasonica] failed to fetch projects', error)
    return null
  })
  return (payload?.results || []).map((series) => series.name).filter((name) => !!name)
}
