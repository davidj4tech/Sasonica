package com.audiobookshelf.app.player

// Sasonica: "remote control" — the app stays awake and listens on the tailnet.
//
// Android freezes a background app and nothing arriving on a socket thaws it,
// so a listener alone cannot be reached from red5 once the app has been idle
// for a minute. A foreground service is the one self-contained exemption:
// while this runs, the process is never frozen and its network never cut,
// and the listener on :8773 answers a tokened request from anywhere on the
// tailnet — no Termux, no ssh, no thaw broadcast.
//
// It is a setting (off by default; Settings → Sasonica → Remote control),
// costs one quiet notification, and comes back on its own after a reboot or
// an update (SasonicaBootReceiver). Fork-only file.

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.net.InetAddress
import java.net.NetworkInterface
import java.security.SecureRandom

class SasonicaRemoteService : Service() {
  companion object {
    private const val tag = "SasonicaRemote"
    private const val PREFS = "sasonica_remote"
    private const val CHANNEL = "sasonica-remote"
    private const val NOTIFICATION_ID = 7873

    @Volatile var running = false
      private set

    private var appContext: Context? = null
    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    val enabled: Boolean get() = appContext?.let { prefs(it).getBoolean("enabled", false) } ?: false
    val token: String get() = appContext?.let { prefs(it).getString("token", "") } ?: ""

    /** Remember the app context once, so the listener can read settings without one. */
    fun attach(ctx: Context) { appContext = ctx.applicationContext }

    fun configure(ctx: Context, enabled: Boolean, token: String?) {
      attach(ctx)
      val t = token?.trim().takeUnless { it.isNullOrEmpty() } ?: this.token.ifEmpty { newToken() }
      prefs(ctx).edit().putBoolean("enabled", enabled).putString("token", t).apply()
      if (enabled) start(ctx) else stop(ctx)
    }

    /** Start the service if the setting says so — at launch, boot, or update. */
    fun ensure(ctx: Context) {
      attach(ctx)
      if (enabled) start(ctx)
    }

    private fun start(ctx: Context) {
      try {
        ContextCompat.startForegroundService(ctx, Intent(ctx, SasonicaRemoteService::class.java))
      } catch (e: Exception) {
        Log.w(tag, "could not start: $e")
      }
    }

    private fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, SasonicaRemoteService::class.java))
    }

    private fun newToken(): String {
      val bytes = ByteArray(24); SecureRandom().nextBytes(bytes)
      return bytes.joinToString("") { "%02x".format(it) }
    }

    /** This phone's non-loopback IPv4 addresses, tailnet (100.x) first. */
    fun addresses(): List<String> = try {
      NetworkInterface.getNetworkInterfaces().toList()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.inetAddresses.toList() }
        .filter { it is java.net.Inet4Address && !it.isLoopbackAddress }
        .map { it.hostAddress ?: "" }
        .filter { it.isNotEmpty() }
        .sortedBy { if (it.startsWith("100.")) 0 else 1 }
    } catch (_: Exception) { emptyList() }
  }

  private var control: SasonicaControl? = null
  private var player: PlayerNotificationService? = null
  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
      player = (binder as PlayerNotificationService.LocalBinder).getService()
      Log.i(tag, "player service bound")
    }
    override fun onServiceDisconnected(name: ComponentName) { player = null }
  }

  override fun onCreate() {
    super.onCreate()
    attach(this)
    startForeground(NOTIFICATION_ID, notification())
    running = true
    // BIND_AUTO_CREATE: the player service exists for as long as we do, so a
    // /play that arrives while nothing is on screen has something to talk to.
    bindService(Intent(this, PlayerNotificationService::class.java), connection, Context.BIND_AUTO_CREATE)
    control = SasonicaControl(InetAddress.getByName("0.0.0.0"), SasonicaControl.REMOTE_PORT,
                              { token }) { player }.also { it.start() }
    Log.i(tag, "up on :${SasonicaControl.REMOTE_PORT} at ${addresses()}")
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onDestroy() {
    running = false
    control?.stop(); control = null
    try { unbindService(connection) } catch (_: Exception) {}
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun notification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val chan = NotificationChannel(CHANNEL, "Remote control", NotificationManager.IMPORTANCE_MIN)
      chan.description = "Sasonica can be driven from your other devices while this shows."
      chan.setShowBadge(false)
      (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(chan)
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle("Sasonica remote control")
      .setContentText("Listening on port ${SasonicaControl.REMOTE_PORT}")
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setContentIntent(open)
      .build()
  }
}
