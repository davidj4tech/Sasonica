import { Preferences } from '@capacitor/preferences'

class LocalStorage {
  constructor(vuexStore) {
    this.vuexStore = vuexStore
  }

  async setUserSettings(settings) {
    try {
      await Preferences.set({ key: 'userSettings', value: JSON.stringify(settings) })
    } catch (error) {
      console.error('[LocalStorage] Failed to update user settings', error)
    }
  }

  async getUserSettings() {
    try {
      const settingsObj = await Preferences.get({ key: 'userSettings' }) || {}
      return settingsObj.value ? JSON.parse(settingsObj.value) : null
    } catch (error) {
      console.error('[LocalStorage] Failed to get user settings', error)
      return null
    }
  }

  async setServerSettings(settings) {
    try {
      await Preferences.set({ key: 'serverSettings', value: JSON.stringify(settings) })
      console.log('Saved server settings', JSON.stringify(settings))
    } catch (error) {
      console.error('[LocalStorage] Failed to update server settings', error)
    }
  }

  async getServerSettings() {
    try {
      var settingsObj = await Preferences.get({ key: 'serverSettings' }) || {}
      return settingsObj.value ? JSON.parse(settingsObj.value) : null
    } catch (error) {
      console.error('[LocalStorage] Failed to get server settings', error)
      return null
    }
  }

  async setPlayerSettings(playerSettings) {
    try {
      await Preferences.set({ key: 'playerSettings', value: JSON.stringify(playerSettings) })
    } catch (error) {
      console.error('[LocalStorage] Failed to set player settings', error)
    }
  }

  async getPlayerSettings() {
    try {
      const playerSettingsObj = await Preferences.get({ key: 'playerSettings' }) || {}
      return playerSettingsObj.value ? JSON.parse(playerSettingsObj.value) : null
    } catch (error) {
      console.error('[LocalStorage] Failed to get player settings', error)
      return false
    }
  }

  async setBookshelfListView(useIt) {
    try {
      await Preferences.set({ key: 'bookshelfListView', value: useIt ? '1' : '0' })
    } catch (error) {
      console.error('[LocalStorage] Failed to set bookshelf list view', error)
    }
  }

  async getBookshelfListView() {
    try {
      var obj = await Preferences.get({ key: 'bookshelfListView' }) || {}
      return obj.value === '1'
    } catch (error) {
      console.error('[LocalStorage] Failed to get bookshelf list view', error)
      return false
    }
  }

  // Sasonica: where agent-media's canvas lives, e.g. http://red5:8781. Set in
  // settings; blank means the reply box never appears. Kept here rather than in
  // DeviceSettings so the fork does not have to touch the Kotlin data class.
  async setAgentMediaUrl(url) {
    try {
      await Preferences.set({ key: 'agentMediaUrl', value: url || '' })
    } catch (error) {
      console.error('[LocalStorage] Failed to set agent-media url', error)
    }
  }

  async getAgentMediaUrl() {
    try {
      const obj = (await Preferences.get({ key: 'agentMediaUrl' })) || {}
      return (obj.value || '').replace(/\/+$/, '')
    } catch (error) {
      console.error('[LocalStorage] Failed to get agent-media url', error)
      return ''
    }
  }

  // The canvas address to use, setting first and otherwise a guess: agent-media
  // runs alongside Audiobookshelf, so the server you are signed in to is almost
  // always the right host and only the port differs. That makes the setting
  // something to override rather than something to fill in, and a wrong guess
  // fails closed — the probe does not resolve and nothing appears.
  // Sasonica: the conversation the assistant button last spoke to, so the
  // next press continues it. `{session, title, at}`; stale after six hours.
  async getAskLast() {
    try {
      const obj = await Preferences.get({ key: 'askLast' })
      const last = obj?.value ? JSON.parse(obj.value) : null
      if (!last?.session || Date.now() - (last.at || 0) > 6 * 60 * 60 * 1000) return null
      return last
    } catch (error) {
      return null
    }
  },
  async setAskLast(last) {
    try {
      if (!last) await Preferences.remove({ key: 'askLast' })
      else await Preferences.set({ key: 'askLast', value: JSON.stringify({ ...last, at: Date.now() }) })
    } catch (error) {
      console.error('[LocalStore] setAskLast', error)
    }
  },

  async agentMediaBaseUrl(serverAddress) {
    const set = await this.getAgentMediaUrl()
    if (set) return set
    if (!serverAddress) return ''
    try {
      const url = new URL(serverAddress)
      url.port = '8781'
      return url.origin
    } catch (error) {
      return ''
    }
  }

  async setLastLibraryId(libraryId) {
    try {
      await Preferences.set({ key: 'lastLibraryId', value: libraryId })
      console.log('[LocalStorage] Set Last Library Id', libraryId)
    } catch (error) {
      console.error('[LocalStorage] Failed to set last library id', error)
    }
  }

  async removeLastLibraryId() {
    try {
      await Preferences.remove({ key: 'lastLibraryId' })
      console.log('[LocalStorage] Remove Last Library Id')
    } catch (error) {
      console.error('[LocalStorage] Failed to remove last library id', error)
    }
  }

  async getLastLibraryId() {
    try {
      var obj = await Preferences.get({ key: 'lastLibraryId' }) || {}
      return obj.value || null
    } catch (error) {
      console.error('[LocalStorage] Failed to get last library id', error)
      return false
    }
  }

  async setTheme(theme) {
    try {
      await Preferences.set({ key: 'theme', value: theme })
      console.log('[LocalStorage] Set theme', theme)
    } catch (error) {
      console.error('[LocalStorage] Failed to set theme', error)
    }
  }

  async getTheme() {
    try {
      var obj = await Preferences.get({ key: 'theme' }) || {}
      return obj.value || null
    } catch (error) {
      console.error('[LocalStorage] Failed to get theme', error)
      return false
    }
  }

  async setLanguage(lang) {
    try {
      await Preferences.set({ key: 'lang', value: lang })
      console.log('[LocalStorage] Set lang', lang)
    } catch (error) {
      console.error('[LocalStorage] Failed to set lang', error)
    }
  }

  async getLanguage() {
    try {
      var obj = await Preferences.get({ key: 'lang' }) || {}
      return obj.value || null
    } catch (error) {
      console.error('[LocalStorage] Failed to get lang', error)
      return false
    }
  }

  /**
   * Get preference value by key
   * 
   * @param {string} key 
   * @returns {Promise<string>}
   */
  async getPreferenceByKey(key) {
    try {
      const obj = await Preferences.get({ key }) || {}
      return obj.value || null
    } catch (error) {
      console.error(`[LocalStorage] Failed to get preference "${key}"`, error)
      return null
    }
  }
}


export default ({ app, store }, inject) => {
  inject('localStore', new LocalStorage(store))
}
