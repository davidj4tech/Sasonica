import { registerPlugin, WebPlugin } from '@capacitor/core'

class AbsSpeechInputWeb extends WebPlugin {
  // Nothing on the web: the browser's own speech API is a different thing
  // with different permissions, and the reply box hides the button instead.
  async available() {
    return { available: false }
  }

  async listen() {
    return { text: '' }
  }
}

const AbsSpeechInput = registerPlugin('AbsSpeechInput', {
  web: () => new AbsSpeechInputWeb()
})

export { AbsSpeechInput }
