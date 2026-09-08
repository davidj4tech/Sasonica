package com.audiobookshelf.app.plugins

// Sasonica: the settings page's handle on the remote-control service, and
// the assistant button's way in. Fork-only file; MainActivity registers it
// in one line.

import android.content.Intent
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
}
