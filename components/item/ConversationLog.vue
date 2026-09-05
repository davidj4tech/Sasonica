<template>
  <!--
    Sasonica: the conversation as a chat log.

    The chapters table answers "where am I" — one sentence per turn, which is
    what a table of contents is for. It cannot answer "what was said", and on a
    conversation that is the more interesting question. Same rows, read instead
    of heard: the server joins the manifest to speech history and hands back
    whole turns with their positions, so nothing here is a second copy of
    anything.

    Upstream's ChaptersTable is untouched; the item page hides it while this is
    showing, because two lists of the same turns is worse than either.
  -->
  <div v-if="lines.length" class="w-full my-4">
    <div class="w-full bg-primary px-4 py-2 flex items-center" :class="expanded ? 'rounded-t-md' : 'rounded-md'" @click.stop="expanded = !expanded">
      <p class="pr-2">Transcript</p>
      <div class="h-6 w-6 rounded-full bg-fg/10 flex items-center justify-center">
        <span class="text-xs font-mono">{{ lines.length }}</span>
      </div>
      <div class="flex-grow" />
      <div class="h-10 w-10 rounded-full flex justify-center items-center duration-500" :class="expanded ? 'transform rotate-180' : ''">
        <span class="material-symbols text-3xl">arrow_drop_down</span>
      </div>
    </div>

    <div v-show="expanded" class="w-full bg-primary/40 rounded-b-md px-2 py-3">
      <div v-for="(line, index) in lines" :key="index" class="w-full flex mb-2" :class="line.who === 'you' ? 'justify-end' : 'justify-start'">
        <div class="max-w-[85%] rounded-lg px-3 py-2" :class="line.who === 'you' ? 'bg-info/20' : 'bg-bg'" @click="play(line)">
          <div class="flex items-center pb-0.5">
            <p class="text-xs text-fg-muted">{{ line.who === 'you' ? 'You' : 'Claude' }}</p>
            <p v-if="line.start != null" class="text-xs font-mono text-fg-muted underline pl-2">{{ $secondsToTimestamp(line.start) }}</p>
          </div>
          <p class="text-sm whitespace-pre-line">{{ line.text }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// How often the log re-asks while the page is up. A turn takes longer than
// this to render and publish, so anything faster would mostly ask the same
// question twice.
const POLL_MS = 15000
// After a reply is sent, the turn appears once record_listener_turn has
// rendered it — a second or two, on a background thread. These are the
// catch-up asks, so it lands without waiting out a whole poll.
const AFTER_REPLY_MS = [1500, 4000, 9000]

export default {
  props: {
    libraryItemId: String
  },
  data() {
    return {
      baseUrl: '',
      lines: [],
      expanded: true,
      timer: null,
      catchUp: []
    }
  },
  computed: {
    defaultBaseUrl() {
      const address = this.$store.state.user.serverConnectionConfig?.address || ''
      if (!address) return ''
      try {
        const url = new URL(address)
        url.port = '8781'
        return url.origin
      } catch (error) {
        return ''
      }
    }
  },
  methods: {
    play(line) {
      // Tapping a line plays from it, the same move the chapters table makes.
      if (line.start == null) return
      this.$emit('playAtTimestamp', line.start)
    },
    // One ask. `quiet` is a refresh rather than the first look: a transient
    // failure then means the network blinked, not that this stopped being a
    // conversation, and blanking a transcript the reader is part-way through
    // would be worse than showing one that is a few seconds old.
    async fetchLog({ quiet = false } = {}) {
      if (!this.baseUrl || !this.libraryItemId) return
      try {
        const token = this.$store.getters['user/getToken']
        const res = await this.$nativeHttp.request('GET', `${this.baseUrl}/conversation/log?item=${this.libraryItemId}`, null, {
          headers: { Authorization: `Bearer ${token}` }
        })
        this.lines = res?.lines || []
        // The page hides upstream's chapters table while this is up.
        this.$emit('has-log', this.lines.length > 0)
      } catch (error) {
        if (quiet) return
        // Not a conversation, not allowed, or no canvas: show nothing.
        this.lines = []
      }
    },
    // Called by the page when a reply has been accepted, and used by the poll.
    refresh() {
      this.fetchLog({ quiet: true })
    },
    replied() {
      this.clearCatchUp()
      this.catchUp = AFTER_REPLY_MS.map((ms) => window.setTimeout(this.refresh, ms))
    },
    clearCatchUp() {
      this.catchUp.forEach((id) => window.clearTimeout(id))
      this.catchUp = []
    },
    // Only while the page is actually being looked at. A conversation the
    // reader has left is not worth a request every fifteen seconds, and on a
    // backgrounded app they would queue up and all fire at once on resume.
    startPolling() {
      if (this.timer || !this.lines.length) return
      this.timer = window.setInterval(this.refresh, POLL_MS)
    },
    stopPolling() {
      if (!this.timer) return
      window.clearInterval(this.timer)
      this.timer = null
    },
    onVisibilityChange() {
      if (document.hidden) {
        this.stopPolling()
      } else {
        this.refresh()
        this.startPolling()
      }
    },
    async init() {
      this.baseUrl = (await this.$localStore.getAgentMediaUrl()) || this.defaultBaseUrl
      if (!this.baseUrl || !this.libraryItemId) return
      await this.fetchLog()
      this.startPolling()
    }
  },
  mounted() {
    this.init()
    document.addEventListener('visibilitychange', this.onVisibilityChange)
  },
  beforeDestroy() {
    this.stopPolling()
    this.clearCatchUp()
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
  }
}
</script>
