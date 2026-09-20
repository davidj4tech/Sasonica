<template>
  <div class="fixed top-0 left-0 right-0 layout-wrapper w-full z-50 overflow-hidden pointer-events-none">
    <div class="absolute top-0 left-0 w-full h-full bg-black transition-opacity duration-200" :class="show ? 'bg-opacity-60 pointer-events-auto' : 'bg-opacity-0'" @click="clickBackground" />
    <div class="absolute top-0 right-0 w-64 h-full bg-bg transform transition-transform py-6 pointer-events-auto" :class="show ? '' : 'translate-x-64'" @click.stop>
      <div class="px-6 mb-4">
        <p v-if="user" class="text-base" v-html="$getString('HeaderWelcome', [username])" />
      </div>

      <div class="w-full overflow-y-auto">
        <template v-for="item in navItems">
          <button v-if="item.action" :key="item.text" :tabindex="show ? 0 : -1" class="w-full hover:bg-bg/60 flex items-center py-3 px-6 text-fg-muted" @click="clickAction(item.action)">
            <span class="material-symbols fill text-lg">{{ item.icon }}</span>
            <p class="pl-4">{{ item.text }}</p>
          </button>
          <!-- Sasonica: New chat, and under the chevron what it could be
               pointed at — a project, which is the directory a fresh session
               opens in, or a session already running, which the words join
               instead of starting anything. -->
          <div v-else-if="item.expand" :key="item.text" class="w-full">
            <div class="w-full flex items-center" :class="currentRoutePath.startsWith(item.to) ? 'bg-bg-hover/50 text-fg' : 'text-fg-muted'">
              <nuxt-link :to="item.to" :tabindex="show ? 0 : -1" class="flex-grow hover:bg-bg/60 flex items-center py-3 pl-6 pr-2 min-w-0">
                <span class="material-symbols fill text-lg">{{ item.icon }}</span>
                <p class="pl-4 truncate">{{ item.text }}</p>
              </nuxt-link>
              <button type="button" :aria-label="targetsOpen ? 'Hide projects and sessions' : 'Show projects and sessions'" :tabindex="show ? 0 : -1" class="h-11 px-4 flex items-center hover:bg-bg/60" @click="toggleTargets">
                <span class="material-symbols text-lg">{{ targetsOpen ? 'expand_less' : 'expand_more' }}</span>
              </button>
            </div>
            <div v-if="targetsOpen" class="w-full pb-1">
              <button v-for="name in projects" :key="`project-${name}`" type="button" :tabindex="show ? 0 : -1" class="w-full hover:bg-bg/60 flex items-center py-2 pl-14 pr-6 text-fg-muted" @click="newChatIn(name)">
                <p class="text-sm truncate">{{ name }}</p>
              </button>
              <nuxt-link v-if="projects.length" to="/bookshelf/series" :tabindex="show ? 0 : -1" class="w-full hover:bg-bg/60 flex items-center py-2 pl-14 pr-6 text-fg-muted/70">
                <p class="text-sm truncate">All projects…</p>
              </nuxt-link>
              <template v-if="liveSessions.length">
                <p class="text-xs text-fg-muted/70 pl-14 pr-6 pt-2 pb-1">Running</p>
                <button v-for="row in liveSessions" :key="row.session" type="button" :tabindex="show ? 0 : -1" class="w-full hover:bg-bg/60 flex items-center py-2 pl-12 pr-6 text-fg-muted" @click="goToSession(row)">
                  <span class="material-symbols text-sm text-success">radio_button_checked</span>
                  <p class="text-sm pl-2 truncate">{{ row.title }}</p>
                </button>
              </template>
              <p v-if="targetsLoading" class="text-sm text-fg-muted/70 py-2 pl-14 pr-6">Looking…</p>
              <p v-else-if="!projects.length && !liveSessions.length" class="text-sm text-fg-muted/70 py-2 pl-14 pr-6">Nothing to point it at yet.</p>
            </div>
          </div>
          <nuxt-link v-else :to="item.to" :key="item.text" :tabindex="show ? 0 : -1" class="w-full hover:bg-bg/60 flex items-center py-3 px-6 text-fg" :class="currentRoutePath.startsWith(item.to) ? 'bg-bg-hover/50' : 'text-fg-muted'">
            <span class="material-symbols fill text-lg">{{ item.icon }}</span>
            <p class="pl-4">{{ item.text }}</p>
          </nuxt-link>
        </template>
      </div>
      <div class="absolute bottom-0 left-0 w-full py-6 px-6 text-fg">
        <div v-if="serverConnectionConfig" class="mb-4 flex justify-center">
          <p class="text-xs text-fg-muted" style="word-break: break-word">{{ serverConnectionConfig.address }} (v{{ serverSettings.version }})</p>
        </div>
        <div class="flex items-center">
          <p class="text-xs">{{ $config.version }}</p>
          <div class="flex-grow" />
          <div v-if="user" class="flex items-center" @click="disconnect">
            <p class="text-xs pr-2">{{ $strings.ButtonDisconnect }}</p>
            <i class="material-symbols text-sm -mb-0.5">cloud_off</i>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import TouchEvent from '@/objects/TouchEvent'
import { fetchProjects } from '@/utils/sasonicaProjects' // Sasonica

export default {
  data() {
    return {
      touchEvent: null,
      // Sasonica: what a new chat can be pointed at, once the chevron is opened.
      targetsOpen: false,
      targetsLoading: false,
      projects: [],
      liveSessions: []
    }
  },
  watch: {
    $route: {
      handler() {
        this.show = false
      }
    },
    show: {
      handler(newVal) {
        if (newVal) this.registerListener()
        else this.removeListener()
      }
    }
  },
  computed: {
    show: {
      get() {
        return this.$store.state.showSideDrawer
      },
      set(val) {
        this.$store.commit('setShowSideDrawer', val)
      }
    },
    user() {
      return this.$store.state.user.user
    },
    serverConnectionConfig() {
      return this.$store.state.user.serverConnectionConfig
    },
    serverSettings() {
      return this.$store.state.serverSettings || {}
    },
    username() {
      return this.user?.username || ''
    },
    userIsAdminOrUp() {
      return this.$store.getters['user/getIsAdminOrUp']
    },
    navItems() {
      var items = [
        {
          icon: 'home',
          text: this.$strings.ButtonHome,
          to: '/bookshelf'
        }
      ]
      if (!this.serverConnectionConfig) {
        items = [
          {
            icon: 'cloud_off',
            text: this.$strings.ButtonConnectToServer,
            to: '/connect'
          }
        ].concat(items)
      } else {
        items.push({
          icon: 'person',
          text: this.$strings.HeaderAccount,
          to: '/account'
        })
        items.push({
          icon: 'equalizer',
          text: this.$strings.ButtonUserStats,
          to: '/stats'
        })
        // Sasonica: a new conversation with the agent behind the library,
        // with the projects and running sessions folded under it.
        items.push({
          icon: 'add_comment',
          text: 'New chat',
          to: '/ask',
          expand: true
        })
      }

      if (this.$platform !== 'ios') {
        items.push({
          icon: 'folder',
          iconOutlined: true,
          text: this.$strings.ButtonLocalMedia,
          to: '/localMedia/folders'
        })
      } else {
        items.push({
          icon: 'download',
          iconOutlined: false,
          text: this.$strings.HeaderDownloads,
          to: '/downloads'
        })
      }
      items.push({
        icon: 'settings',
        text: this.$strings.HeaderSettings,
        to: '/settings'
      })

      items.push({
        icon: 'bug_report',
        iconOutlined: true,
        text: this.$strings.ButtonLogs,
        to: '/logs'
      })

      if (this.serverConnectionConfig) {
        items.push({
          icon: 'language',
          text: this.$strings.ButtonGoToWebClient,
          action: 'openWebClient'
        })

        items.push({
          icon: 'login',
          text: this.$strings.ButtonSwitchServerUser,
          action: 'logout'
        })
      }

      return items
    },
    currentRoutePath() {
      return this.$route.path
    }
  },
  methods: {
    // Sasonica: the projects are the Conversations library's series, and the
    // running sessions come from the canvas. Both are read again each time
    // the list is opened — a session list goes stale in minutes.
    async toggleTargets() {
      await this.$hapticsImpact()
      this.targetsOpen = !this.targetsOpen
      if (this.targetsOpen) this.loadTargets()
    },
    async loadTargets() {
      this.targetsLoading = true
      await Promise.all([this.loadProjects(), this.loadSessions()])
      this.targetsLoading = false
    },
    async loadProjects() {
      this.projects = await fetchProjects(this)
    },
    async loadSessions() {
      const token = this.$store.getters['user/getToken']
      const base = token ? await this.$localStore.agentMediaBaseUrl(this.serverConnectionConfig?.address) : ''
      if (!base) {
        this.liveSessions = []
        return
      }
      try {
        const res = await this.$nativeHttp.request('GET', `${base}/conversations`, null, {
          headers: { Authorization: `Bearer ${token}` }
        })
        this.liveSessions = (res?.sessions || []).filter((row) => row.live)
      } catch (error) {
        // No canvas, or an older one: the projects stand on their own.
        this.liveSessions = []
      }
    },
    // A project: a fresh session in the directory its conversations run in.
    newChatIn(project) {
      this.show = false
      this.$router.push({ path: '/ask', query: { project } }).catch(() => {})
    },
    // A session already running: the words go to it, not to a new one.
    goToSession(row) {
      this.show = false
      this.$router.push({ path: '/ask', query: { session: row.session, title: row.title || '' } }).catch(() => {})
    },
    async clickAction(action) {
      await this.$hapticsImpact()
      if (action === 'logout') {
        await this.logout()
        this.$router.push('/connect')
      } else if (action === 'openWebClient') {
        this.show = false
        let path = `/library/${this.$store.state.libraries.currentLibraryId}`
        await this.$store.dispatch('user/openWebClient', path)
      }
    },
    clickBackground() {
      this.show = false
    },
    async logout() {
      await this.$store.dispatch('user/logout')
    },
    async disconnect() {
      await this.$hapticsImpact()
      await this.logout()

      // Redirect to home page
      if (this.$route.name !== 'bookshelf') {
        this.$router.replace('/bookshelf')
      }

      // If player is open and not playing locally, then close the player
      if (this.$store.getters['getIsPlayerOpen']) {
        this.$eventBus.$emit('close-stream')
      }

      // Close side drawer
      this.show = false
    },
    touchstart(e) {
      this.touchEvent = new TouchEvent(e)
    },
    touchend(e) {
      if (!this.touchEvent) return
      this.touchEvent.setEndEvent(e)
      if (this.touchEvent.isSwipeRight()) {
        this.show = false
      }
      this.touchEvent = null
    },
    registerListener() {
      document.addEventListener('touchstart', this.touchstart)
      document.addEventListener('touchend', this.touchend)
    },
    removeListener() {
      document.removeEventListener('touchstart', this.touchstart)
      document.removeEventListener('touchend', this.touchend)
    }
  },
  mounted() {},
  beforeDestroy() {
    this.show = false
  }
}
</script>
