<template>
  <!-- Sasonica: the voice, on every page. Speech plays in the agent-media
       companion app, not this one, so the mini player never knew about it:
       only a conversation's own page did. This bar asks red5's canvas what is
       being said (/speech/now) and shows it above the mini player — the
       conversation's title, the sentence being spoken, pause and skip — and
       a tap opens the conversation. Fork-only file. -->
  <div v-if="visible" id="speechBar" class="fixed left-0 right-0 z-50 pointer-events-none" :style="{ bottom: bottomPx + 'px', height: barHeightPx + 'px' }">
    <div class="speech-bar w-full h-full flex items-center px-3 pointer-events-auto bg-primary border-t border-fg/10" @click="open">
      <span class="material-symbols text-xl text-fg-muted mr-2" :class="{ 'speech-pulse': now.speaking }">graphic_eq</span>
      <div class="flex-grow min-w-0">
        <p class="text-sm font-semibold text-fg truncate">{{ now.title || 'Speaking' }}</p>
        <p class="text-xs text-fg-muted truncate">{{ now.sentence || (now.paused ? 'Paused' : '…') }}</p>
      </div>
      <button class="material-symbols text-2xl text-fg px-2" :aria-label="'Back a sentence'" @click.stop="ctl('skip-')">fast_rewind</button>
      <button class="material-symbols text-3xl text-fg px-1" :aria-label="now.paused ? 'Resume' : 'Pause'" @click.stop="toggle">{{ now.paused ? 'play_arrow' : 'pause' }}</button>
      <button class="material-symbols text-2xl text-fg px-2" :aria-label="'Next sentence'" @click.stop="ctl('skip+')">fast_forward</button>
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
      failing: false
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
    async ctl(action) {
      try {
        await this.request('POST', '/speech/ctl', { action })
      } catch (error) {
        console.error('[SpeechBar] ctl failed', action, error?.message || error)
      }
      // The server's answer is the truth; ask for it straight away rather
      // than at the next tick.
      this.stopPolling()
      window.setTimeout(() => this.startPolling(), 300)
    },
    toggle() {
      this.now = { ...this.now, paused: !this.now.paused } // the icon answers the thumb at once
      this.ctl('toggle')
    },
    open() {
      if (this.now.item) this.$router.push(`/item/${this.now.item}`)
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
