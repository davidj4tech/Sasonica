<template>
  <!--
    Sasonica: the live canvas, framed above a conversation.

    agent-media draws alongside every spoken reply — ambient artwork, or a
    figure when the reply carries a [[visual:]] marker — on a page of its own
    that the wall and the phone's companion app show. This is that page, in a
    frame, at the top of the chat. It talks to the canvas directly (its own
    event stream from the phone to the host), so nothing here is relayed.

    Collapsible, because on a phone it is a third of the screen and the
    transcript is the thing being read. The choice is remembered per device.
  -->
  <div v-if="src" class="w-full flex-shrink-0 border-b border-border">
    <div class="flex items-center px-3 py-1" @click="toggle">
      <span class="material-symbols text-base text-fg-muted">draw</span>
      <p class="px-1.5 text-xs text-fg-muted">Canvas</p>
      <div class="flex-grow" />
      <span class="material-symbols text-xl text-fg-muted duration-300" :class="open ? 'transform rotate-180' : ''">arrow_drop_down</span>
    </div>
    <!-- Kept mounted while collapsed (v-show), so reopening does not reconnect
         the stream and replay whatever the canvas last showed. -->
    <!-- `fullscreen` in the allow list, and the legacy attribute beside it for
         the WebView: the canvas has its own fullscreen button, and inside a
         frame that does not delegate the permission the page is told fullscreen
         is unavailable and correctly takes the button off itself. So the panel
         has to say yes here, or the control simply is not there — which is how
         it was reported: "I don't see the full screen features". A third of a
         phone screen is where wanting the whole of it starts. -->
    <div v-show="open" class="w-full canvas-frame">
      <iframe :src="src" class="w-full h-full border-0" allow="autoplay; fullscreen" allowfullscreen referrerpolicy="no-referrer" title="agent-media canvas" />
    </div>
  </div>
</template>

<script>
import { AbsSasonica } from '@/plugins/capacitor' // Sasonica

const OPEN_KEY = 'sasonica-canvas-open'

export default {
  data() {
    return {
      src: '',
      open: true,
      onFrameMessage: null,
      turned: false
    }
  },
  methods: {
    toggle() {
      this.open = !this.open
      try {
        localStorage.setItem(OPEN_KEY, this.open ? '1' : '0')
      } catch (error) {
        // Storage refused: the choice just does not survive the page.
      }
    },
    // The canvas page asks the browser for a landscape lock when it fills the
    // screen, and inside a WebView there is no browser to ask — `lock()` is the
    // embedder's call, and the embedder is our activity. So the page tells us
    // instead (a postMessage, since it is cross-origin and that is the only
    // channel), and we turn the activity for it.
    async setTurned(on) {
      if (this.turned === on) return
      this.turned = on
      try {
        await AbsSasonica.setOrientation({ landscape: on })
      } catch (error) {
        console.error('[CanvasPanel] orientation failed', error)
      }
    }
  },
  async mounted() {
    try {
      this.open = localStorage.getItem(OPEN_KEY) !== '0'
    } catch (error) {
      this.open = true
    }
    const base = await this.$localStore.agentMediaBaseUrl(this.$store.state.user.serverConnectionConfig?.address)
    // The canvas page itself. The frame carries no credential; the page is
    // reachable to anything on the tailnet, which is what the wall relies on.
    // Captions off: the transcript under the frame has the words, and the
    // canvas drawing them too would be the same sentence twice on one screen.
    this.src = base ? `${base}/?subs=0` : ''

    // Only this frame's own origin is heard, and only this one message. The
    // panel is on a chat page anyone's server could be behind, so a window
    // message is not a thing to act on because it arrived.
    const origin = this.src ? new URL(this.src).origin : ''
    this.onFrameMessage = (event) => {
      if (!origin || event.origin !== origin) return
      const data = event.data
      if (!data || data.source !== 'agent-media-canvas') return
      if (data.type === 'fullscreen') this.setTurned(!!data.on)
    }
    window.addEventListener('message', this.onFrameMessage)
  },
  beforeDestroy() {
    if (this.onFrameMessage) window.removeEventListener('message', this.onFrameMessage)
    // Leaving the page while turned would strand the whole app sideways — the
    // activity keeps a requested orientation until something takes it back.
    this.setTurned(false)
  }
}
</script>

<style scoped>
/* A third of the screen, landscape-ish: the canvas draws for a wall, and a
   tall frame would mostly be letterbox. */
.canvas-frame {
  height: 34vh;
  min-height: 160px;
  background: #000;
}
</style>
