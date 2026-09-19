// Sasonica: agent-media tags a conversation `archived` once its session has
// been closed and quiet for a week (or when archived from the item menu).
// Archived items are hidden from the shelves, unless the archived tag is the
// filter being looked at, or Archived is ticked in the bookshelf's menu.

export const ARCHIVED_TAG = 'archived'

export function isArchived(entity) {
  const tags = entity?.media?.tags
  return Array.isArray(tags) && tags.includes(ARCHIVED_TAG)
}

// A series is a project: hidden once every conversation in it is archived.
export function seriesIsArchived(series) {
  const books = series?.books || []
  return books.length > 0 && books.every(isArchived)
}

export function libraryArchives(store) {
  const tags = store.state.libraries.filterData?.tags || []
  return tags.includes(ARCHIVED_TAG)
}

// The bookshelf's Show menu (BookshelfToolbar): archived conversations are
// shown or not, and the list can be narrowed to live sessions, or to what
// they are doing — the canvas's /sessions/state, polled while the shelf is
// on screen. With none of the narrowing ones on, nothing is narrowed.
export const SHOW_ARCHIVED = 'sasonicaShowArchived'
export const NARROWING = [
  { key: 'sasonicaOnlyLive', text: 'Live', state: null },
  { key: 'sasonicaOnlyWorking', text: 'Working', state: 'working' },
  { key: 'sasonicaOnlyWaiting', text: 'Waiting on you', state: 'waiting' },
  { key: 'sasonicaOnlyApproval', text: 'Needs approval', state: 'approval' }
]

export function showMenuItems(settings, archives) {
  const box = (on) => (on ? 'check_box' : 'check_box_outline_blank')
  const items = NARROWING.map((f) => ({ text: f.text, value: `sasonica:${f.key}`, icon: box(settings[f.key]) }))
  if (archives) items.push({ text: 'Archived', value: `sasonica:${SHOW_ARCHIVED}`, icon: box(settings[SHOW_ARCHIVED]) })
  return items
}

function showSignature(settings) {
  return [SHOW_ARCHIVED, ...NARROWING.map((f) => f.key)].map((k) => (settings?.[k] ? 1 : 0)).join('')
}

const STATES_POLL_MS = 5000

// For LazyBookshelf: the server cannot leave a tag out, or know what a
// session is doing, so a library that needs either is fetched whole and
// filtered here. A conversations library is a few hundred items at most; a
// library with no archived tag and no narrowing never gets here.
export default {
  data() {
    return {
      sasonicaAll: null,
      sasonicaReuse: false,
      sasonicaShown: showSignature(null),
      sasonicaBase: '',
      sasonicaTimer: null
    }
  },
  computed: {
    sasonicaIsConversations() {
      return this.$store.getters['libraries/getCurrentLibraryIsConversations']
    },
    sasonicaNarrowing() {
      if (!this.sasonicaIsConversations) return []
      const settings = this.$store.state.user.settings
      return NARROWING.filter((f) => settings[f.key])
    },
    sasonicaHidesArchived() {
      if (!libraryArchives(this.$store)) return false
      if (this.$store.state.user.settings[SHOW_ARCHIVED]) return false
      return this.page === 'series' || this.filterBy !== `tags.${this.$encode(ARCHIVED_TAG)}`
    },
    hidesArchived() {
      if (!['books', 'series-books', 'series'].includes(this.entityName)) return false
      return this.sasonicaHidesArchived || this.sasonicaNarrowing.length > 0
    },
    sessionStates() {
      return this.$store.state.sasonica.sessionStates
    }
  },
  watch: {
    sessionStates() {
      if (!this.sasonicaNarrowing.length || !this.initialized || !this.sasonicaAll) return
      const want = this.sasonicaFilter(this.sasonicaAll).map((e) => e.id)
      const have = this.entities.map((e) => e && e.id)
      if (want.join() !== have.join()) this.sasonicaRefilter()
    }
  },
  methods: {
    sasonicaKeepBook(book) {
      if (this.sasonicaHidesArchived && isArchived(book)) return false
      if (!this.sasonicaNarrowing.length) return true
      const state = this.$store.getters['sasonica/getSessionState'](book.path)
      const live = !!state || (book.media?.tags || []).includes('live')
      return this.sasonicaNarrowing.some((f) => (f.state ? state === f.state : live))
    },
    sasonicaFilter(results) {
      if (this.entityName !== 'series') return results.filter(this.sasonicaKeepBook)
      return results.filter((series) => {
        if (this.sasonicaHidesArchived && seriesIsArchived(series)) return false
        return !this.sasonicaNarrowing.length || (series.books || []).some(this.sasonicaKeepBook)
      })
    },
    // Filter again what was fetched: a session changing what it is doing is
    // no reason to ask the server for the library again.
    sasonicaRefilter() {
      this.sasonicaReuse = !!this.sasonicaAll
      this.resetEntities()
    },
    async fetchUnarchived() {
      if (this.initialized) return
      this.isFetchingEntities = true
      if (!this.initialized) this.currentSFQueryString = this.buildSearchParams()
      let results = this.sasonicaReuse ? this.sasonicaAll : null
      this.sasonicaReuse = false
      if (!results) {
        const sf = this.currentSFQueryString ? this.currentSFQueryString + '&' : ''
        const path = this.entityName === 'series' ? 'series' : 'items'
        const payload = await this.$nativeHttp.get(`/api/libraries/${this.currentLibraryId}/${path}?${sf}limit=1000&page=0&minified=1&include=rssfeed,numEpisodesIncomplete`).catch((error) => {
          console.error('[sasonica] failed to fetch unarchived', error)
          return null
        })
        results = payload?.results || null
        this.sasonicaAll = results
      }
      this.isFetchingEntities = false
      if (this.pendingReset) {
        this.pendingReset = false
        this.resetEntities()
        return
      }
      if (!results) return
      const entities = this.sasonicaFilter(results)
      this.initialized = true
      this.entities = entities
      this.totalEntities = entities.length
      this.totalShelves = Math.ceil(this.totalEntities / this.entitiesPerShelf)
      this.$eventBus.$emit('bookshelf-total-entities', this.totalEntities)
      entities.forEach((entity, index) => {
        const ref = this.entityComponentRefs[index]
        if (!ref) return
        ref.setEntity(entity)
        if (this.isBookEntity) {
          const lli = this.localLibraryItems.find((l) => l.libraryItemId == entity.id)
          if (lli) ref.setLocalLibraryItem(lli)
        }
      })
    },
    sasonicaSettingsUpdated(settings) {
      const shown = showSignature(settings)
      if (shown === this.sasonicaShown) return
      this.sasonicaShown = shown
      // A sort or filter change refetches anyway, in the shelf's own handler.
      if (this.buildSearchParams() !== this.currentSFQueryString) return
      this.sasonicaRefilter()
    },
    async pollSessionStates() {
      if (document.hidden || !this.sasonicaIsConversations) return
      const token = this.$store.getters['user/getToken']
      if (!token) return
      if (!this.sasonicaBase) {
        this.sasonicaBase = await this.$localStore.agentMediaBaseUrl(this.$store.state.user.serverConnectionConfig?.address)
        if (!this.sasonicaBase) return
      }
      try {
        const res = await this.$nativeHttp.request('GET', `${this.sasonicaBase}/sessions/state`, null, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res && res.ok) this.$store.commit('sasonica/setSessionStates', res.sessions)
      } catch (error) {
        // No canvas, or an older one: cards keep the live tag's dot.
      }
    }
  },
  mounted() {
    this.sasonicaShown = showSignature(this.$store.state.user.settings)
    this.$eventBus.$on('user-settings', this.sasonicaSettingsUpdated)
    this.pollSessionStates()
    this.sasonicaTimer = window.setInterval(this.pollSessionStates, STATES_POLL_MS)
  },
  beforeDestroy() {
    this.$eventBus.$off('user-settings', this.sasonicaSettingsUpdated)
    window.clearInterval(this.sasonicaTimer)
    this.$store.commit('sasonica/setSessionStates', [])
  }
}

// Home shelves: archived conversations (and all-archived projects) come off,
// and a shelf left empty goes with them.
export function hideArchivedOnShelves(shelves) {
  return shelves
    .map((shelf) => {
      if (!Array.isArray(shelf.entities)) return shelf
      const hidden = shelf.type === 'series' ? seriesIsArchived : isArchived
      const entities = shelf.entities.filter((e) => !hidden(e))
      return entities.length === shelf.entities.length ? shelf : { ...shelf, entities }
    })
    .filter((shelf) => !Array.isArray(shelf.entities) || shelf.entities.length)
}

// For ItemMoreMenuModal: Archive / Unarchive on a server item in a library
// that archives, or on any conversation. The sweep in agent-media reads the
// tag as it finds it, so a hand here is never undone by it — a new turn in
// the conversation is what brings an archived one back.
export const archiveMenu = {
  computed: {
    archiveMenuItem() {
      if (this.isLocal || !this.serverLibraryItemId || this.isPodcast) return null
      if (!this.$store.getters['user/getUserCanUpdate']) return null
      if (!this.conversation && !libraryArchives(this.$store) && !isArchived(this.libraryItem)) return null
      return isArchived(this.libraryItem)
        ? { text: 'Unarchive', value: 'sasonica:unarchive', icon: 'unarchive' }
        : { text: 'Archive', value: 'sasonica:archive', icon: 'archive' }
    }
  },
  methods: {
    async setArchived(archived) {
      const media = this.libraryItem.media
      const tags = (media.tags || []).filter((t) => t !== ARCHIVED_TAG)
      if (archived) tags.push(ARCHIVED_TAG)
      this.$emit('update:processing', true)
      try {
        await this.$nativeHttp.patch(`/api/items/${this.serverLibraryItemId}/media`, { tags })
        this.$set(media, 'tags', tags)
        this.$toast.success(archived ? 'Archived' : 'Unarchived')
      } catch (error) {
        console.error('[sasonica] archive failed', error)
        this.$toast.error(archived ? 'Could not archive' : 'Could not unarchive')
      }
      this.$emit('update:processing', false)
    }
  }
}
