package com.audiobookshelf.app.player

// Sasonica: bring the remote-control service back after a reboot or an update.
// Both broadcasts are on Android's list of allowed foreground-service starts
// from the background, which is what makes "always on" mean always.
// Fork-only file.

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class SasonicaBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED ->
        SasonicaRemoteService.ensure(context)
    }
  }
}
