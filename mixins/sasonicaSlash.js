// Sasonica: the slash menu.
//
// A message that starts with `/` is a command typed into a real terminal, and
// the terminal has a menu for those. This is that menu: agent-media's
// `/commands` says which commands the session's own directory offers (its
// project's skills included), and what follows is matched as you type.

// Matched the way the terminal matches: left to right from the start of the
// name, not fuzzily. `/co` offers compact, config, context — and never
// code-review by way of a letter in the middle. A command is offered under
// its aliases too, and a name that begins with the query beats an alias that
// does.
export function matches(commands, query) {
  const q = (query || '').toLowerCase()
  const beginsWith = (name) => name.toLowerCase().startsWith(q)
  const byName = commands.filter((c) => beginsWith(c.name))
  const byAlias = commands.filter(
    (c) => !beginsWith(c.name) && (c.aliases || []).some(beginsWith))
  const order = (a, b) => a.name.localeCompare(b.name)
  return [...byName.sort(order), ...byAlias.sort(order)]
}

// What is being typed as a command: the text is one token beginning with `/`
// and nothing has been sent after it yet. Once there is a space the command
// has been chosen and the rest is its arguments, so the menu closes.
export function slashQuery(text) {
  const value = text || ''
  if (!value.startsWith('/') || /\s/.test(value)) return null
  return value.slice(1)
}

export default {
  data() {
    return {
      slashCommands: [],
      slashIndex: 0,
      slashLoading: false,
      slashError: '',
      slashQueryText: null
    }
  },
  watch: {
    // The input event is the prompt cue, but a watcher is what guarantees it:
    // the box's own handler does other work first, and a draft restored or
    // words put in by dictation never raise an input event at all.
    text(value) {
      this.onSlashInput(value)
    }
  },
  computed: {
    slashMatches() {
      if (this.slashQueryText === null) return []
      // A menu that cannot be fetched says so in the box. Silence here reads
      // as "this phone has no slash menu", and the two are worth telling
      // apart without a rebuild.
      if (this.slashError) return [{ name: '', description: this.slashError, unavailable: true }]
      return matches(this.slashCommands, this.slashQueryText).slice(0, 8)
    }
  },
  methods: {
    // Called from the input's own handler. The list is fetched once, the
    // first time a slash starts a message, and kept for the page's life.
    onSlashInput(text) {
      const query = slashQuery(text)
      if (query !== this.slashQueryText) this.slashIndex = 0   // a new query, a new first
      this.slashQueryText = query
      if (query !== null) this.loadSlashCommands()
    },
    // Up and down move the highlight, as they do in the terminal; the list is
    // short, so it wraps rather than stopping at the ends. Escape closes it
    // and leaves what has been typed alone.
    moveSlashSelection(delta) {
      const count = this.slashMatches.length
      if (!count) return
      this.slashIndex = (this.slashIndex + delta + count) % count
    },
    closeSlashMenu() {
      this.slashQueryText = null
    },
    async loadSlashCommands() {
      if (this.slashCommands.length || this.slashLoading) return
      this.slashLoading = true
      try {
        const res = await this.request('GET', `/commands?${this.slashParams()}`)
        this.slashCommands = res?.commands || []
        this.slashError = this.slashCommands.length ? '' : 'No commands came back'
      } catch (error) {
        console.error('[sasonica] slash menu failed', error)
        this.slashError = `Commands unavailable: ${error?.message || error}`
      }
      this.slashLoading = false
    },
    // Enter takes the first match while the menu is open. In this box Enter
    // is otherwise a new line (a touch keyboard has no Shift+Enter) and
    // Ctrl/Cmd+Enter sends, so nothing is taken away: the menu is only open
    // while the whole message is one unsent word beginning with `/`.
    onSlashEnter(event) {
      const chosen = this.slashMatches[this.slashIndex] || this.slashMatches[0]
      if (!chosen || chosen.unavailable) return
      if (event) event.preventDefault()
      this.chooseSlashCommand(chosen)
    },
    // The chosen command, with the space that starts its arguments. The box
    // stays open and focused: a command usually wants something after it.
    chooseSlashCommand(command) {
      const text = `/${command.name} `
      this.text = text
      this.slashQueryText = null
      this.slashIndex = 0
      this.$nextTick(() => {
        const el = this.$refs.input
        if (!el) return
        el.value = text
        el.focus()
        el.setSelectionRange(text.length, text.length)
      })
    }
  }
}
