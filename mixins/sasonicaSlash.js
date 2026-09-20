// Sasonica: the slash menu.
//
// A message that starts with `/` is a command typed into a real terminal, and
// the terminal has a menu for those. This is that menu: agent-media's
// `/commands` says which commands the session's own directory offers (its
// project's skills included), and what follows is matched as you type.

// Fuzzy, the way an editor's command palette is: every letter of the query
// appears in the name in order. The score prefers a match at the start of the
// name, then at the start of a word (`cr` → `code-review`), then letters that
// run together, so the obvious candidate is first and not merely present.
export function score(name, query) {
  if (!query) return 1
  const n = name.toLowerCase()
  const q = query.toLowerCase()
  let total = 0
  let at = 0
  let previous = -2
  for (const letter of q) {
    const found = n.indexOf(letter, at)
    if (found === -1) return 0
    let points = 1
    if (found === 0) points += 10
    else if ('-_:/'.includes(n[found - 1])) points += 6
    if (found === previous + 1) points += 4
    total += points
    previous = found
    at = found + 1
  }
  // A short name matching the same letters is the better answer: `/run` over
  // `/run-skill-generator` for "run".
  return total + Math.max(0, 20 - name.length) / 10
}

export function rank(commands, query) {
  return commands
    .map((command) => ({ command, score: score(command.name, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
    .map((row) => row.command)
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
      slashLoading: false,
      slashQueryText: null
    }
  },
  computed: {
    slashMatches() {
      if (this.slashQueryText === null) return []
      return rank(this.slashCommands, this.slashQueryText).slice(0, 8)
    }
  },
  methods: {
    // Called from the input's own handler. The list is fetched once, the
    // first time a slash starts a message, and kept for the page's life.
    onSlashInput(text) {
      this.slashQueryText = slashQuery(text)
      if (this.slashQueryText !== null) this.loadSlashCommands()
    },
    async loadSlashCommands() {
      if (this.slashCommands.length || this.slashLoading) return
      this.slashLoading = true
      try {
        const res = await this.request('GET', `/commands?${this.slashParams()}`)
        this.slashCommands = res?.commands || []
      } catch (error) {
        console.error('[sasonica] slash menu failed', error)
      }
      this.slashLoading = false
    },
    // Enter takes the first match while the menu is open. In this box Enter
    // is otherwise a new line (a touch keyboard has no Shift+Enter) and
    // Ctrl/Cmd+Enter sends, so nothing is taken away: the menu is only open
    // while the whole message is one unsent word beginning with `/`.
    onSlashEnter(event) {
      const first = this.slashMatches[0]
      if (!first) return
      if (event) event.preventDefault()
      this.chooseSlashCommand(first)
    },
    // The chosen command, with the space that starts its arguments. The box
    // stays open and focused: a command usually wants something after it.
    chooseSlashCommand(command) {
      const text = `/${command.name} `
      this.text = text
      this.slashQueryText = null
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
