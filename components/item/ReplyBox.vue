<template>
  <!--
    Sasonica: reply to a conversation from inside the player.

    A conversation in this library is a Claude Code session someone recorded.
    This box puts a line back into that session — reviving it in a tmux window
    on the host if it has since ended. The whole thing is one POST to
    agent-media's canvas, authorised by the Audiobookshelf token this app
    already holds; nothing new is stored on the device.

    It draws nothing unless the server says this item is a conversation the
    signed-in user may reply to, so it is invisible on ordinary audiobooks.
  -->
  <div v-if="isConversation" ref="box" class="w-full mt-6">
    <div class="flex items-center mb-1.5">
      <span class="material-symbols text-lg text-fg-muted">reply</span>
      <p class="px-1.5 text-sm text-fg-muted">Reply to this conversation</p>
      <div class="flex-grow" />
      <p v-if="!live" class="text-xs text-fg-muted">session ended</p>
    </div>

    <div class="flex items-end">
      <!-- A plain textarea rather than ui-text-input: this one has to grow, and
           the shared input is an <input> used by every other screen. One row
           until the text needs more, then up to six, then it scrolls. Enter
           sends; the growth comes from wrapping, not from typing returns. -->
      <textarea
        ref="input"
        v-model="text"
        rows="1"
        :disabled="sending"
        placeholder="Say something back…"
        class="flex-grow text-sm py-2 px-2 rounded-sm bg-bg text-fg border border-border outline-none resize-none overflow-y-auto"
        @input="grow"
        @keydown.enter.exact.prevent="send"
        @focusin="keepInView"
      />
      <ui-btn v-if="canDictate" :disabled="sending" color="primary" :padding-x="3" class="ml-2 flex items-center justify-center" @click="dictate">
        <span class="material-symbols text-xl" :class="listening ? 'animate-pulse' : ''">mic</span>
      </ui-btn>
      <ui-btn :disabled="!text.trim() || sending" :loading="sending" color="success" :padding-x="3" class="ml-2 flex items-center justify-center" @click="send">
        <span class="material-symbols text-xl">send</span>
      </ui-btn>
    </div>

    <div v-if="status" class="mt-1.5 flex items-center">
      <p class="text-xs" :class="failed ? 'text-error' : 'text-fg-muted'">{{ status }}</p>
      <p v-if="pane" class="text-xs text-info underline pl-2" @click="goToPane">go to {{ pane }}</p>
    </div>

    <!--
      The box sits under the chapters, which is where a reply belongs — after
      the thing you are replying to. That puts it a long scroll away on a
      conversation with fifty of them, so this floats until you can see it.
    -->
    <div v-show="!boxInView" class="fixed right-4 z-30 rounded-full bg-primary border border-border shadow-lg w-11 h-11 flex items-center justify-center" :class="playerIsOpen ? 'bottom-28' : 'bottom-6'" @click="jumpToBox">
      <span class="material-symbols text-2xl">reply</span>
    </div>
  </div>
</template>

<script>
import { AbsSpeechInput } from '@/plugins/capacitor'

export default {
  props: {
    libraryItemId: String
  },
  data() {
    return {
      baseUrl: '',
      isConversation: false,
      live: false,
      text: '',
      sending: false,
      status: '',
      failed: false,
      pane: null,
      boxInView: true,
      observer: null,
      canDictate: false,
      listening: false
    }
  },
  computed: {
    playerIsOpen() {
      return this.$store.getters['getIsPlayerOpen']
    },
    // agent-media runs alongside Audiobookshelf, so the server you are signed
    // in to is almost always the right host — take its address and swap the
    // port. That makes the setting something to override, not something to
    // fill in. Wrong guesses fail closed: the probe below just does not
    // resolve and no box appears.
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
    // The canvas is a different service from Audiobookshelf, so these are
    // absolute URLs and the bearer goes on by hand — $nativeHttp only attaches
    // it to relative (i.e. ABS) ones. Sending the ABS token here is the point:
    // the canvas hands it straight back to ABS to ask who we are.
    request(method, path, data) {
      const token = this.$store.getters['user/getToken']
      return this.$nativeHttp.request(method, `${this.baseUrl}${path}`, data, {
        headers: { Authorization: `Bearer ${token}` }
      })
    },
    async send() {
      const text = this.text.trim()
      if (!text || this.sending) return
      this.sending = true
      this.status = ''
      this.failed = false
      this.pane = null
      try {
        const res = await this.request('POST', '/reply', { item: this.libraryItemId, text })
        this.text = ''
        this.$nextTick(this.grow)
        this.live = true
        this.pane = res.pane || null
        // A revived session reads the reply once it has finished loading, which
        // can take a minute — saying "sent" there would be a small lie.
        this.status = res.opened ? 'Session reopened — it will pick this up shortly.' : 'Sent.'
        // The transcript above is a snapshot from when the page opened, and
        // this reply is not in it. It is not in the server's answer yet either
        // — the words have to be rendered and published before they are a turn
        // — so the log watches for it rather than being handed it.
        this.$emit('replied')
      } catch (error) {
        this.failed = true
        this.status = error.message || 'Could not send that.'
      }
      this.sending = false
    },
    // The box lives at the bottom of the page, so the soft keyboard opens
    // straight over it. Android resizes the viewport rather than telling the
    // page anything, so the signal is visualViewport shrinking — and the
    // keyboard animates in, so scrolling on the first frame lands where the
    // box used to be. Scroll on the resize, and again once it settles.
    keepInView() {
      this.scrollBoxIntoView()
      window.setTimeout(this.scrollBoxIntoView, 350)
    },
    scrollBoxIntoView() {
      if (!this.$refs.box) return
      this.$refs.box.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    onViewportResize() {
      // Only when the input actually has focus: the viewport also changes on
      // rotation, and yanking the page around then would be rude.
      if (this.$refs.input && document.activeElement === this.$refs.input) {
        this.scrollBoxIntoView()
      }
    },
    // The remote's assistant button cannot be borrowed — it belongs to the
    // system's voice interaction service and never reaches an app — so on a
    // television this button is the only way to put words in the box.
    async dictate() {
      if (this.listening) return
      this.listening = true
      try {
        const res = await AbsSpeechInput.listen({ prompt: 'Reply to this conversation' })
        const heard = (res?.text || '').trim()
        // Cancelled or heard nothing: leave what was already typed alone.
        if (heard) {
          this.text = this.text.trim() ? `${this.text.trim()} ${heard}` : heard
          this.$nextTick(this.grow)
        }
      } catch (error) {
        console.error('[ReplyBox] dictation failed', error)
      }
      this.listening = false
    },
    grow() {
      const el = this.$refs.input
      if (!el) return
      el.style.height = 'auto'
      // Six rows is where a reply stops being a reply; after that it scrolls.
      el.style.height = `${Math.min(el.scrollHeight, 6 * 24 + 16)}px`
    },
    jumpToBox() {
      if (!this.$refs.box) return
      this.$refs.box.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    watchBox() {
      // Only worth watching once the box exists, which is after the server has
      // said this item is a conversation.
      this.$nextTick(() => {
        if (!this.$refs.box || typeof IntersectionObserver === 'undefined') return
        this.observer = new IntersectionObserver((entries) => {
          this.boxInView = entries.some((entry) => entry.isIntersecting)
        })
        this.observer.observe(this.$refs.box)
        window.visualViewport?.addEventListener('resize', this.onViewportResize)
      })
    },
    async goToPane() {
      try {
        await this.request('POST', '/focus', { pane: this.pane })
      } catch (error) {
        console.error('[ReplyBox] focus failed', error)
      }
    },
    async init() {
      this.baseUrl = (await this.$localStore.getAgentMediaUrl()) || this.defaultBaseUrl
      if (!this.baseUrl || !this.libraryItemId) return
      try {
        const res = await this.request('GET', `/conversation?item=${this.libraryItemId}`)
        this.isConversation = !!res.ok
        this.live = !!res.live
        this.pane = res.live ? res.pane : null
        if (this.isConversation) {
          this.watchBox()
          AbsSpeechInput.available()
            .then((r) => {
              this.canDictate = !!r?.available
            })
            .catch(() => {
              this.canDictate = false
            })
        }
      } catch (error) {
        // Not a conversation, not allowed, or no canvas reachable — all of
        // which mean the same thing here: draw nothing.
        this.isConversation = false
      }
    }
  },
  mounted() {
    this.init()
  },
  beforeDestroy() {
    if (this.observer) this.observer.disconnect()
    window.visualViewport?.removeEventListener('resize', this.onViewportResize)
  }
}
</script>
