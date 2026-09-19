// Sasonica: an update puts you back on the page you were reading.
//
// Installing a new build kills the app, and it starts again on the bookshelf,
// so every deploy lost your place. The page is remembered on each navigation
// along with the build that showed it; the first start of a different build
// goes back there. An ordinary start of the same build is left alone, the way
// upstream behaves. Fork-only file.

const KEY = 'sasonica.resume-page'

function load() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || 'null')
  } catch (error) {
    return null
  }
}

function save(page) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(page))
  } catch (error) {
    // No storage: an update lands on the bookshelf, as it always did.
  }
}

export default ({ app, store }) => {
  const build = process.env.SASONICA_BUILD || ''
  if (!build || !app.router) return

  const saved = load()
  let restoring = !!(saved && saved.path && saved.build && saved.build !== build)

  app.router.afterEach((to) => {
    // Until the restore has happened, the start-up bookshelf is not where
    // you were.
    if (restoring) return
    save({ path: to.fullPath, build })
  })

  if (!restoring) return
  // Pages fetch from the server, so go back once the connection is made.
  const unwatch = store.watch(
    (state) => state.user.accessToken,
    (token) => {
      if (!token || !restoring) return
      restoring = false
      // Not unwatched here: with `immediate` this can run before
      // store.watch has returned.
      window.setTimeout(() => unwatch(), 0)
      if (app.router.currentRoute.fullPath !== saved.path) {
        app.router.replace(saved.path).catch(() => {})
      }
      save({ path: saved.path, build })
    },
    { immediate: true }
  )
}
