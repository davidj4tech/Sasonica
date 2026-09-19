<template>
  <!-- Sasonica: the voice's player, on every page. Speech is played by this
       app's speech listener (com.audiobookshelf.app.speech), but what to
       play next — the reply queue, the turns, the sentences — is red5's, so
       the controls go there: this asks the canvas what is being said
       (/speech/now) and sends the tmux popup's listening keys back
       (/speech/ctl). Collapsed it sits in the mini player's place; a tap opens
       the full set. Fork-only file. -->
  <div>
    <div v-if="visible" id="speechBar" class="fixed left-0 right-0 z-50 pointer-events-none" :style="{ bottom: bottomPx + 'px', height: barHeightPx + 'px' }">
      <!-- Its own touches: the mini player listens on the whole body and
           reads a swipe up anywhere near the bottom as "open me full screen",
           which with no book loaded opened an empty player and hid this bar
           behind it. Here a swipe up opens the speech player instead. -->
      <div class="speech-bar w-full h-full flex items-center px-3 pointer-events-auto bg-primary border-t border-fg/10" @click="expand" @touchstart.stop="swipeStart" @touchend.stop="swipeEnd">
        <span class="material-symbols text-xl text-fg-muted mr-2" :class="{ 'speech-pulse': now.speaking }">graphic_eq</span>
        <div class="flex-grow min-w-0">
          <p class="text-sm font-semibold text-fg truncate">{{ now.title || 'Speaking' }}</p>
          <p class="text-xs text-fg-muted truncate">{{ now.sentence || (now.paused ? 'Paused' : '…') }}</p>
        </div>
        <button class="material-symbols text-2xl text-fg px-2" aria-label="Back a sentence" @click.stop="ctl('skip-')">fast_rewind</button>
        <button class="material-symbols text-3xl text-fg px-1" :aria-label="now.paused ? 'Resume' : 'Pause'" @click.stop="toggle">{{ now.paused ? 'play_arrow' : 'pause' }}</button>
        <button class="material-symbols text-2xl text-fg px-2" aria-label="Next sentence" @click.stop="ctl('skip+')">fast_forward</button>
      </div>
    </div>

    <!-- The full player: every key the popup has for a listener. It stays
         open when the reply ends, so replay and the older turns are still to
         hand — which is when they are wanted. -->
    <div v-if="expanded" class="fixed inset-0 flex flex-col justify-end" style="z-index: 60" @click.self="expanded = false">
      <div class="absolute inset-0 bg-black/50" @click="expanded = false" />
      <div class="speech-sheet relative w-full bg-primary border-t border-fg/10 rounded-t-xl px-4 pt-2 pb-6">
        <div class="flex items-center">
          <span class="material-symbols text-xl text-fg-muted mr-2" :class="{ 'speech-pulse': now.speaking }">graphic_eq</span>
          <p class="flex-grow min-w-0 text-base font-semibold truncate" :class="now.item ? 'underline' : ''" @click="open">{{ now.title || (now.live ? 'Speaking' : 'Nothing playing') }}</p>
          <button class="material-symbols text-3xl text-fg-muted pl-2" aria-label="Close" @click="expanded = false">expand_more</button>
        </div>
        <p class="text-sm text-fg min-h-[3.75rem] line-clamp-3 mt-2 mb-3">{{ now.sentence || (now.paused ? 'Paused' : now.live ? '…' : 'The last reply has finished. Replay it, or go back a turn.') }}</p>

        <div class="flex items-center justify-between">
          <button class="speech-key" aria-label="Previous turn" @click="prevTurn"><span class="material-symbols text-3xl">skip_previous</span></button>
          <button class="speech-key" aria-label="Back a paragraph" @click="ctl('para-')"><span class="material-symbols text-3xl">keyboard_double_arrow_left</span></button>
          <button class="speech-key" aria-label="Back a sentence" @click="ctl('skip-')"><span class="material-symbols text-3xl">fast_rewind</span></button>
          <button class="speech-key speech-key-main" :aria-label="now.paused ? 'Resume' : 'Pause'" @click="toggle"><span class="material-symbols text-4xl fill">{{ now.paused || !now.live ? 'play_arrow' : 'pause' }}</span></button>
          <button class="speech-key" aria-label="Next sentence" @click="ctl('skip+')"><span class="material-symbols text-3xl">fast_forward</span></button>
          <button class="speech-key" aria-label="Next paragraph" @click="ctl('para+')"><span class="material-symbols text-3xl">keyboard_double_arrow_right</span></button>
          <button class="speech-key" aria-label="Next turn" @click="nextTurn"><span class="material-symbols text-3xl">skip_next</span></button>
        </div>

        <div class="flex items-center justify-between mt-4">
          <button class="speech-pill" @click="replayLatest"><span class="material-symbols text-lg mr-1">replay</span>Replay latest</button>
          <button class="speech-pill" :disabled="!now.live" @click="ctl('jump-end')"><span class="material-symbols text-lg mr-1">last_page</span>End of reply</button>
          <button class="speech-pill" :class="now.muted ? 'text-warning' : ''" @click="ctl('mute')"><span class="material-symbols text-lg mr-1">{{ now.muted ? 'volume_off' : 'volume_mute' }}</span>Mute</button>
        </div>

        <div class="flex items-center mt-4">
          <p class="text-xs text-fg-muted w-16">Speed</p>
          <button class="speech-key" aria-label="Slower" @click="ctl('speed-')"><span class="material-symbols text-2xl">remove</span></button>
          <button class="flex-grow text-center text-sm font-mono" aria-label="Reset speed" @click="ctl('speed0')">{{ speedLabel }}</button>
          <button class="speech-key" aria-label="Faster" @click="ctl('speed+')"><span class="material-symbols text-2xl">add</span></button>
        </div>
        <div class="flex items-center mt-2">
          <p class="text-xs text-fg-muted w-16">Volume</p>
          <button class="speech-key" aria-label="Quieter" @click="ctl('vol-')"><span class="material-symbols text-2xl">volume_down</span></button>
          <div class="flex-grow" />
          <button class="speech-key" aria-label="Louder" @click="ctl('vol+')"><span class="material-symbols text-2xl">volume_up</span></button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// How often to ask. Quick while a voice is live, so the sentence keeps up and
// the bar goes away soon after the reply ends; slow while quiet, which is most
// of the time. Nothing at all while the app is not on screen.
const POLL_LIVE_MS = 1500
const POLL_IDLE_MS = 5000
const POLL_FAILING_MS = 15000
const BAR_HEIGHT_PX = 56
// The collapsed mini player's height (.playerContainer in AudioPlayer.vue).
const MINI_PLAYER_PX = 120

export default {
  data() {
    return {
      baseUrl: '',
      now: { live: false },
      timer: null,
      failing: false,
      expanded: false,
      // Which reply the turn keys are on, as the popup's hist_idx: 1 is the
      // latest. red5 answers `prev` with where it landed.
      histIdx: 1,
      swipeY: null
    }
  },
  computed: {
    miniPlayerShowing() {
      return this.$store.getters['getIsPlayerOpen'] && !this.$store.state.playerIsHidden
    },
    bottomPx() {
      return this.miniPlayerShowing ? MINI_PLAYER_PX : 0
    },
    barHeightPx() {
      return BAR_HEIGHT_PX
    },
    speedLabel() {
      const v = Number(this.now.speed)
      return v ? `${v.toFixed(2).replace(/0$/, '')}×` : '1×'
    },
    // Everywhere but over the full-screen player — the conversation's own page
    // included: it follows the words, but the bar is the only player speech
    // has in this app, and tapping the bar lands there.
    visible() {
      return !!this.now.live && !this.$store.state.playerIsFullscreen
    }
  },
  watch: {
    // Room for the bar: pages size themselves to #content, so the bar takes
    // its height out of #content rather than covering the page's last row.
    visible: {
      immediate: true,
      handler(on) {
        document.documentElement.style.setProperty('--speech-bar-height', on ? BAR_HEIGHT_PX + 'px' : '0px')
      }
    }
  },
  methods: {
    request(method, path, data) {
      const token = this.$store.getters['user/getToken']
      return this.$nativeHttp.request(method, `${this.baseUrl}${path}`, data, {
        headers: { Authorization: `Bearer ${token}` }
      })
    },
    async poll() {
      if (!this.$store.getters['user/getToken']) return
      // Asked here, not once at mount: the layout mounts before the server
      // connection is restored, and the address is derived from it, so a
      // mount-time answer is '' and stays '' for the life of the app.
      if (!this.baseUrl) {
        this.baseUrl = await this.$localStore.agentMediaBaseUrl(this.$store.state.user.serverConnectionConfig?.address)
        if (!this.baseUrl) return
      }
      try {
        const res = await this.request('GET', '/speech/now')
        this.now = res && res.ok ? res : { live: false }
        this.failing = false
      } catch (error) {
        // No canvas, not allowed, or the network blinked: no bar, and ask
        // less often until it answers again.
        this.now = { live: false }
        this.failing = true
      }
    },
    nextDelay() {
      if (this.failing) return POLL_FAILING_MS
      return this.now.live ? POLL_LIVE_MS : POLL_IDLE_MS
    },
    startPolling() {
      if (this.timer) return
      const tick = async () => {
        this.timer = null
        await this.poll()
        if (!document.hidden) this.timer = window.setTimeout(tick, this.nextDelay())
      }
      this.timer = window.setTimeout(tick, 0)
    },
    stopPolling() {
      if (!this.timer) return
      window.clearTimeout(this.timer)
      this.timer = null
    },
    onVisibilityChange() {
      if (document.hidden) this.stopPolling()
      else this.startPolling()
    },
    async ctl(action, arg) {
      let res = null
      try {
        res = await this.request('POST', '/speech/ctl', arg ? { action, arg } : { action })
      } catch (error) {
        console.error('[SpeechBar] ctl failed', action, error?.message || error)
      }
      // The server's answer is the truth; ask for it straight away rather
      // than at the next tick.
      this.stopPolling()
      window.setTimeout(() => this.startPolling(), 300)
      return res
    },
    swipeStart(e) {
      this.swipeY = e.changedTouches?.[0]?.pageY ?? null
    },
    swipeEnd(e) {
      const y = e.changedTouches?.[0]?.pageY
      if (this.swipeY != null && y != null && this.swipeY - y > 40) this.expand()
      this.swipeY = null
    },
    expand() {
      this.histIdx = 1
      this.expanded = true
    },
    // The popup's <: a restart first when well into a turn, else the older
    // turn. red5 prints the turn it chose, so the next press starts there.
    async prevTurn() {
      const res = await this.ctl('prev', this.histIdx)
      const n = parseInt(String(res?.out || '').trim(), 10)
      if (n > 0) this.histIdx = n
    },
    // The popup's >: a newer turn while going back through them, and the end
    // of the reply once at the latest.
    nextTurn() {
      if (this.histIdx > 1) {
        this.histIdx -= 1
        this.ctl('replay', this.histIdx)
      } else {
        this.ctl('jump-end')
      }
    },
    replayLatest() {
      this.histIdx = 1
      this.ctl('replay', 1)
    },
    toggle() {
      // Nothing playing: the button means the popup's r, not a pause.
      if (!this.now.live) return this.replayLatest()
      this.now = { ...this.now, paused: !this.now.paused } // the icon answers the thumb at once
      this.ctl('toggle')
    },
    open() {
      if (!this.now.item) return
      this.expanded = false
      this.$router.push(`/item/${this.now.item}`)
    }
  },
  mounted() {
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.startPolling()
  },
  beforeDestroy() {
    this.stopPolling()
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    document.documentElement.style.setProperty('--speech-bar-height', '0px')
  }
}
</script>

<style>
/* Sasonica: global on purpose — #content belongs to the layout. The bar's
   height comes out of the page's box (border-box), so the page's own
   scrollers end above the bar instead of under it. */
#content {
  padding-bottom: var(--speech-bar-height, 0px);
}
</style>

<style scoped>
.speech-bar {
  height: 56px;
  box-shadow: 0px -4px 8px #11111133;
}
.speech-sheet {
  box-shadow: 0px -4px 16px #11111155;
}
.speech-key {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 9999px;
}
.speech-key-main {
  width: 3.5rem;
  height: 3.5rem;
  background: rgba(255, 255, 255, 0.12);
}
.speech-pill {
  display: flex;
  align-items: center;
  font-size: 0.8rem;
  padding: 0.4rem 0.75rem;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.speech-pill:disabled {
  opacity: 0.4;
}
.speech-pulse {
  animation: speech-pulse 1.2s ease-in-out infinite;
}
@keyframes speech-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
</style>
