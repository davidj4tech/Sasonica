// Sasonica: agent-media tags a conversation `archived` once its session has
// been closed and quiet for a week (or when archived from the item menu).
// Archived items are hidden from the shelves, unless the archived tag is the
// filter being looked at, which is how they are found again.

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

// For LazyBookshelf: the server cannot leave a tag out, so a library that
// archives is fetched whole and filtered here. A conversations library is a
// few hundred items at most; a library with no archived tag never gets here.
export default {
  computed: {
    hidesArchived() {
      if (!['books', 'series-books', 'series'].includes(this.entityName)) return false
      if (!libraryArchives(this.$store)) return false
      return this.page === 'series' || this.filterBy !== `tags.${this.$encode(ARCHIVED_TAG)}`
    }
  },
  methods: {
    async fetchUnarchived() {
      if (this.initialized) return
      this.isFetchingEntities = true
      if (!this.initialized) this.currentSFQueryString = this.buildSearchParams()
      const sf = this.currentSFQueryString ? this.currentSFQueryString + '&' : ''
      const path = this.entityName === 'series' ? 'series' : 'items'
      const payload = await this.$nativeHttp.get(`/api/libraries/${this.currentLibraryId}/${path}?${sf}limit=1000&page=0&minified=1&include=rssfeed,numEpisodesIncomplete`).catch((error) => {
        console.error('[sasonica] failed to fetch unarchived', error)
        return null
      })
      this.isFetchingEntities = false
      if (this.pendingReset) {
        this.pendingReset = false
        this.resetEntities()
        return
      }
      if (!payload?.results) return
      const hidden = this.entityName === 'series' ? seriesIsArchived : isArchived
      const entities = payload.results.filter((e) => !hidden(e))
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
    }
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
