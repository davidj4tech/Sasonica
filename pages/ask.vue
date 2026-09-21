<template>
  <!--
    Sasonica: a new conversation.

    Where the assistant button lands, and where "New chat" in the drawer
    goes. From the button the page listens at once, and the words are sent a
    few seconds after dictation returns them, unless the box is tapped to
    edit them first — a button pressed to say something should not then want
    a tap; from the drawer (or a project's page) it opens on the text box, and
    the box waits for send, so a typed message can be read over first. The words typed (or dictated) here become the first message of a
    FRESH session on the host — Claude Code unless the agent chip says
    otherwise, and agent-media opens it in the scratch tmux session — and the page then waits for the library to grow
    an item for that session, which happens once its first turn is shelved,
    and moves to it. Same credential as a reply: the Audiobookshelf token.

    `?project=<series name>`, from a project's page: the fresh session opens
    in that project's directory instead, and the words go nowhere else.

    `?session=<uuid>&title=<name>`, from the drawer's list of running
    sessions: the words go to that session, as if it had been picked here.

    `?cwd=<directory>`, from the canvas's own list of places: a fresh session
    in that directory. Same as `project=`, without a library in the middle.
  -->
  <div class="w-full h-full flex flex-col bg-bg">
    <div class="flex items-center px-3 py-2 border-b border-border flex-shrink-0">
      <span class="material-symbols text-xl text-fg-muted">add_comment</span>
      <h1 class="text-base font-semibold flex-grow truncate pl-2">{{ heading }}</h1>
    </div>

    <!-- Where the words go. "New chat" unless a conversation is picked here,
         named at the start of the words ("reply to drones, …"), loaded in the
         player, or was the last one spoken to; the server decides in that
         order and says which it chose. -->
    <div v-if="baseUrl && !session" class="flex items-center px-3 py-2 border-b border-border flex-shrink-0" @click="togglePicker">
      <p class="text-xs text-fg-muted">To</p>
      <p class="text-sm px-2 flex-grow truncate" :class="target ? '' : 'text-fg-muted'">{{ target ? target.title : project ? newLabel : sticky ? `${sticky.title} (last)` : 'New chat' }}</p>
      <!-- Sasonica: which agent a FRESH session runs. Claude unless tapped;
           a continued conversation keeps the agent it was started with, so
           the chip is only here while the destination is a new chat. -->
      <p v-if="isNew" class="text-xs px-2 py-0.5 mr-2 rounded-full border border-border" :class="agent === 'claude' ? 'text-fg-muted' : 'text-fg'" @click.stop="cycleAgent">{{ agentLabel }}</p>
      <span class="material-symbols text-lg text-fg-muted">{{ pickerOpen ? 'expand_less' : 'expand_more' }}</span>
    </div>

    <div class="flex-grow min-h-0 overflow-y-auto px-3 py-4">
      <p v-if="!baseUrl" class="text-sm text-error">No agent-media canvas is set — see Settings.</p>
      <template v-else-if="pickerOpen">
        <p v-if="ambiguous" class="text-sm text-fg-muted pb-2">Which conversation?</p>
        <div v-else class="flex items-center py-2 border-b border-border" @click="pick(null)">
          <span class="material-symbols text-lg text-fg-muted">add_comment</span>
          <p class="text-sm pl-2">{{ newLabel }}</p>
        </div>
        <!-- Sasonica: the places — a fresh session in that directory. -->
        <template v-if="!ambiguous && projects.length">
          <div v-for="place in projects" :key="`place-${place.path}`" class="flex items-center py-2 pl-6 border-b border-border" @click="pickProject(place)">
            <span class="material-symbols text-lg text-fg-muted">folder</span>
            <p class="text-sm pl-2 truncate">{{ place.name }}</p>
          </div>
        </template>
        <div v-for="row in pickerRows" :key="row.session" class="flex items-center py-2 border-b border-border" @click="pick(row)">
          <!-- Sasonica: a live row wears the same dot as its card on the
               Conversations shelf — working amber, needs-approval red —
               so one session does not read two ways in two lists. -->
          <span v-if="row.live" class="w-[18px] flex items-center justify-center flex-shrink-0">
            <span class="w-2 h-2 rounded-full" :class="dotClass(row)" :title="dotTitle(row)" />
          </span>
          <span v-else class="material-symbols text-lg text-fg-muted">history</span>
          <p class="text-sm pl-2 truncate">{{ row.title }}</p>
        </div>
        <p v-if="!pickerRows.length" class="text-sm text-fg-muted py-2">Nothing to pick from yet.</p>
      </template>
      <template v-else-if="confirm">
        <p class="text-sm">{{ confirm.text }}</p>
        <p class="text-sm text-fg-muted pt-3">
          Sending to <span class="text-fg">{{ confirm.title }}</span> in {{ countdown }}…
        </p>
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
      <!-- Sasonica: the slash menu, when a message starts with one. -->
      <item-slash-menu :commands="slashMatches" :selected="slashIndex" @select="chooseSlashCommand" />
      <div class="flex items-end">
        <textarea
          ref="input"
          v-model="text"
          rows="1"
          :disabled="sending"
          placeholder="What shall we talk about?"
          class="flex-grow text-sm py-2 px-2 rounded-sm bg-bg text-fg border border-border outline-none resize-none overflow-y-auto"
          enterkeyhint="enter"
          @input="onInput"
          @click="stopAutoSend"
          @keydown.enter.exact="onSlashEnter" @keydown.down.exact="slashMatches.length && (moveSlashSelection(1), $event.preventDefault())" @keydown.up.exact="slashMatches.length && (moveSlashSelection(-1), $event.preventDefault())" @keydown.esc.exact="closeSlashMenu"
          @keydown.enter.ctrl.exact.prevent="send()"
          @keydown.enter.meta.exact.prevent="send()"
        />
        <ui-btn v-if="canDictate" :disabled="sending" color="primary" :padding-x="3" class="ml-2 flex items-center justify-center" @click="dictate()">
          <span class="material-symbols text-xl" :class="listening ? 'animate-pulse' : ''">mic</span>
        </ui-btn>
        <ui-btn :disabled="!text.trim() || sending" :loading="sending" color="success" :padding-x="3" class="ml-2 flex items-center justify-center" @click="send()">
          <span class="material-symbols text-xl">send</span>
        </ui-btn>
      </div>
      <p v-if="autoSendIn" class="text-xs text-fg-muted pt-1.5">Sending in {{ autoSendIn }}… tap the text to edit it</p>
    </div>
  </div>
</template>

<script>
import { AbsSpeechInput } from '@/plugins/capacitor'
import autoSend from '@/mixins/autoSend'
import sasonicaSlash from '@/mixins/sasonicaSlash' // Sasonica
import { fetchTargets } from '@/utils/sasonicaTargets' // Sasonica
import { sessionDotClass, sessionDotTitle } from '@/utils/sasonicaSessionState' // Sasonica

// How long to wait for the library to show the new conversation. The first
// turn is exported a minute after it is spoken, then Audiobookshelf has to
// notice the folder; five minutes covers a slow first reply.
const ITEM_WAIT_MS = 5 * 60 * 1000
const ITEM_POLL_MS = 3000

// Sasonica: the agents a new chat can run, as agent-media names them
// (`AGENT_COMMANDS` in its canvas). Tapping the chip goes round them.
const AGENT_LABELS = { claude: 'Claude', codex: 'Codex', pi: 'pi' }
const AGENTS = Object.keys(AGENT_LABELS)

export default {
  mixins: [autoSend, sasonicaSlash], // Sasonica
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
      countdownTimer: null,
      // Sasonica: the projects a new chat can open in, read when the picker is.
      projects: [],
      // Sasonica: what each live session is doing, `{session: state}`, read
      // with the picker's rows. The shelf polls this too, but its mixin
      // empties the store when it leaves the screen, so this page asks for
      // its own copy rather than showing a map nobody is refreshing.
      states: {},
      // Sasonica: the agent a fresh session runs. Claude every time the page
      // opens — the other two are asked for, never defaulted to.
      agent: 'claude'
    }
  },
  computed: {
    // A project's page sent us here: a new chat there, and only that.
    project() {
      return String(this.$route.query.project || '').trim()
    },
    // Sasonica: or a place from the canvas's own list, which names the
    // directory outright instead of a series.
    cwd() {
      return String(this.$route.query.cwd || '').trim()
    },
    newLabel() {
      const where = this.project || this.cwd.split('/').filter(Boolean).pop() || ''
      return where ? `New chat in ${where}` : 'New chat'
    },
    // Sasonica: the title names the destination, which is the picked
    // conversation when there is one — not the new chat it is not.
    heading() {
      return this.target && this.target.session !== 'new' ? this.target.title : this.newLabel
    },
    // Sasonica: the words are headed for a fresh session — nothing picked,
    // or "New chat" picked outright. (The server may still route them to a
    // thread it guesses from the words; the chip is spent if it does.)
    isNew() {
      return !this.target || this.target.session === 'new'
    },
    agentLabel() {
      return AGENT_LABELS[this.agent] || this.agent
    }
  },
  methods: {
    request(method, path, data) {
      const token = this.$store.getters['user/getToken']
      return this.$nativeHttp.request(method, `${this.baseUrl}${path}`, data, {
        headers: { Authorization: `Bearer ${token}` }
      })
    },
    onInput() {
      this.onSlashInput((this.$refs.input && this.$refs.input.value) || this.text) // Sasonica
      this.stopAutoSend()
      this.grow()
    },
    // Sasonica: the commands belong to the directory the words will land
    // in — a picked conversation's own, else the project a new chat opens
    // in. Asked in that order: `new` is not a session, and a project left
    // over from an earlier pick would offer the wrong tree's commands.
    slashParams() {
      const session = this.target && this.target.session !== 'new' ? this.target.session : ''
      if (session) return `session=${encodeURIComponent(session)}`
      if (this.project) return `project=${encodeURIComponent(this.project)}`
      return this.cwd ? `cwd=${encodeURIComponent(this.cwd)}` : ''
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
      if (submit && heard) this.startAutoSend()
    },
    async send({ forceNew = false } = {}) {
      this.stopAutoSend()
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
        target: this.target ? this.target.session : forceNew || this.project || this.cwd ? 'new' : '',
        player_item: playing,
        sticky: this.sticky?.session || '',
        // A picked target is the answer; the words are not read for one.
        // Nor from a project's page: a chat there was asked for.
        parse: !this.target && !forceNew && !this.project && !this.cwd,
        // Sasonica: a picked conversation has its own directory, and the
        // router clears the query a tick later than a pick that sends at
        // once (answering "which conversation?"), so say so here too.
        project: this.target ? '' : this.project,
        cwd: this.target ? '' : this.cwd,
        // Sasonica: only a fresh session takes an agent.
        agent: this.isNew || forceNew ? this.agent : ''
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
          // A fresh session: commit as asked, with the trimmed words. The
          // dry run is where an agent named in the words ("new codex chat,
          // …") is read — the commit does not parse, so carry it over or
          // it is lost and the session comes up as Claude.
          body.text = dry.text || text
          body.target = 'new'
          body.parse = false
          body.agent = dry.agent || body.agent
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
          // Sasonica: say which agent answered the call — a codex chat
          // asked for in the words looks like any other one otherwise.
          this.status = `${AGENT_LABELS[res.agent] || 'Session'} open — waiting for the first reply…`
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
    // Sasonica: the arrow both ways — a list opened to look at closes again.
    togglePicker() {
      if (this.pickerOpen) {
        this.pickerOpen = false
        this.ambiguous = false
        return
      }
      this.openPicker()
    },
    async openPicker() {
      this.ambiguous = false
      this.pickerOpen = true
      // Sasonica: and what the live ones are doing, for the dots.
      this.request('GET', '/sessions/state')
        .then((res) => {
          const next = {}
          for (const row of (res && res.sessions) || []) {
            if (row && row.session) next[row.session] = row.state
          }
          this.states = next
        })
        .catch(() => {
          // No canvas, or an older one: every live row keeps the plain dot.
          this.states = {}
        })
      // Sasonica: one call for both halves — the directories a fresh chat
      // can open in, and the conversations it could go to instead.
      const { places, sessions } = await fetchTargets(this)
      this.projects = places
      this.pickerRows = sessions
    },
    // Sasonica: a place picked here is the same as arriving from a project's
    // page — a fresh session in that directory, and the query says so.
    pickProject(place) {
      this.pickerOpen = false
      this.target = null
      this.$router.replace({ path: '/ask', query: { cwd: place.path } }).catch(() => {})
      this.$nextTick(() => this.$refs.input?.focus())
    },
    // Sasonica: round the agents — three of them, so a chip beats a menu.
    cycleAgent() {
      this.agent = AGENTS[(AGENTS.indexOf(this.agent) + 1) % AGENTS.length]
    },
    // Sasonica: the dots, by the shelf's rule.
    dotClass(row) {
      return sessionDotClass(this.states[row.session])
    },
    dotTitle(row) {
      return sessionDotTitle(this.states[row.session])
    },
    pick(row) {
      const answering = this.ambiguous
      // A conversation picked here already has a directory — its own — and
      // the server ignores `project` the moment a session is named. Drop it
      // rather than leave it colouring the header and the slash menu for a
      // tree the words are not going to.
      if (row && this.project) this.$router.replace({ path: '/ask', query: {} }).catch(() => {})
      // "New chat" picked outright forces a fresh session, over the player
      // and the last thread alike.
      this.target = row ? { session: row.session, title: row.title } : { session: 'new', title: this.newLabel }
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
    // Sasonica: a session named in the query is a destination picked before
    // the page opened (the drawer's list) — same thing the picker sets.
    applyQueryTarget() {
      const session = String(this.$route.query.session || '').trim()
      if (!session) return
      this.target = { session, title: String(this.$route.query.title || '').trim() || 'that conversation' }
    },
    async init() {
      this.applyQueryTarget()
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
      // button was pressed to say something, not to look at a box. A tap on
      // "New chat" opens the box with the keyboard; the mic is beside it.
      if (this.canDictate && this.$route.query.assist === '1') {
        this.dictate({ submit: true })
      } else {
        this.$nextTick(() => this.$refs.input?.focus())
      }
    }
  },
  watch: {
    // Sasonica: the drawer can point this page somewhere else while it is
    // already up; Nuxt keeps the component, so the query is read again.
    '$route.query'() {
      this.target = null
      this.pickerOpen = false
      this.applyQueryTarget()
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
