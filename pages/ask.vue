<template>
  <!--
    Sasonica: a new conversation.

    Where the assistant button lands, and where "New chat" in the drawer
    goes. From the button the words are sent the moment dictation returns
    them — a button pressed to say something should not then want a tap;
    from the drawer the box waits for send, so a typed message can be read
    over first. The words typed (or dictated) here become the first message of a
    FRESH Claude Code session on the host — agent-media opens it in the
    scratch tmux session — and the page then waits for the library to grow
    an item for that session, which happens once its first turn is shelved,
    and moves to it. Same credential as a reply: the Audiobookshelf token.
  -->
  <div class="w-full h-full flex flex-col bg-bg">
    <div class="flex items-center px-3 py-2 border-b border-border flex-shrink-0">
      <span class="material-symbols text-xl text-fg-muted">add_comment</span>
      <h1 class="text-base font-semibold flex-grow truncate pl-2">New chat</h1>
    </div>

    <div class="flex-grow min-h-0 overflow-y-auto px-3 py-4">
      <p v-if="!baseUrl" class="text-sm text-error">No agent-media canvas is set — see Settings.</p>
      <template v-else-if="!session">
        <p class="text-sm text-fg-muted">Say or type what you want to talk about. A new session opens on the host with it as the first message.</p>
      </template>
      <template v-else>
        <p class="text-sm">{{ sentText }}</p>
        <div class="flex items-center pt-3">
          <span class="thinking-dot" />
          <p class="text-sm text-fg-muted pl-2">{{ status }}</p>
        </div>
        <p v-if="pane" class="text-xs text-info underline pt-2" @click="goToPane">go to {{ pane }}</p>
      </template>
      <p v-if="failed" class="text-sm text-error pt-3">{{ status }}</p>
    </div>

    <div v-if="baseUrl && !session" class="flex-shrink-0 px-3 pt-2 pb-3 border-t border-border bg-bg">
      <div class="flex items-end">
        <textarea ref="input" v-model="text" rows="1" :disabled="sending" placeholder="What shall we talk about?" class="flex-grow text-sm py-2 px-2 rounded-sm bg-bg text-fg border border-border outline-none resize-none overflow-y-auto" @input="grow" @keydown.enter.exact.prevent="send" />
        <ui-btn v-if="canDictate" :disabled="sending" color="primary" :padding-x="3" class="ml-2 flex items-center justify-center" @click="dictate">
          <span class="material-symbols text-xl" :class="listening ? 'animate-pulse' : ''">mic</span>
        </ui-btn>
        <ui-btn :disabled="!text.trim() || sending" :loading="sending" color="success" :padding-x="3" class="ml-2 flex items-center justify-center" @click="send">
          <span class="material-symbols text-xl">send</span>
        </ui-btn>
      </div>
    </div>
  </div>
</template>

<script>
import { AbsSpeechInput } from '@/plugins/capacitor'

// How long to wait for the library to show the new conversation. The first
// turn is exported a minute after it is spoken, then Audiobookshelf has to
// notice the folder; five minutes covers a slow first reply.
const ITEM_WAIT_MS = 5 * 60 * 1000
const ITEM_POLL_MS = 3000

export default {
  data() {
    return {
      baseUrl: '',
      text: '',
      sentText: '',
      sending: false,
      status: '',
      failed: false,
      session: null,
      pane: null,
      canDictate: false,
      listening: false,
      pollTimer: null,
      pollUntil: 0
    }
  },
  methods: {
    request(method, path, data) {
      const token = this.$store.getters['user/getToken']
      return this.$nativeHttp.request(method, `${this.baseUrl}${path}`, data, {
        headers: { Authorization: `Bearer ${token}` }
      })
    },
    grow() {
      const el = this.$refs.input
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 6 * 24 + 16)}px`
    },
    async dictate({ submit = false } = {}) {
      if (this.listening || this.session) return
      this.listening = true
      let heard = ''
      try {
        const res = await AbsSpeechInput.listen({ prompt: 'New chat' })
        heard = (res?.text || '').trim()
        if (heard) {
          this.text = this.text.trim() ? `${this.text.trim()} ${heard}` : heard
          this.$nextTick(this.grow)
        }
      } catch (error) {
        console.error('[Ask] dictation failed', error)
      }
      this.listening = false
      if (submit && heard) this.send()
    },
    async send() {
      // The field's own value: v-model lags the keyboard's composing word
      // (see ReplyBox).
      const el = this.$refs.input
      const text = ((el && el.value) || this.text || '').trim()
      if (!text || this.sending) return
      this.sending = true
      this.failed = false
      this.status = 'Opening a session…'
      try {
        const res = await this.request('POST', '/ask', { text })
        this.sentText = text
        this.text = ''
        this.pane = res.pane || null
        this.session = res.session || null
        if (this.session) {
          this.status = 'Session open — waiting for the first reply…'
          this.pollUntil = Date.now() + ITEM_WAIT_MS
          this.poll()
        } else {
          // Delivered, but the session's id never surfaced: nothing to wait
          // for here. The pane link is the way to it.
          this.session = '?'
          this.status = `Sent to ${this.pane || 'the host'}.`
        }
      } catch (error) {
        this.failed = true
        this.status = error.message || 'Could not start a session.'
      }
      this.sending = false
    },
    async poll() {
      if (!this.session || this.session === '?') return
      try {
        const res = await this.request('GET', `/conversation?session=${this.session}`)
        if (res.item) {
          this.$router.replace(`/item/${res.item}`)
          return
        }
        if (res.pane) this.pane = res.pane
        this.status = res.live ? 'Session open — waiting for the first reply…' : 'The session ended before it was shelved.'
      } catch (error) {
        console.error('[Ask] poll failed', error)
      }
      if (Date.now() < this.pollUntil) {
        this.pollTimer = setTimeout(this.poll, ITEM_POLL_MS)
      } else {
        this.status = 'Still no item for it; it will appear in the library once it has spoken.'
      }
    },
    async goToPane() {
      try {
        await this.request('POST', '/focus', { pane: this.pane })
      } catch (error) {
        console.error('[Ask] focus failed', error)
      }
    },
    // The assistant button pressed again while this page is up: listen again.
    onAssist() {
      if (this.canDictate) this.dictate({ submit: true })
    },
    async init() {
      this.baseUrl = await this.$localStore.agentMediaBaseUrl(this.$store.state.user.serverConnectionConfig?.address)
      if (!this.baseUrl) return
      try {
        const r = await AbsSpeechInput.available()
        this.canDictate = !!r?.available
      } catch (error) {
        this.canDictate = false
      }
      // Opened by the assistant button, the page listens straight away: that
      // button was pressed to say something, not to look at a box.
      if (this.canDictate && this.$route.query.dictate !== '0') {
        this.dictate({ submit: this.$route.query.assist === '1' })
      } else {
        this.$nextTick(() => this.$refs.input?.focus())
      }
    }
  },
  mounted() {
    this.$eventBus.$on('assist', this.onAssist)
    this.init()
  },
  beforeDestroy() {
    this.$eventBus.$off('assist', this.onAssist)
    if (this.pollTimer) clearTimeout(this.pollTimer)
  }
}
</script>

<style scoped>
.thinking-dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: currentColor;
  opacity: 0.6;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 0.8;
  }
}
</style>
