package com.audiobookshelf.app.plugins

// Sasonica: the settings page's handle on the remote-control service.
// Fork-only file; MainActivity registers it in one line.

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
