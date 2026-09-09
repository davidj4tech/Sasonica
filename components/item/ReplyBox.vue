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
  <div v-if="isConversation" ref="box" class="w-full" :class="docked ? 'px-3 pt-2 pb-3 border-t border-border bg-bg' : 'mt-6'">
    <!-- Docked, the box needs no title: it is where the composer of every chat
         app is, and that says what it is for. The one thing worth a line is
         that the session behind it has ended. -->
    <div v-if="!docked" class="flex items-center mb-1.5">
      <span class="material-symbols text-lg text-fg-muted">reply</span>
      <p class="px-1.5 text-sm text-fg-muted">Reply to this conversation</p>
      <div class="flex-grow" />
      <p v-if="!live" class="text-xs text-fg-muted">session ended</p>
    </div>
    <p v-else-if="!live" class="text-xs text-fg-muted pb-1">Session ended — a reply reopens it.</p>

    <!-- The ghost prompt. On the terminal it is dim text in the input box,
         taken with Tab; here it is the placeholder, and this row is the Tab:
         a tap puts the words in the box to send or edit. It shows only while
         the box is empty, as the ghost does. -->
    <div v-if="ghost" class="flex items-center pb-1" @click="acceptGhost">
      <span class="material-symbols text-base text-fg-muted">keyboard_tab</span>
      <p class="text-xs text-fg-muted italic truncate px-1 flex-grow">{{ ghost }}</p>
      <p class="text-xs text-info pl-2 flex-shrink-0">use</p>
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
        :placeholder="ghost || 'Say something back…'"
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
    <div v-show="!docked && !boxInView" class="fixed right-4 z-30 rounded-full bg-primary border border-border shadow-lg w-11 h-11 flex items-center justify-center" :class="playerIsOpen ? 'bottom-28' : 'bottom-6'" @click="jumpToBox">
      <span class="material-symbols text-2xl">reply</span>
    </div>
  </div>
</template>

<script>
import { AbsSpeechInput } from '@/plugins/capacitor'

export default {
  props: {
    libraryItemId: String,
    // Pinned at the foot of a conversation page, always in view: no floating
    // button, no scrolling the page to find it. The keyboard is handled by
    // the layout — Android shrinks the viewport and the page is a column
    // whose last row this is.
    docked: Boolean,
    // Claude Code's suggested next prompt for this session, if it has one
    // on screen right now. Comes from the log's poll, via the page.
    suggestion: String
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
    // Only a live session has a ghost; and only an empty box shows one.
    ghost() {
      return this.live && !this.text && !this.sending ? (this.suggestion || '').trim() : ''
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
      // The field's own value, not the bound one. Vue's v-model holds off
      // updating while the soft keyboard is still composing the current word,
      // and Gboard keeps the last word in composition until a space follows
      // it — so a reply sent straight after its last word lost that word
      // ("yeah maybe we should tighten the"). The textarea itself has it all.
      const el = this.$refs.input
      const text = ((el && el.value) || this.text || '').trim()
      if (!text || this.sending) return
      this.text = text
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
      if (this.docked) return
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
    // `submit`: send as soon as the words are heard — the assistant button
    // pressed on this page, which should not then want a tap.
    async dictate({ submit = false } = {}) {
      if (this.listening) return
      this.listening = true
      let heard = ''
      try {
        const res = await AbsSpeechInput.listen({ prompt: 'Reply to this conversation' })
        heard = (res?.text || '').trim()
        // Cancelled or heard nothing: leave what was already typed alone.
        if (heard) {
          this.text = this.text.trim() ? `${this.text.trim()} ${heard}` : heard
          this.$nextTick(this.grow)
        }
      } catch (error) {
        console.error('[ReplyBox] dictation failed', error)
      }
      this.listening = false
      if (submit && heard) this.send()
    },
    // The assistant button, pressed while this conversation is open: a reply
    // into it. Answers whether the press was taken, so a page that is not a
    // conversation (or cannot dictate) lets it fall through to a new chat.
    assist() {
      if (!this.isConversation || !this.canDictate) return false
      this.dictate({ submit: true })
      return true
    },
    acceptGhost() {
      if (!this.ghost) return
      this.text = this.ghost
      this.$nextTick(() => {
        this.grow()
        this.$refs.input?.focus()
      })
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
      this.baseUrl = await this.$localStore.agentMediaBaseUrl(this.$store.state.user.serverConnectionConfig?.address)
      if (!this.baseUrl || !this.libraryItemId) return
      try {
        const res = await this.request('GET', `/conversation?item=${this.libraryItemId}`)
        this.isConversation = !!res.ok
        this.live = !!res.live
        this.pane = res.live ? res.pane : null
        // The page normally knows already (the item carries the flag); this
        // is for when the item came from Audiobookshelf instead.
        this.$emit('is-conversation', this.isConversation)
        if (this.isConversation) {
          if (!this.docked) this.watchBox()
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
