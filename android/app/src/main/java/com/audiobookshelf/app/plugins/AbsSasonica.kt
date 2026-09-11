package com.audiobookshelf.app.plugins

// Sasonica: the settings page's handle on the remote-control service, and
// the assistant button's way in. Fork-only file; MainActivity registers it
// in one line.

import android.content.Intent
import android.content.pm.ActivityInfo
import com.audiobookshelf.app.player.SasonicaControl
import com.audiobookshelf.app.player.SasonicaRemoteService
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "AbsSasonica")
class AbsSasonica : Plugin() {

  /**
   * The assistant button. The activity is singleTask, so a running app gets
   * the intent through onNewIntent and a cold start through the launching
   * intent; both end here. Retained until the web layer has a listener, which
   * on a cold start is some seconds after this runs.
   */
  override fun load() {
    activity?.intent?.let { assist(it) }
  }

  override fun handleOnNewIntent(intent: Intent?) {
    super.handleOnNewIntent(intent)
    assist(intent)
  }

  private fun assist(intent: Intent?) {
    if (intent?.action != Intent.ACTION_ASSIST) return
    notifyListeners("assist", JSObject().put("at", System.currentTimeMillis()), true)
    // Consumed: a rotation re-delivers the launching intent otherwise.
    intent.action = null
  }

  private fun remote(): JSObject = JSObject().apply {
    put("enabled", SasonicaRemoteService.enabled)
    put("running", SasonicaRemoteService.running)
    put("token", SasonicaRemoteService.token)
    put("port", SasonicaControl.REMOTE_PORT)
    put("addresses", JSArray(SasonicaRemoteService.addresses()))
  }

  @PluginMethod
  fun getRemote(call: PluginCall) {
    SasonicaRemoteService.attach(context)
    call.resolve(remote())
  }

  /** `{enabled, token?}` — an empty token keeps the current one, or mints one. */
  @PluginMethod
  fun setRemote(call: PluginCall) {
    SasonicaRemoteService.configure(context, call.getBoolean("enabled") == true, call.getString("token"))
    call.resolve(remote())
  }

  /**
   * `{landscape}` — turn the activity, and give it back.
   *
   * The canvas frames a page that has its own fullscreen button, and that page
   * asks the browser for a landscape lock when it fills the screen. In Chrome
   * that works. In a WebView there is no browser to ask: the Screen Orientation
   * API's `lock()` is the embedder's decision, and the embedder is this
   * activity — so the page goes fullscreen and stays resolutely upright, which
   * is the half of the feature that is worth having on a picture drawn wide.
   *
   * So the page says when it is fullscreen (a postMessage to its parent, since
   * it is cross-origin and that is the only channel there is), the panel passes
   * it here, and this turns the activity. UNSPECIFIED rather than PORTRAIT on
   * the way back: the manifest declares no orientation, so the right resting
   * state is whatever the device and the user's rotation lock say, not a
   * portrait this code invented.
   */
  @PluginMethod
  fun setOrientation(call: PluginCall) {
    val landscape = call.getBoolean("landscape") == true
    val act = activity
    if (act == null) {
      call.reject("no activity")
      return
    }
    act.runOnUiThread {
      act.requestedOrientation =
        if (landscape) ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
    call.resolve(JSObject().put("landscape", landscape))
  }
}
