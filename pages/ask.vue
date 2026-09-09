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

    <!-- Where the words go. "New chat" unless a conversation is picked here,
         named at the start of the words ("reply to drones, …"), loaded in the
         player, or was the last one spoken to; the server decides in that
         order and says which it chose. -->
    <div v-if="baseUrl && !session" class="flex items-center px-3 py-2 border-b border-border flex-shrink-0" @click="openPicker">
      <p class="text-xs text-fg-muted">To</p>
      <p class="text-sm px-2 flex-grow truncate" :class="target ? '' : 'text-fg-muted'">{{ target ? target.title : sticky ? `${sticky.title} (last)` : 'New chat' }}</p>
      <span class="material-symbols text-lg text-fg-muted">expand_more</span>
    </div>

    <div class="flex-grow min-h-0 overflow-y-auto px-3 py-4">
      <p v-if="!baseUrl" class="text-sm text-error">No agent-media canvas is set — see Settings.</p>
      <template v-else-if="pickerOpen">
        <p v-if="ambiguous" class="text-sm text-fg-muted pb-2">Which conversation?</p>
        <div v-else class="flex items-center py-2 border-b border-border" @click="pick(null)">
          <span class="material-symbols text-lg text-fg-muted">add_comment</span>
          <p class="text-sm pl-2">New chat</p>
        </div>
        <div v-for="row in pickerRows" :key="row.session" class="flex items-center py-2 border-b border-border" @click="pick(row)">
          <span class="material-symbols text-lg" :class="row.live ? 'text-success' : 'text-fg-muted'">{{ row.live ? 'radio_button_checked' : 'history' }}</span>
          <p class="text-sm pl-2 truncate">{{ row.title }}</p>
        </div>
        <p v-if="!pickerRows.length" class="text-sm text-fg-muted py-2">Nothing to pick from yet.</p>
      </template>
      <template v-else-if="confirm">
        <p class="text-sm">{{ confirm.text }}</p>
        <p class="text-sm text-fg-muted pt-3">Sending to <span class="text-fg">{{ confirm.title }}</span> in {{ countdown }}…</p>
        <div class="flex items-center pt-3">
          <ui-btn color="primary" small @click="changeDestination">Change</ui-btn>
          <ui-btn color="success" small class="ml-2" @click="commitConfirmed">Send now</ui-btn>
        </div>
      </template>
      <template v-else-if="!session">
        <p class="text-sm text-fg-muted">Say or type what you want to talk about. Start with a conversation's name to continue it — "reply to drones, …" — or "new chat" to force a fresh one.</p>
      </template>
      <template v-else>
        <p class="text-sm">{{ sentText }}</p>
        <div class="flex items-center pt-3">
          <span v-if="!settled" class="thinking-dot" />
          <p class="text-sm text-fg-muted" :class="settled ? '' : 'pl-2'">{{ status }}</p>
        </div>
        <p v-if="pane" class="text-xs text-info underline pt-2" @click="goToPane">go to {{ pane }}</p>
        <p v-if="continued" class="text-xs text-info underline pt-2" @click="sendAsNew">Meant a new chat? Send it there instead</p>
      </template>
      <p v-if="failed" class="text-sm text-error pt-3">{{ status }}</p>
    </div>

    <div v-if="baseUrl && !session && !confirm" class="flex-shrink-0 px-3 pt-2 pb-3 border-t border-border bg-bg">
      <div class="flex items-end">
        <textarea ref="input" v-model="text" rows="1" :disabled="sending" placeholder="What shall we talk about?" class="flex-grow text-sm py-2 px-2 rounded-sm bg-bg text-fg border border-border outline-none resize-none overflow-y-auto" @input="grow" @keydown.enter.exact.prevent="send()" />
        <ui-btn v-if="canDictate" :disabled="sending" color="primary" :padding-x="3" class="ml-2 flex items-center justify-center" @click="dictate()">
          <span class="material-symbols text-xl" :class="listening ? 'animate-pulse' : ''">mic</span>
        </ui-btn>
        <ui-btn :disabled="!text.trim() || sending" :loading="sending" color="success" :padding-x="3" class="ml-2 flex items-center justify-center" @click="send()">
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
      pollUntil: 0,
      // Routing: what is picked here, the last thread spoken to, and the
      // picker's rows (the server's list, or the candidates it could not
      // choose between).
      target: null,
      sticky: null,
      pickerOpen: false,
      pickerRows: [],
      ambiguous: false,
      continued: false,
      settled: false,
      // A guessed destination waiting for a nod: `{session, title, text}`,
      // sent when the countdown runs out unless changed.
      confirm: null,
      countdown: 0,
      countdownTimer: null
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
    async send({ forceNew = false } = {}) {
      // The field's own value: v-model lags the keyboard's composing word
      // (see ReplyBox).
      const el = this.$refs.input
      const text = ((el && el.value) || this.text || '').trim()
      if (!text || this.sending) return
      this.sending = true
      this.failed = false
      this.pickerOpen = false
      this.status = 'Sending…'
      const playing = this.$store.state.currentPlaybackSession?.libraryItemId || ''
      const body = {
        text,
        target: this.target ? this.target.session : forceNew ? 'new' : '',
        player_item: playing,
        sticky: this.sticky?.session || '',
        // A picked target is the answer; the words are not read for one.
        parse: !this.target && !forceNew
      }
      try {
        // When the server would be guessing — nothing picked, no forced new
        // chat — ask where the words would go first. A new chat needs no
        // nod; a guessed thread gets a countdown the listener can stop.
        if (body.parse) {
          const dry = await this.request('POST', '/ask', { ...body, dry: true })
          if (dry.ambiguous) {
            this.text = dry.text || text
            this.pickerRows = dry.ambiguous
            this.ambiguous = true
            this.pickerOpen = true
            this.status = ''
            this.sending = false
            return
          }
          if (dry.mode === 'switched') {
            this.onSent(dry, text)
            this.sending = false
            return
          }
          if (dry.mode === 'continued' && dry.session) {
            this.sending = false
            this.status = ''
            this.startConfirm({ session: dry.session, title: dry.title || 'that conversation', text: dry.text || text })
            return
          }
          // A fresh session: commit as asked, with the trimmed words.
          body.text = dry.text || text
          body.target = 'new'
          body.parse = false
        }
        const res = await this.request('POST', '/ask', body)
        if (res.ambiguous) {
          // 300: the spoken name fits more than one conversation. Nothing
          // was sent; the candidates are the picker and the words stay put.
          this.text = res.text || text
          this.pickerRows = res.ambiguous
          this.ambiguous = true
          this.pickerOpen = true
          this.status = ''
          this.sending = false
          return
        }
        this.onSent(res, text)
      } catch (error) {
        this.failed = true
        this.status = error.message || 'Could not send that.'
      }
      this.sending = false
    },
    onSent(res, text) {
      {
        this.sentText = res.text || text
        this.text = ''
        this.pane = res.pane || null
        this.session = res.session || '?'
        this.continued = res.mode === 'continued'
        if (res.mode === 'switched') {
          // A name and nothing else: go there, and make it the thread the
          // next press continues.
          this.$localStore.setAskLast({ session: res.session, title: res.title || '' })
          this.sticky = { session: res.session, title: res.title || '' }
          if (res.item) {
            this.$router.replace(`/item/${res.item}`)
            return
          }
          this.session = null
          this.target = { session: res.session, title: res.title || '' }
          this.status = `Switched to ${res.title || 'that conversation'}.`
          return
        }
        if (this.continued) {
          // Remember the thread for the next press, and go to it.
          this.$localStore.setAskLast({ session: res.session, title: res.title || '' })
          this.status = `Sent to ${res.title || 'the conversation'}${res.opened ? ' (reopened)' : ''}.`
          if (res.item) {
            this.$router.replace(`/item/${res.item}`)
            return
          }
          this.settled = true
        } else if (res.session && res.session !== '?') {
          this.$localStore.setAskLast({ session: res.session, title: '' })
          this.status = 'Session open — waiting for the first reply…'
          this.pollUntil = Date.now() + ITEM_WAIT_MS
          this.poll()
        } else {
          // Delivered, but the session's id never surfaced: nothing to wait
          // for here. The pane link is the way to it.
          this.settled = true
          this.status = `Sent to ${this.pane || 'the host'}.`
        }
      }
    },
    startConfirm(confirm) {
      this.confirm = confirm
      this.countdown = 4
      this.countdownTimer = setInterval(() => {
        this.countdown -= 1
        if (this.countdown <= 0) this.commitConfirmed()
      }, 1000)
    },
    stopConfirm() {
      if (this.countdownTimer) clearInterval(this.countdownTimer)
      this.countdownTimer = null
    },
    async commitConfirmed() {
      const c = this.confirm
      this.stopConfirm()
      if (!c) return
      this.confirm = null
      this.target = { session: c.session, title: c.title }
      this.text = c.text
      await this.$nextTick()
      this.send()
    },
    changeDestination() {
      const c = this.confirm
      this.stopConfirm()
      this.confirm = null
      this.text = c ? c.text : this.text
      this.openPicker()
    },
    // The server routed the words to an existing thread and that was wrong:
    // send the same words to a fresh session. The first copy stays where it
    // went — typed words cannot be untyped.
    sendAsNew() {
      const text = this.sentText
      this.session = null
      this.continued = false
      this.settled = false
      this.target = null
      this.text = text
      this.$nextTick(() => this.send({ forceNew: true }))
    },
    async openPicker() {
      this.ambiguous = false
      this.pickerOpen = true
      try {
        const res = await this.request('GET', '/conversations')
        this.pickerRows = res.sessions || []
      } catch (error) {
        this.pickerRows = []
      }
    },
    pick(row) {
      const answering = this.ambiguous
      // "New chat" picked outright forces a fresh session, over the player
      // and the last thread alike.
      this.target = row ? { session: row.session, title: row.title } : { session: 'new', title: 'New chat' }
      this.pickerOpen = false
      this.ambiguous = false
      if (row && answering && this.text.trim()) {
        // Picked to answer "which conversation?": the words are ready, send.
        this.send()
      }
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
        // `scanning`: the library has the folder and is still building the
        // item; opening it now fails, so this keeps waiting.
        this.status = res.scanning ? 'Reply shelved — the library is scanning it…' : res.live ? 'Session open — waiting for the first reply…' : 'The session ended before it was shelved.'
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
    onAssist(taken) {
      if (taken) taken.push(true)
      if (this.canDictate) this.dictate({ submit: true })
    },
    async init() {
      this.baseUrl = await this.$localStore.agentMediaBaseUrl(this.$store.state.user.serverConnectionConfig?.address)
      if (!this.baseUrl) return
      this.sticky = await this.$localStore.getAskLast()
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
    this.stopConfirm()
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
