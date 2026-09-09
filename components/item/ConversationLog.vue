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
  <!--
    Two shapes. `chat` is the conversation page: this IS the scrolling area,
    always open, opening at the newest turn and following the one being spoken.
    Without it, the section on a book-shaped page it started as: a collapsible
    block under the play bar.
  -->
  <div v-if="chat" ref="scroller" class="w-full overflow-y-auto overflow-x-hidden px-3 py-3" @scroll="onScroll">
    <!-- An empty transcript and a failed fetch are different things: the
         first says nothing was said, the second says why nothing is shown
         (the server's own words, which name the actual fault). -->
    <p v-if="error && !lines.length" class="text-sm text-error text-center py-8">Couldn't load the conversation: {{ error }}</p>
    <p v-else-if="!lines.length && !thinking" class="text-sm text-fg-muted text-center py-8">Nothing said yet.</p>
    <div v-for="(line, index) in lines" :key="index" :ref="`line-${index}`" class="w-full flex mb-2" :class="line.who === 'you' ? 'justify-end' : 'justify-start'">
      <!-- The line being spoken carries a visible border; the others carry a
           transparent one of the same width so nothing shifts as it moves. -->
      <div class="max-w-[85%] rounded-lg px-3 py-2 border" :class="[line.who === 'you' ? 'bg-info/20' : 'bg-primary/60', index === activeIndex ? 'border-fg/60' : 'border-transparent']" @click="play(line)">
        <div class="flex items-center pb-0.5">
          <p class="text-xs text-fg-muted">{{ line.who === 'you' ? 'You' : 'Claude' }}</p>
          <p v-if="line.start != null" class="text-xs font-mono text-fg-muted underline pl-2">{{ $secondsToTimestamp(line.start) }}</p>
        </div>
        <!-- A turn being spoken right now is shown sentence by sentence: what
             has been said in the usual colour, the sentence in the air bold,
             what is still to come dimmed. The server marks the line live and
             says which sentence, refreshed every poll. -->
        <p v-if="line.live && line.sentences && line.sentences.length" class="text-sm whitespace-pre-line">
          <template v-for="(sentence, i) in line.sentences">
            <span :key="i" :class="i === liveSentence ? 'font-semibold text-fg' : i < liveSentence ? 'text-fg' : 'text-fg-muted'">{{ sentence }} </span>
          </template>
        </p>
        <!-- A slash command is an instruction, not a sentence: it reads as
             the command it is, so the reply underneath has a visible cause. -->
        <p v-else-if="line.command" class="text-sm font-mono flex items-center">
          <span class="material-symbols text-base leading-none pr-1 text-fg-muted">terminal</span>
          <span>{{ line.command.text }}</span>
        </p>
        <p v-else-if="!(line.ask && line.ask.length)" class="text-sm whitespace-pre-line">{{ line.text }}</p>
        <!-- A multiple-choice question. Spoken it is one long sentence with
             the options run together, because a voice has no other way to
             offer them; on a screen it is a question and a list, with the
             option that was taken marked. The answer is the listener's own
             bubble underneath, so this only has to show what was on offer. -->
        <div v-if="line.ask && line.ask.length" class="space-y-2">
          <div v-for="(q, qi) in line.ask" :key="`ask-${qi}`">
            <p class="text-sm whitespace-pre-line pb-1.5">{{ q.question }}</p>
            <div v-for="(opt, oi) in q.options" :key="`opt-${qi}-${oi}`" class="flex items-start rounded px-2 py-1 mb-1 border" :class="isChosen(index, opt) ? 'bg-fg/10 border-fg/40' : 'bg-black/20 border-transparent'">
              <span class="material-symbols text-sm leading-snug pr-1.5 flex-shrink-0" :class="isChosen(index, opt) ? 'text-success' : 'text-fg-muted'">{{ isChosen(index, opt) ? 'check_circle' : 'radio_button_unchecked' }}</span>
              <span class="text-xs leading-snug">
                <span class="font-semibold">{{ opt.label }}</span>
                <span v-if="opt.description" class="text-fg-muted"> — {{ opt.description }}</span>
              </span>
            </div>
          </div>
        </div>
        <!-- The picture the canvas drew for this reply, when it still has it.
             A figure was drawn to be read and gets the width; ambient artwork
             is kept small so it decorates rather than interrupts. -->
        <div v-if="line.images && line.images.length" class="flex flex-wrap gap-1 pt-1.5">
          <img v-for="src in line.images" :key="src" :src="pictureUrl(src)" :class="line.figure ? 'w-full max-h-72 object-contain rounded bg-black/40' : 'h-20 w-20 object-cover rounded'" loading="lazy" @click.stop="openPicture(pictureUrl(src))" />
        </div>
      </div>
    </div>
    <div v-if="thinking" class="w-full flex mb-2 justify-start">
      <div class="max-w-[85%] rounded-lg px-3 py-2 bg-primary/60 border border-transparent">
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

  <div v-else-if="lines.length" class="w-full my-4">
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
import { Browser } from '@capacitor/browser'

// The idle cadence, when nothing is in flight: a turn takes longer than this
// to render and publish, so anything faster would mostly ask the same question
// twice.
const POLL_IDLE_MS = 15000
// The cadence while a reply is being worked on. The turn being spoken is in
// the log while it is still audible, so this is how closely the words on
// screen track the words in the air; a second keeps them within a sentence.
// Cheap: the log is derived on demand and the payload is small.
const POLL_FAST_MS = 1000
// Keep the fast cadence for a short while after the transcript last CHANGED,
// so a reply that is still growing (and the moment right after it settles)
// stays snappy no matter who started the turn or how it arrived.
const FAST_LINGER_MS = 20 * 1000
// A ceiling on the fast cadence while merely waiting (pending, but nothing
// changing), so a reply that never comes drops back to idle rather than
// polling fast forever.
const FAST_WINDOW_MS = 3 * 60 * 1000
// Chat mode: how long a scroll by the reader holds off the automatic ones —
// following the spoken line, jumping to a new turn. Long enough to read back
// through something; short enough that the page catches up on its own.
const USER_SCROLL_HOLD_MS = 8000
// How close to the bottom counts as "at the bottom", so a new turn landing
// keeps the view pinned there rather than growing off-screen.
const NEAR_BOTTOM_PX = 80

export default {
  props: {
    libraryItemId: String,
    // The conversation page's shape: see the template.
    chat: Boolean,
    // The player's clock and whether it is this conversation in the player
    // (playing or paused), for the highlight. Only read in chat mode.
    currentTime: { type: Number, default: 0 },
    following: Boolean
  },
  data() {
    return {
      baseUrl: '',
      lines: [],
      expanded: true,
      timer: null,
      // Chat mode scrolling. The reader's last scroll, and whether they were
      // at the bottom when they stopped; a scroll this component started is
      // ignored until this stamp passes, or it would count as the reader's.
      lastUserScrollAt: 0,
      stickToBottom: true,
      ignoreScrollUntil: 0,
      // From the server: the last thing said was the listener's, so an answer
      // is still to come.
      pending: false,
      // Local: a reply was just accepted. record_listener_turn renders it on a
      // background thread a beat later, so for that beat neither the listener's
      // line nor `pending` is here yet — this bridges the gap so the indicator
      // shows the instant Send is pressed.
      awaiting: false,
      // Why the last fetch failed, if it did; cleared by the next one that
      // works. Shown in place of the transcript while there is none.
      error: '',
      // When the transcript last changed, and a cheap signature to detect it.
      // Any change re-arms the fast cadence, so a turn arriving by ANY route —
      // a reply from the app, a message typed elsewhere, a turn spoken on the
      // host — is picked up promptly, not only ones this page sent itself.
      lastChangeAt: 0,
      lastSig: '',
      // The live turn's clock, run here between polls. `liveElapsed` is what
      // the server said, `liveElapsedAt` when it said it; the sentence is
      // found on the timeline at elapsed-plus-however-long-ago, so the bold
      // moves with the voice instead of a poll behind it. Skew between the
      // two clocks does not matter: only the local interval is used.
      liveElapsed: 0,
      liveElapsedAt: 0,
      livePaused: false,
      liveClock: 0,
      clockTimer: null
    }
  },
  computed: {
    thinking() {
      return this.awaiting || this.pending
    },
    // Whether a turn is being spoken right now, by the host rather than the
    // player. Polled fast while it is, so the sentence keeps up.
    liveIndex() {
      return this.lines.findIndex((line) => line.live)
    },
    // Which sentence of the live turn the voice is on: from the timeline and
    // the local clock when the server sent a timeline, else what it said.
    liveSentence() {
      const line = this.liveIndex >= 0 ? this.lines[this.liveIndex] : null
      if (!line) return -1
      const offsets = line.offsets || []
      if (!offsets.length) return line.sentence == null ? -1 : line.sentence
      const elapsed = this.livePaused ? this.liveElapsed : this.liveElapsed + (this.liveClock - this.liveElapsedAt) / 1000
      let idx = 0
      offsets.forEach((off, i) => {
        if (elapsed + 0.001 >= off) idx = i
      })
      return idx
    },
    // The line being spoken. A turn the host is speaking right now wins; it
    // is not in the audio item yet, so the player cannot be on it. Otherwise
    // the last line that starts at or before the player's clock — lines on
    // the live tail have no start and are never it.
    activeIndex() {
      if (!this.chat) return -1
      if (this.liveIndex >= 0) return this.liveIndex
      if (!this.following) return -1
      const t = Number(this.currentTime) + 0.05
      let found = -1
      this.lines.forEach((line, i) => {
        if (line.start != null && line.start <= t) found = i
      })
      return found
    }
  },
  watch: {
    activeIndex(index) {
      if (index < 0 || !this.readerIsAway()) return
      this.scrollToLine(index)
    }
  },
  methods: {
    // Which option was taken. The answer is not stored on the question — it
    // is the listener's own turn, recorded when the choice was made — so the
    // line below is the answer, and a multi-select one lists its labels.
    answerFor(index) {
      const next = this.lines[index + 1]
      if (!next || next.who !== 'you') return []
      return String(next.text || '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
    },
    isChosen(index, opt) {
      const label = String(opt?.label || '').trim().toLowerCase()
      return !!label && this.answerFor(index).includes(label)
    },
    // Canvas-relative (/img/...) or absolute, as the server chose to send it.
    pictureUrl(src) {
      return src.startsWith('/') ? `${this.baseUrl}${src}` : src
    },
    openPicture(url) {
      // Full size, in the system browser: a figure's labels are small on a
      // phone, and the browser knows how to pinch.
      Browser.open({ url }).catch((error) => console.error('[ConversationLog] open picture failed', error))
    },
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
        this.error = ''
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
        const sig = lines.length + '|' + (last ? last.who + ':' + last.text + '#' + (last.live ? last.sentence : '') : '')
        if (sig !== this.lastSig) {
          this.lastSig = sig
          this.lastChangeAt = Date.now()
        }
        const first = !this.lines.length
        const grew = lines.length > this.lines.length
        this.lines = lines
        const live = lines.find((line) => line.live)
        if (live && live.elapsed != null) {
          this.liveElapsed = Number(live.elapsed) || 0
          this.liveElapsedAt = Date.now()
          this.livePaused = !!live.paused
          this.liveClock = this.liveElapsedAt
          this.startClock()
        } else {
          this.stopClock()
        }
        // A conversation opens at its newest turn, and stays there as turns
        // land — unless the reader has scrolled up to read something, in
        // which case the new turn waits below and the page holds still.
        if (this.chat && (first || grew) && this.stickToBottom && this.readerIsAway()) {
          this.$nextTick(this.scrollToBottom)
        }
        this.pending = !!res?.pending
        // The ghost prompt — Claude Code's suggested next line, scraped off
        // the session's screen — comes with every poll, because it appears a
        // few seconds after the turn it follows. The reply box shows it.
        this.$emit('suggestion', res?.suggestion || '')
        // The page hides upstream's chapters table while this is up.
        this.$emit('has-log', this.lines.length > 0)
      } catch (error) {
        // Not a conversation, not allowed, no canvas, or the server fell
        // over: the message is the server's when it sent one. Kept even on a
        // quiet refresh so a failure that persists is seen once the lines
        // it was hiding behind are gone — but the lines stay.
        this.error = error?.message || String(error)
        console.error('[ConversationLog] fetch failed', this.error)
        if (quiet) return
        this.lines = []
      }
    },
    refresh() {
      this.fetchLog({ quiet: true })
    },
    // Chat mode. "Away" means the reader has not scrolled for a while, so a
    // scroll the page makes will not fight one they are making.
    readerIsAway() {
      return Date.now() - this.lastUserScrollAt > USER_SCROLL_HOLD_MS
    },
    onScroll() {
      const el = this.$refs.scroller
      if (!el) return
      if (Date.now() < this.ignoreScrollUntil) return
      this.lastUserScrollAt = Date.now()
      this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    },
    // The local clock behind liveSentence: a tick every quarter second while
    // a turn is live is what moves the bold between polls.
    startClock() {
      if (this.clockTimer) return
      this.clockTimer = window.setInterval(() => {
        this.liveClock = Date.now()
      }, 250)
    },
    stopClock() {
      if (!this.clockTimer) return
      window.clearInterval(this.clockTimer)
      this.clockTimer = null
    },
    scrollToBottom() {
      const el = this.$refs.scroller
      if (!el) return
      this.ignoreScrollUntil = Date.now() + 800
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      this.stickToBottom = true
    },
    scrollToLine(index) {
      const ref = this.$refs[`line-${index}`]
      const el = Array.isArray(ref) ? ref[0] : ref
      if (!el) return
      this.ignoreScrollUntil = Date.now() + 800
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
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
      // A turn being spoken moves a sentence every few seconds for as long as
      // it lasts; the linger after a change is not enough for a long one.
      if (this.liveIndex >= 0) return POLL_FAST_MS
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
      // A book-shaped page with no transcript has nothing to poll for. A chat
      // page is the transcript, so it keeps asking — the first turn may be
      // the one being spoken right now.
      if (this.timer || (!this.lines.length && !this.chat)) return
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
    this.stopClock()
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
