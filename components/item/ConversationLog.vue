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
      <!-- A collapsed transcript still says when a reply is being worked on. -->
      <span v-if="thinking" class="thinking-dot ml-2" title="Claude is replying" />
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

      <!--
        The thinking line. Shown while the last thing said was the listener's
        (server `pending`) or a reply has just been accepted and no turn has
        rendered yet (local `awaiting`). It is not a real line — it carries no
        position and cannot be tapped — so it is kept out of the `lines` list
        and drawn on its own.
      -->
      <div v-if="thinking" class="w-full flex mb-2 justify-start">
        <div class="max-w-[85%] rounded-lg px-3 py-2 bg-bg">
          <div class="flex items-center pb-0.5">
            <p class="text-xs text-fg-muted">Claude</p>
          </div>
          <p class="text-sm flex items-center">
            <span class="thinking-dot" />
            <span class="thinking-dot" />
            <span class="thinking-dot" />
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// The idle cadence, when nothing is in flight: a turn takes longer than this
// to render and publish, so anything faster would mostly ask the same question
// twice.
const POLL_IDLE_MS = 15000
// The cadence while a reply is being worked on. Fast enough that the answer
// lands a second or two after it is said instead of waiting out an idle poll —
// which was the whole complaint. Cheap: the log is derived on demand and the
// payload is small.
const POLL_FAST_MS = 2000
// Keep the fast cadence for a short while after the transcript last CHANGED,
// so a reply that is still growing (and the moment right after it settles)
// stays snappy no matter who started the turn or how it arrived.
const FAST_LINGER_MS = 20 * 1000
// A ceiling on the fast cadence while merely waiting (pending, but nothing
// changing), so a reply that never comes drops back to idle rather than
// polling fast forever.
const FAST_WINDOW_MS = 3 * 60 * 1000

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
      // From the server: the last thing said was the listener's, so an answer
      // is still to come.
      pending: false,
      // Local: a reply was just accepted. record_listener_turn renders it on a
      // background thread a beat later, so for that beat neither the listener's
      // line nor `pending` is here yet — this bridges the gap so the indicator
      // shows the instant Send is pressed.
      awaiting: false,
      // When the transcript last changed, and a cheap signature to detect it.
      // Any change re-arms the fast cadence, so a turn arriving by ANY route —
      // a reply from the app, a message typed elsewhere, a turn spoken on the
      // host — is picked up promptly, not only ones this page sent itself.
      lastChangeAt: 0,
      lastSig: ''
    }
  },
  computed: {
    thinking() {
      return this.awaiting || this.pending
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
        const lines = res?.lines || []
        // A reply we were waiting for has landed once Claude has the last word
        // again. Clear the local bridge; `pending` then carries any real wait.
        if (this.awaiting && lines.length && lines[lines.length - 1].who !== 'you') {
          this.awaiting = false
        }
        // A cheap signature of what is on screen — count plus the last line —
        // catches a new turn and a growing reply alike. Any change re-arms the
        // fast cadence (see nextDelay), which is what makes a turn from any
        // source show up promptly instead of waiting out an idle poll.
        const last = lines[lines.length - 1]
        const sig = lines.length + '|' + (last ? last.who + ':' + last.text : '')
        if (sig !== this.lastSig) {
          this.lastSig = sig
          this.lastChangeAt = Date.now()
        }
        this.lines = lines
        this.pending = !!res?.pending
        // The page hides upstream's chapters table while this is up.
        this.$emit('has-log', this.lines.length > 0)
      } catch (error) {
        if (quiet) return
        // Not a conversation, not allowed, or no canvas: show nothing.
        this.lines = []
      }
    },
    refresh() {
      this.fetchLog({ quiet: true })
    },
    // Called by the page when a reply has been accepted. Show the indicator at
    // once and drop into the fast cadence until the answer lands.
    replied() {
      this.awaiting = true
      this.lastChangeAt = Date.now()   // treat the send as activity
      this.refresh()
      this.reschedule()
    },
    // The next poll's delay, chosen each tick. Fast right after any change
    // (a reply still arriving, whoever sent it), and fast while waiting on an
    // answer up to a ceiling so a reply that never comes still falls back to
    // idle. Otherwise idle.
    nextDelay() {
      const since = Date.now() - this.lastChangeAt
      if (since < FAST_LINGER_MS) return POLL_FAST_MS
      if (this.thinking && since < FAST_WINDOW_MS) return POLL_FAST_MS
      return POLL_IDLE_MS
    },
    reschedule() {
      this.stopPolling()
      this.startPolling()
    },
    // Only while the page is actually being looked at. A conversation the
    // reader has left is not worth a request every fifteen seconds, and on a
    // backgrounded app they would queue up and all fire at once on resume.
    // setTimeout, not setInterval, so the cadence can change between ticks.
    startPolling() {
      if (this.timer || !this.lines.length) return
      const tick = async () => {
        this.timer = null
        await this.refresh()
        // Keep the fast window honest: once it lapses, thinking stays true only
        // if the server still says pending, and the delay stretches back out.
        this.timer = window.setTimeout(tick, this.nextDelay())
      }
      this.timer = window.setTimeout(tick, this.nextDelay())
    },
    stopPolling() {
      if (!this.timer) return
      window.clearTimeout(this.timer)
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
      this.baseUrl = await this.$localStore.agentMediaBaseUrl(this.$store.state.user.serverConnectionConfig?.address)
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
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
  }
}
</script>

<style scoped>
/* A small pulsing dot: one beside the title when collapsed, three in a row for
   the thinking line. Reuses the app's foreground colour so it works in any
   theme. */
.thinking-dot {
  display: inline-block;
  width: 0.4rem;
  height: 0.4rem;
  margin-right: 0.25rem;
  border-radius: 9999px;
  background-color: currentColor;
  opacity: 0.35;
  animation: thinking-pulse 1.2s ease-in-out infinite;
}
.thinking-dot:nth-child(2) {
  animation-delay: 0.2s;
}
.thinking-dot:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes thinking-pulse {
  0%, 80%, 100% {
    opacity: 0.25;
    transform: scale(0.8);
  }
  40% {
    opacity: 0.9;
    transform: scale(1);
  }
}
</style>
