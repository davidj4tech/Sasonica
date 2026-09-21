<template>
  <!-- Sasonica: install a harness on the canvas host, and sign into it. -->
  <div>
    <div class="flex items-center">
      <p class="uppercase text-xs font-semibold text-fg-muted">Agents</p>
      <div class="flex-grow" />
      <span v-if="loading" class="text-xs text-fg-muted">checking…</span>
      <button v-else class="material-icons text-lg text-fg-muted" @click="load">refresh</button>
    </div>
    <p v-if="!agents.length && !loading" class="text-xs text-fg-muted pt-2">No canvas to ask, or it is too old to know about agents.</p>

    <div v-for="agent in agents" :key="agent.name" class="py-3 border-b border-border">
      <div class="flex items-center">
        <div class="flex-grow">
          <p class="capitalize">{{ agent.name }}</p>
          <p class="text-xs text-fg-muted pt-0.5">{{ describe(agent) }}</p>
        </div>
        <ui-btn v-if="agent.actions.includes('install')" small class="ml-2 text-xs" @click="run(agent, 'install')">
          {{ agent.installed_action === 'update' ? 'Update' : 'Install' }}
        </ui-btn>
        <ui-btn v-if="agent.actions.includes('login')" small class="ml-2 text-xs" @click="run(agent, 'login')">Sign in</ui-btn>
      </div>
    </div>

    <!-- The window that install or sign-in is running in, as the desk sees it. -->
    <div v-if="pane" class="mt-4 rounded-md border border-border overflow-hidden">
      <div class="flex items-center px-3 py-2 bg-bg-alt">
        <p class="text-xs font-mono flex-grow truncate">{{ cmd }}</p>
        <span v-if="done" class="text-xs text-fg-muted pr-2">exit {{ exit }}</span>
        <button class="material-icons text-lg text-fg-muted" @click="close">close</button>
      </div>
      <pre class="px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all max-h-72 overflow-y-auto">{{ lines.join('\n') }}</pre>
      <div v-if="!done" class="flex items-center px-3 py-2 border-t border-border">
        <input v-model="typed" class="flex-grow bg-transparent text-sm font-mono outline-none" placeholder="paste a code…" @keyup.enter="send(typed, 'Enter')" />
        <button class="text-xs px-2 text-fg-muted" @click="send('', 'Enter')">Enter</button>
        <button class="text-xs px-2 text-fg-muted" @click="send('y', 'Enter')">y</button>
        <button class="text-xs px-2 text-fg-muted" @click="send(typed, 'Enter')">Send</button>
      </div>
    </div>
  </div>
</template>

<script>
import { fetchAgents, runAgentAction, agentScreen, agentKeys, closeAgentWindow } from '@/utils/sasonicaAgents'

/** How often the open window is re-read. Installs are slow, sign-ins are not. */
const POLL_MS = 1500

export default {
  data() {
    return {
      agents: [],
      loading: false,
      pane: '',
      cmd: '',
      lines: [],
      done: false,
      exit: null,
      typed: '',
      timer: null
    }
  },
  mounted() {
    this.load()
  },
  beforeDestroy() {
    this.stopPolling()
  },
  methods: {
    describe(agent) {
      if (!agent.present) return 'not installed'
      const bits = [agent.version || 'installed']
      // Only Claude and Codex will say; the other two are reported honestly
      // as unknown rather than guessed at.
      if (agent.auth === 'in') bits.push(agent.account ? `signed in (${agent.account})` : 'signed in')
      else if (agent.auth === 'out') bits.push('signed out')
      return bits.join(' · ')
    },
    async load() {
      this.loading = true
      this.agents = await fetchAgents(this)
      this.loading = false
    },
    async run(agent, action) {
      const started = await runAgentAction(this, agent.name, action)
      if (!started) {
        this.$toast?.error(`Could not ${action} ${agent.name}`)
        return
      }
      this.pane = started.pane
      this.cmd = started.cmd
      this.lines = []
      this.done = false
      this.exit = null
      this.typed = ''
      this.poll()
      this.stopPolling()
      this.timer = setInterval(this.poll, POLL_MS)
    },
    async poll() {
      if (!this.pane) return
      const screen = await agentScreen(this, this.pane)
      if (!screen) {
        // The window went away: stop watching, and re-read the agents — an
        // install that finished is the whole reason to look again.
        this.stopPolling()
        this.pane = ''
        this.load()
        return
      }
      this.lines = screen.lines || []
      this.done = !!screen.done
      this.exit = screen.exit
      if (this.done) {
        this.stopPolling()
        this.load()
      }
    },
    async send(text, key) {
      if (!this.pane) return
      await agentKeys(this, this.pane, text, key)
      this.typed = ''
      this.poll()
    },
    async close() {
      this.stopPolling()
      if (this.pane) await closeAgentWindow(this, this.pane)
      this.pane = ''
      this.load()
    },
    stopPolling() {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
    }
  }
}
</script>
