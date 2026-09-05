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
export default {
  props: {
    libraryItemId: String
  },
  data() {
    return {
      baseUrl: '',
      lines: [],
      expanded: true
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
    async init() {
      this.baseUrl = (await this.$localStore.getAgentMediaUrl()) || this.defaultBaseUrl
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
        // Not a conversation, not allowed, or no canvas: show nothing.
        this.lines = []
      }
    }
  },
  mounted() {
    this.init()
  }
}
</script>
