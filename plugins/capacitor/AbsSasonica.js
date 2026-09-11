import { registerPlugin, WebPlugin } from '@capacitor/core'

// Sasonica: the remote-control service (Android only). On the web there is
// no process to keep awake and nothing to listen on.
class AbsSasonicaWeb extends WebPlugin {
  async getRemote() {
    return { enabled: false, running: false, token: '', port: 8773, addresses: [], unsupported: true }
  }

  async setRemote() {
    return this.getRemote()
  }

  // On the web the canvas's own landscape lock is the browser's to grant, and
  // it does — there is no activity in the way, so there is nothing to do here.
  async setOrientation() {
    return { landscape: false, unsupported: true }
  }
}

const AbsSasonica = registerPlugin('AbsSasonica', {
  web: () => new AbsSasonicaWeb()
})

export { AbsSasonica }
