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
  <div v-if="isConversation" class="w-full mt-4">
    <div class="flex items-center mb-1.5">
      <span class="material-symbols text-lg text-fg-muted">reply</span>
      <p class="px-1.5 text-sm text-fg-muted">Reply to this conversation</p>
      <div class="flex-grow" />
      <p v-if="!live" class="text-xs text-fg-muted">session ended</p>
    </div>

    <div class="flex items-center">
      <ui-text-input v-model="text" :disabled="sending" :autofocus="false" placeholder="Say something back…" class="flex-grow text-sm" @keyup.enter.native="send" />
      <ui-btn :disabled="!text.trim() || sending" :loading="sending" color="success" :padding-x="3" class="ml-2 flex items-center justify-center" @click="send">
        <span class="material-symbols text-xl">send</span>
      </ui-btn>
    </div>

    <div v-if="status" class="mt-1.5 flex items-center">
      <p class="text-xs" :class="failed ? 'text-error' : 'text-fg-muted'">{{ status }}</p>
      <p v-if="pane" class="text-xs text-info underline pl-2" @click="goToPane">go to {{ pane }}</p>
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
      isConversation: false,
      live: false,
      text: '',
      sending: false,
      status: '',
      failed: false,
      pane: null
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
        this.live = true
        this.pane = res.pane || null
        // A revived session reads the reply once it has finished loading, which
        // can take a minute — saying "sent" there would be a small lie.
        this.status = res.opened ? 'Session reopened — it will pick this up shortly.' : 'Sent.'
      } catch (error) {
        this.failed = true
        this.status = error.message || 'Could not send that.'
      }
      this.sending = false
    },
    async goToPane() {
      try {
        await this.request('POST', '/focus', { pane: this.pane })
      } catch (error) {
        console.error('[ReplyBox] focus failed', error)
      }
    },
    async init() {
      this.baseUrl = await this.$localStore.getAgentMediaUrl()
      if (!this.baseUrl || !this.libraryItemId) return
      try {
        const res = await this.request('GET', `/conversation?item=${this.libraryItemId}`)
        this.isConversation = !!res.ok
        this.live = !!res.live
        this.pane = res.live ? res.pane : null
      } catch (error) {
        // Not a conversation, not allowed, or no canvas reachable — all of
        // which mean the same thing here: draw nothing.
        this.isConversation = false
      }
    }
  },
  mounted() {
    this.init()
  }
}
</script>
