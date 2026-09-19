// Sasonica: dictated words sent by the assistant button wait a moment first.
//
// A button pressed to say something should not then want a tap, but speech
// recognition gets words wrong, and a message that has already gone cannot be
// fixed. So the words sit in the box for a short countdown: left alone they
// send; a tap on the box (or typing in it) stops the countdown and leaves them
// there to edit, and the send button sends them at once. The component
// provides `send()`.
const AUTO_SEND_S = 3

export default {
  data() {
    return {
      autoSendIn: 0,
      autoSendTimer: null
    }
  },
  methods: {
    startAutoSend() {
      this.stopAutoSend()
      this.autoSendIn = AUTO_SEND_S
      this.autoSendTimer = setInterval(() => {
        this.autoSendIn -= 1
        if (this.autoSendIn <= 0) {
          this.stopAutoSend()
          this.send()
        }
      }, 1000)
    },
    stopAutoSend() {
      if (this.autoSendTimer) clearInterval(this.autoSendTimer)
      this.autoSendTimer = null
      this.autoSendIn = 0
    }
  },
  beforeDestroy() {
    this.stopAutoSend()
  }
}
