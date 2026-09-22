import type { CapacitorConfig } from '@capacitor/cli'

// Sasonica Next: the chat app in a Capacitor 7 Android shell, installed BESIDE
// the old Sasonica (com.sasonica.app), which keeps playing speech and owns the
// phone's ports 8773/6613. This app binds no ports and has no MediaSession.
// See README.md "Android shell (Sasonica Next)".
const config: CapacitorConfig = {
  appId: 'com.sasonica.next',
  appName: 'Sasonica Next',
  webDir: 'build/client',
  server: {
    // http://localhost, not https: the canvas is plain http on the tailnet,
    // and an https page may not fetch it (mixed content). localhost is still
    // a secure context. Cleartext is limited to the tailnet by
    // android/app/src/main/res/xml/network_security_config.xml.
    androidScheme: 'http'
  },
  android: {
    backgroundColor: '#0D1412',
    // targetSdk 35 draws edge to edge. MainActivity pads the WebView clear of
    // the system bars AND the soft keyboard (Capacitor's own handler pads for
    // the bars only, so the keyboard covered the composer): off here.
    adjustMarginsForEdgeToEdge: 'disable'
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_notification',
      iconColor: '#7FD1AE'
    }
  }
}

export default config
