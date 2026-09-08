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
    <div v-show="open" class="w-full canvas-frame">
      <iframe :src="src" class="w-full h-full border-0" allow="autoplay" referrerpolicy="no-referrer" title="agent-media canvas" />
    </div>
  </div>
</template>

<script>
const OPEN_KEY = 'sasonica-canvas-open'

export default {
  data() {
    return {
      src: '',
      open: true
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
    this.src = base ? `${base}/` : ''
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
