package com.audiobookshelf.app.player

// Sasonica: a loopback control endpoint on the player service.
//
// The phone's ExoPlayer is the primary book player and mpv the fallback, so
// agent-media on red5 needs to drive it: `ssh p8a curl 127.0.0.1:8772/play?item=…`
// starts an Audiobookshelf item here, with this app's own focus, notification
// and lock-screen controls; /state is the clock the canvas reads. Loopback
// only — the ssh hop is the trust boundary, exactly as the companion app's
// readout on :8770 and the share listener on :8771 are.
//
// Fork-only file. PlayerNotificationService touches it in two lines
// (start in onCreate, stop in onDestroy), so upstream merges stay clean.

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.audiobookshelf.app.data.PlaybackSession
import com.audiobookshelf.app.device.DeviceManager
import org.json.JSONObject
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SasonicaControl(private val service: PlayerNotificationService) {
  companion object {
    const val PORT = 8772
    private const val tag = "SasonicaControl"
  }

  private var server: ServerSocket? = null
  private val main = Handler(Looper.getMainLooper())

  fun start() {
    if (server != null) return
    Thread({ serve() }, "sasonica-control").apply { isDaemon = true; start() }
  }

  fun stop() {
    try { server?.close() } catch (_: Exception) {}
    server = null
  }

  private fun serve() {
    val ss = try {
      // Not getLoopbackAddress(): on p8a that is ::1, which Termux cannot reach.
      ServerSocket(PORT, 4, InetAddress.getByName("127.0.0.1"))
    } catch (e: Exception) {
      // Another process (or a previous instance not yet gone) holds the port.
      // The service works without us; red5 falls back to mpv.
      Log.w(tag, "not listening on $PORT: $e")
      return
    }
    server = ss
    Log.i(tag, "listening on 127.0.0.1:$PORT")
    while (!ss.isClosed) {
      val c = try { ss.accept() } catch (_: Exception) { break }
      // One thread per request: /play waits on the server for up to 20 s and
      // must not hold /state hostage meanwhile.
      Thread({
        try { handle(c) } catch (e: Exception) { Log.w(tag, "request failed: $e") } finally {
          try { c.close() } catch (_: Exception) {}
        }
      }, "sasonica-control-req").apply { isDaemon = true; start() }
    }
  }

  private fun handle(c: Socket) {
    c.soTimeout = 5000
    val reader = c.getInputStream().bufferedReader()
    val requestLine = reader.readLine() ?: return
    while (true) { val h = reader.readLine(); if (h.isNullOrEmpty()) break }  // headers: none matter
    val target = requestLine.split(" ").getOrElse(1) { "/" }
    val path = target.substringBefore('?')
    val query = parseQuery(target.substringAfter('?', ""))

    val (status, body) = try { route(path, query) } catch (e: Exception) {
      Log.w(tag, "$path failed: $e")
      500 to JSONObject().put("error", e.toString())
    }
    val bytes = body.toString().toByteArray()
    val reason = when (status) { 200 -> "OK"; 400 -> "Bad Request"; 404 -> "Not Found"; 409 -> "Conflict"; else -> "Error" }
    c.getOutputStream().apply {
      write(("HTTP/1.0 $status $reason\r\nContent-Type: application/json\r\n" +
             "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray())
      write(bytes)
      flush()
    }
  }

  private fun parseQuery(q: String): Map<String, String> =
    q.split("&").filter { it.isNotEmpty() }.associate {
      val k = it.substringBefore('=')
      val v = it.substringAfter('=', "")
      URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(v, "UTF-8")
    }

  // --- routes -----------------------------------------------------------------

  private fun route(path: String, q: Map<String, String>): Pair<Int, JSONObject> = when (path) {
    "/", "/state" -> 200 to onMain { state() }
    "/play" -> play(q)
    "/pause" -> 200 to onMain { service.pause(); state() }
    "/resume" -> 200 to onMain { service.play(); state() }
    "/toggle" -> 200 to onMain { service.playPause(); state() }
    "/stop" -> 200 to onMain { service.closePlayback(); state() }
    "/seek" -> {
      val t = q["t"]?.toDoubleOrNull()
      if (t == null) 400 to err("seek needs t=<seconds>")
      else 200 to onMain { service.seekPlayer((t * 1000).toLong()); state() }
    }
    "/jump" -> {
      val by = q["by"]?.toDoubleOrNull()
      if (by == null) 400 to err("jump needs by=<seconds> (negative to go back)")
      else 200 to onMain { service.seekForward((by * 1000).toLong()); state() }
    }
    "/speed" -> {
      val rate = q["rate"]?.toFloatOrNull()
      if (rate == null || rate <= 0f) 400 to err("speed needs rate=<float>")
      else 200 to onMain { service.setPlaybackSpeed(rate); state() }
    }
    else -> 404 to err("no such route")
  }

  private fun err(msg: String) = JSONObject().put("error", msg)

  /** The clock, and what it is counting. Read on the main thread. */
  private fun state(): JSONObject {
    val s: PlaybackSession? = service.currentPlaybackSession
    val playing = try { service.currentPlayer.isPlaying } catch (_: Exception) { false }
    val rate = try { service.currentPlayer.playbackParameters.speed } catch (_: Exception) { 1f }
    return JSONObject().apply {
      put("source", "sasonica")
      put("player", try { service.getMediaPlayer() } catch (_: Exception) { "?" })
      put("closed", PlayerNotificationService.isClosed)
      put("item", s?.libraryItemId ?: JSONObject.NULL)
      put("episode", s?.episodeId ?: JSONObject.NULL)
      put("title", s?.displayTitle ?: JSONObject.NULL)
      put("t", if (s == null) 0.0 else service.getCurrentTimeSeconds())
      put("dur", if (s == null) 0.0 else service.getDuration() / 1000.0)
      put("paused", !playing)
      put("rate", rate.toDouble())
      put("chapter", service.getCurrentBookChapter()?.title ?: JSONObject.NULL)
    }
  }

  /**
   * Start an item at a position, playing. Mirrors AbsAudioPlayer.prepareLibraryItem
   * — the server issues the session, preparePlayer takes it, and the web view
   * hears about it through onPlaybackSession like any other start.
   */
  private fun play(q: Map<String, String>): Pair<Int, JSONObject> {
    val itemId = q["item"] ?: return 400 to err("play needs item=<libraryItemId>")
    val episodeId = q["episode"] ?: ""
    val startTime = q["t"]?.toDoubleOrNull()
    val rate = q["rate"]?.toFloatOrNull() ?: service.mediaManager.getSavedPlaybackRate()

    if (itemId.startsWith("local")) {
      val local = DeviceManager.dbManager.getLocalLibraryItem(itemId)
        ?: return 404 to err("no local item $itemId")
      val episode = if (episodeId.isEmpty()) null
        else (local.media as? com.audiobookshelf.app.data.Podcast)?.episodes?.find { it.id == episodeId }
      if (!local.hasTracks(episode)) return 409 to err("no audio files on device for $itemId")
      return 200 to onMain(timeoutMs = 10_000) {
        val session = local.getPlaybackSession(episode, service.getDeviceInfo())
        if (startTime != null) session.currentTime = startTime
        service.mediaProgressSyncer.reset()
        PlayerListener.lazyIsPlaying = false
        service.preparePlayer(session, true, rate)
        state()
      }
    }

    // A server item: ask Audiobookshelf for a session (network), then prepare.
    val payload = service.getPlayItemRequestPayload(false)
    val latch = CountDownLatch(1)
    var result: Pair<Int, JSONObject> = 504 to err("no answer from the server in time")
    main.post {
      service.mediaProgressSyncer.stop {
        service.apiHandler.playLibraryItem(itemId, episodeId, payload) { session ->
          if (session == null) {
            result = 502 to err("server play request failed for $itemId")
            latch.countDown()
          } else {
            if (startTime != null) session.currentTime = startTime
            main.post {
              try {
                PlayerListener.lazyIsPlaying = false
                service.preparePlayer(session, true, rate)
                result = 200 to state()
              } catch (e: Exception) {
                // preparePlayer can throw after it has taken the session (a
                // foreground-start refused in the background, say); say so
                // rather than time out with the player half-prepared.
                Log.w(tag, "play: preparePlayer threw: $e")
                result = 500 to err("preparePlayer threw: $e").put("state", state())
              } finally {
                latch.countDown()
              }
            }
          }
        }
      }
    }
    // 45 s, not 20: on a flapping tailnet the app's own play request has taken 19 s.
    latch.await(45, TimeUnit.SECONDS)
    return result
  }

  /** Run on the main looper and wait for the answer; the player is not thread-safe. */
  private fun onMain(timeoutMs: Long = 3_000, block: () -> JSONObject): JSONObject {
    val latch = CountDownLatch(1)
    var out = JSONObject().put("error", "main thread did not answer in ${timeoutMs}ms")
    main.post {
      out = try { block() } catch (e: Exception) { JSONObject().put("error", e.toString()) }
      latch.countDown()
    }
    latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    return out
  }
}
