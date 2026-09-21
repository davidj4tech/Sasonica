package com.audiobookshelf.app.player

// Sasonica: "Play with agent-media" in the share sheet.
//
// The companion's share entry, moved here so the companion can go. A link
// shared from anywhere is sent to agent-media, which decides what it is (a
// song, a talk, a book) and plays it on the right channel — or on the channel
// picked here. It goes to the canvas's /share with this app's own
// Audiobookshelf sign-in, the credential every other agent-media call from
// the app uses, rather than to media-share with a token of its own that the
// app would have to be given. Fork-only file.

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import com.audiobookshelf.app.device.DeviceManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class SasonicaShareActivity : Activity() {
  private val choices = arrayOf("Decide for me", "Music", "Book")
  private val channels = arrayOf("", "music", "book")

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val text = sharedText(intent)
    if (text.isNullOrBlank()) {
      toast("agent-media: nothing shared")
      finish()
      return
    }
    AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
      .setTitle("Play with agent-media")
      .setItems(choices) { _, which -> send(text, channels[which]) }
      .setOnCancelListener { finish() }
      .show()
  }

  private fun send(text: String, channel: String) {
    val app = applicationContext
    val main = Handler(Looper.getMainLooper())
    Thread({
      val message = post(app, text, channel)
      main.post { Toast.makeText(app, message, Toast.LENGTH_LONG).show() }
    }, "sasonica-share").start()
    finish()
  }

  private fun post(ctx: Context, text: String, channel: String): String {
    val base = canvasBase(ctx) ?: return "agent-media: not signed in to a server"
    val token = DeviceManager.token
    if (token.isEmpty()) return "agent-media: not signed in to a server"
    return try {
      val conn = URL("$base/share").openConnection() as HttpURLConnection
      conn.requestMethod = "POST"
      conn.connectTimeout = 10_000
      conn.readTimeout = 45_000 // the server looks the link up before it answers
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json")
      conn.setRequestProperty("Authorization", "Bearer $token")
      val body = JSONObject().put("text", text).apply { if (channel.isNotEmpty()) put("channel", channel) }
      conn.outputStream.use { it.write(body.toString().toByteArray()) }
      val status = conn.responseCode
      val payload = (if (status < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
      val o = try { JSONObject(payload) } catch (_: Exception) { JSONObject() }
      o.optString("line").ifEmpty { o.optString("error") }.ifEmpty {
        if (status == 200) "shared" else "agent-media: share failed (HTTP $status)"
      }
    } catch (e: Exception) {
      "agent-media: could not reach $base"
    }
  }

  /** The canvas: the address set in Settings, else the server's host on :8781 (as localStore.js does). */
  private fun canvasBase(ctx: Context): String? {
    val set = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
      .getString("agentMediaUrl", null)?.trimEnd('/')
    if (!set.isNullOrEmpty()) return set
    val address = DeviceManager.serverAddress
    if (address.isEmpty()) return null
    return try {
      val u = URL(address)
      "${u.protocol}://${u.host}:8781"
    } catch (_: Exception) { null }
  }

  private fun sharedText(i: Intent?): String? {
    if (i == null) return null
    i.getCharSequenceExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotEmpty() }?.let { return it.toString() }
    i.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.takeIf { it.isNotEmpty() }?.let { return it.toString() }
    return i.dataString
  }

  private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
