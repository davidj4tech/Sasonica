// Sasonica: dictated words sent by the assistant button wait a moment first.
//
// A button pressed to say something should not then want a tap, but speech
// recognition gets words wrong, and a message that has already gone cannot be
// fixed. So the words sit in the box for a short countdown: left alone they
// send; a tap anywhere on the screen (or typing in the box) stops the
// countdown and leaves them there to edit, and the send button sends them at
// once. The component provides `send()`.
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
      // Capture, so a tap still counts when whatever it lands on stops it.
      document.addEventListener('pointerdown', this.stopAutoSend, true)
      this.autoSendTimer = setInterval(() => {
        this.autoSendIn -= 1
        if (this.autoSendIn <= 0) {
          this.stopAutoSend()
          this.send()
        }
      }, 1000)
    },
    stopAutoSend() {
      document.removeEventListener('pointerdown', this.stopAutoSend, true)
      if (this.autoSendTimer) clearInterval(this.autoSendTimer)
      this.autoSendTimer = null
      this.autoSendIn = 0
    }
  },
  beforeDestroy() {
    this.stopAutoSend()
  }
}
