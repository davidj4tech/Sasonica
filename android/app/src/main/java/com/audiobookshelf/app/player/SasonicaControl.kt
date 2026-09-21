package com.audiobookshelf.app.player

// Sasonica: a small HTTP control surface over the player service.
//
// The phone's ExoPlayer is the primary book player and mpv the fallback, so
// agent-media on red5 needs to drive it. Two listeners share this class:
//
//   * PlayerNotificationService opens one on loopback :8772, no token — the
//     ssh hop into Termux is the trust boundary (like the companion app's
//     readout on :8770 and the share listener on :8771).
//   * SasonicaRemoteService opens one on every interface, :8773, and demands
//     a bearer token — "remote control" in Settings — so red5 talks to the
//     phone over the tailnet directly, no Termux. That service is also what
//     keeps the app from being frozen while nothing is playing.
//
// /state is the clock the canvas reads; /play?item=… starts an
// Audiobookshelf item here with this app's own focus, notification and
// lock-screen controls; /play?url=… plays one http(s) URL (music from red5)
// as a single-track session that belongs to no library and syncs nowhere.
// Fork-only file.

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.MimeTypeMap
import com.audiobookshelf.app.data.AudioTrack
import com.audiobookshelf.app.data.BookMetadata
import com.audiobookshelf.app.data.DeviceInfo
import com.audiobookshelf.app.data.PlaybackSession
import com.audiobookshelf.app.device.DeviceManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SasonicaControl(
  private val bind: InetAddress,
  private val port: Int,
  /** Required from any client that is not loopback; null = loopback only, no token. */
  private val token: () -> String?,
  /** The player service, when there is one; the listener outlives it in remote mode. */
  private val service: () -> PlayerNotificationService?,
) {
  companion object {
    const val LOOPBACK_PORT = 8772
    const val REMOTE_PORT = 8773
    private const val tag = "SasonicaControl"

    /** The loopback listener the player service owns. */
    fun loopback(service: PlayerNotificationService) =
      SasonicaControl(InetAddress.getByName("127.0.0.1"), LOOPBACK_PORT, { null }) { service }
        .also { it.appContext = service.applicationContext }

    /**
     * The mark of a `/play?url=` session: its id. The id survives clone() and
     * a round trip through the database, and no Audiobookshelf session id
     * (a UUID from the server or LocalLibraryItem) starts with it. The hooks in
     * upstream files ask this, so that a URL session never writes progress,
     * history or a server sync, never rewinds on resume, never arms the book's
     * auto sleep timer, and never takes the web view's (book) speed.
     */
    private const val URL_SESSION_PREFIX = "sasonica-url-"

    fun isUrlSession(s: PlaybackSession?): Boolean = s?.id?.startsWith(URL_SESSION_PREFIX) == true

    /** The URL a URL session is playing, else null. */
    fun urlOf(s: PlaybackSession?): String? =
      if (isUrlSession(s)) s?.audioTracks?.firstOrNull()?.contentUrl else null

    /**
     * A URL session starts with no length. Called from PlayerListener on
     * STATE_READY, before the web view is sent its metadata: the player's own
     * duration becomes the track's and the session's, so getDuration(), the
     * seek clamp, the sleep timer and the web seekbar all see it.
     */
    fun learnUrlDuration(svc: PlayerNotificationService) {
      val s = svc.currentPlaybackSession ?: return
      if (!isUrlSession(s)) return
      val track = s.audioTracks.firstOrNull() ?: return
      if (track.duration > 0.0) return
      val ms = try { svc.currentPlayer.duration } catch (_: Exception) { return }
      if (ms <= 0L) return // C.TIME_UNSET is negative: a stream of unknown length stays 0
      track.duration = ms / 1000.0
      s.duration = track.duration
    }

    /**
     * One URL as a local-method session: getContentUri hands a PLAYMETHOD_LOCAL
     * track's contentUrl to ExoPlayer verbatim, and preparePlayer's local branch
     * uses DefaultDataSource, which reads http(s) too. No library item, no
     * server, no chapters, no cover (getCoverUri falls back to the app icon).
     * "book", not "podcast": podcast sessions pull in Android Auto's
     * next-episode logic when they end.
     */
    private fun urlSession(url: String, title: String, artist: String, startTime: Double?,
                           deviceInfo: DeviceInfo): PlaybackSession {
      val ext = MimeTypeMap.getFileExtensionFromUrl(url)?.lowercase() ?: ""
      val mime = (if (ext.isEmpty()) null else MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext))
        ?.takeIf { it.startsWith("audio/") } ?: "audio/mpeg"
      val now = System.currentTimeMillis()
      val metadata = BookMetadata(
        title = title, subtitle = null, authors = null, narrators = null,
        genres = mutableListOf(), publishedYear = null, publishedDate = null,
        publisher = null, description = null, isbn = null, asin = null,
        language = null, explicit = false, authorName = artist, authorNameLF = null,
        narratorName = null, seriesName = null, series = null,
      )
      val track = AudioTrack(0, 0.0, 0.0, title, url, mime, null, true, null, null)
      return PlaybackSession(
        "$URL_SESSION_PREFIX${UUID.randomUUID()}", null, null, null, "book", metadata,
        deviceInfo, mutableListOf(), title, artist, null, 0.0, PLAYMETHOD_LOCAL, now, now, 0L,
        mutableListOf(track), startTime ?: 0.0, null, null, null, null, null, PLAYER_EXO,
      )
    }
  }

  @Volatile private var server: ServerSocket? = null
  private val main = Handler(Looper.getMainLooper())
  /** Set per request thread before routing; only loopback may reconfigure. */
  private var loopbackCaller: Boolean
    get() = callerIsLoopback.get() ?: false
    set(v) = callerIsLoopback.set(v)
  private val callerIsLoopback = ThreadLocal<Boolean>()
  /** For `/remote?enable=` — the player service's context, or the remote service's. */
  var appContext: android.content.Context? = null

  val listening: Boolean get() = server?.isClosed == false

  fun start() {
    if (server != null) return
    Thread({ serve() }, "sasonica-control-$port").apply { isDaemon = true; start() }
  }

  fun stop() {
    try { server?.close() } catch (_: Exception) {}
    server = null
  }

  private fun serve() {
    val ss = try {
      ServerSocket(port, 4, bind)
    } catch (e: Exception) {
      // Another process (or a previous instance not yet gone) holds the port.
      // The service works without us; red5 falls back to mpv.
      Log.w(tag, "not listening on $bind:$port: $e")
      return
    }
    server = ss
    Log.i(tag, "listening on ${bind.hostAddress}:$port")
    while (!ss.isClosed) {
      val c = try { ss.accept() } catch (_: Exception) { break }
      // One thread per request: /play waits on the server for up to 45 s and
      // must not hold /state hostage meanwhile.
      Thread({
        try { handle(c) } catch (e: Exception) { Log.w(tag, "request failed: $e") } finally {
          try { c.close() } catch (_: Exception) {}
        }
      }, "sasonica-control-req").apply { isDaemon = true; start() }
    }
    server = null
  }

  private fun handle(c: Socket) {
    c.soTimeout = 5000
    val reader = c.getInputStream().bufferedReader()
    val requestLine = reader.readLine() ?: return
    var auth = ""
    while (true) {
      val h = reader.readLine()
      if (h.isNullOrEmpty()) break
      if (h.startsWith("Authorization:", ignoreCase = true)) auth = h.substringAfter(':').trim()
    }
    val target = requestLine.split(" ").getOrElse(1) { "/" }
    val path = target.substringBefore('?')
    val query = parseQuery(target.substringAfter('?', ""))

    val (status, body) = try {
      loopbackCaller = c.inetAddress.isLoopbackAddress
      if (!authorised(c, auth, query)) 401 to err("token required")
      else route(path, query)
    } catch (e: Exception) {
      Log.w(tag, "$path failed: $e")
      500 to JSONObject().put("error", e.toString())
    }
    val bytes = body.toString().toByteArray()
    val reason = when (status) {
      200 -> "OK"; 400 -> "Bad Request"; 401 -> "Unauthorized"; 404 -> "Not Found"
      409 -> "Conflict"; 503 -> "Service Unavailable"; else -> "Error"
    }
    c.getOutputStream().apply {
      write(("HTTP/1.0 $status $reason\r\nContent-Type: application/json\r\n" +
             "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray())
      write(bytes)
      flush()
    }
  }

  /** Loopback is trusted as it is; anyone else must carry the token. */
  private fun authorised(c: Socket, auth: String, q: Map<String, String>): Boolean {
    if (c.inetAddress.isLoopbackAddress) return true
    val want = token() ?: return false
    if (want.isEmpty()) return false
    val got = if (auth.startsWith("Bearer ", ignoreCase = true)) auth.substring(7).trim() else q["token"] ?: ""
    return got == want
  }

  private fun parseQuery(q: String): Map<String, String> =
    q.split("&").filter { it.isNotEmpty() }.associate {
      val k = it.substringBefore('=')
      val v = it.substringAfter('=', "")
      URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(v, "UTF-8")
    }

  // --- routes -----------------------------------------------------------------

  private fun route(path: String, q: Map<String, String>): Pair<Int, JSONObject> {
    if (path == "/remote") {
      // `enable=1|0` switches remote mode, but only over loopback (Termux, adb):
      // a tailnet caller holding the token may read, never reconfigure.
      val enable = q["enable"]
      if (enable != null) {
        if (!loopbackCaller) return 401 to err("enable is loopback-only")
        appContext?.let { SasonicaRemoteService.configure(it, enable == "1", q["token"]) }
      }
      return 200 to remoteInfo()
    }
    val svc = service() ?: return 503 to err("player service not running").put("source", "sasonica")
    return when (path) {
      "/", "/state" -> 200 to onMain { state(svc) }
      "/play" -> play(svc, q)
      "/pause" -> 200 to onMain { svc.pause(); state(svc) }
      "/resume" -> 200 to onMain { svc.play(); state(svc) }
      "/toggle" -> 200 to onMain { svc.playPause(); state(svc) }
      "/stop" -> 200 to onMain { svc.closePlayback(); state(svc) }
      "/seek" -> {
        val t = q["t"]?.toDoubleOrNull()
        if (t == null) 400 to err("seek needs t=<seconds>")
        else 200 to onMain { seek(svc, (t * 1000).toLong()); state(svc) }
      }
      "/jump" -> {
        val by = q["by"]?.toDoubleOrNull()
        if (by == null) 400 to err("jump needs by=<seconds> (negative to go back)")
        else 200 to onMain { seek(svc, svc.getCurrentTime() + (by * 1000).toLong()); state(svc) }
      }
      "/speed" -> {
        val rate = q["rate"]?.toFloatOrNull()
        if (rate == null || rate <= 0f) 400 to err("speed needs rate=<float>")
        else 200 to onMain {
          // Music's speed is its own: setPlaybackSpeed would also save it as
          // the book speed the next book starts at.
          if (isUrlSession(svc.currentPlaybackSession)) svc.currentPlayer.setPlaybackSpeed(rate)
          else svc.setPlaybackSpeed(rate)
          state(svc)
        }
      }
      else -> 404 to err("no such route")
    }
  }

  /**
   * seekPlayer clamps to getDuration(), which a URL session only knows once
   * the player is ready; until then it would clamp every seek to -2 s. So
   * seek the player directly while the length is unknown. On main.
   */
  private fun seek(svc: PlayerNotificationService, ms: Long) {
    if (isUrlSession(svc.currentPlaybackSession) && svc.getDuration() <= 0L) {
      svc.currentPlayer.seekTo(ms.coerceAtLeast(0L))
    } else {
      svc.seekPlayer(ms)
    }
  }

  private fun err(msg: String) = JSONObject().put("error", msg)

  /**
   * How to reach the remote listener — the settings page shows it, and a
   * loopback caller (Termux, adb) can bootstrap red5's config from it.
   */
  private fun remoteInfo(): JSONObject = JSONObject().apply {
    put("source", "sasonica")
    put("remote", SasonicaRemoteService.enabled)
    put("running", SasonicaRemoteService.running)
    put("port", REMOTE_PORT)
    put("token", SasonicaRemoteService.token)
    put("addresses", JSONArray(SasonicaRemoteService.addresses()))
    put("player", service() != null)
  }

  /** The clock, and what it is counting. Read on the main thread. */
  private fun state(svc: PlayerNotificationService): JSONObject {
    val s: PlaybackSession? = svc.currentPlaybackSession
    val playing = try { svc.currentPlayer.isPlaying } catch (_: Exception) { false }
    val rate = try { svc.currentPlayer.playbackParameters.speed } catch (_: Exception) { 1f }
    return JSONObject().apply {
      put("source", "sasonica")
      put("player", try { svc.getMediaPlayer() } catch (_: Exception) { "?" })
      put("closed", PlayerNotificationService.isClosed)
      put("item", s?.libraryItemId ?: JSONObject.NULL) // null for a URL session: music is not a book
      put("url", urlOf(s) ?: JSONObject.NULL)
      put("episode", s?.episodeId ?: JSONObject.NULL)
      put("title", s?.displayTitle ?: JSONObject.NULL)
      put("t", if (s == null) 0.0 else svc.getCurrentTimeSeconds())
      put("dur", if (s == null) 0.0 else svc.getDuration() / 1000.0)
      put("paused", !playing)
      put("rate", rate.toDouble())
      put("chapter", svc.getCurrentBookChapter()?.title ?: JSONObject.NULL)
      // What the mic and voice-session holds are doing, for diagnosis from red5.
      put("holds", com.audiobookshelf.app.speech.SasonicaHolds.why())
    }
  }

  /**
   * Start an item at a position, playing. Mirrors AbsAudioPlayer.prepareLibraryItem
   * — the server issues the session, preparePlayer takes it, and the web view
   * hears about it through onPlaybackSession like any other start.
   */
  private fun play(svc: PlayerNotificationService, q: Map<String, String>): Pair<Int, JSONObject> {
    if (q.containsKey("url")) return playUrl(svc, q)
    val itemId = q["item"] ?: return 400 to err("play needs item=<libraryItemId>")
    val episodeId = q["episode"] ?: ""
    val startTime = q["t"]?.toDoubleOrNull()
    val rate = q["rate"]?.toFloatOrNull() ?: svc.mediaManager.getSavedPlaybackRate()

    if (itemId.startsWith("local")) {
      val local = DeviceManager.dbManager.getLocalLibraryItem(itemId)
        ?: return 404 to err("no local item $itemId")
      val episode = if (episodeId.isEmpty()) null
        else (local.media as? com.audiobookshelf.app.data.Podcast)?.episodes?.find { it.id == episodeId }
      if (!local.hasTracks(episode)) return 409 to err("no audio files on device for $itemId")
      return 200 to onMain(timeoutMs = 10_000) {
        val session = local.getPlaybackSession(episode, svc.getDeviceInfo())
        if (startTime != null) session.currentTime = startTime
        svc.mediaProgressSyncer.reset()
        PlayerListener.lazyIsPlaying = false
        svc.preparePlayer(session, true, rate)
        state(svc)
      }
    }

    // A server item: ask Audiobookshelf for a session (network), then prepare.
    val payload = svc.getPlayItemRequestPayload(false)
    val latch = CountDownLatch(1)
    var result: Pair<Int, JSONObject> = 504 to err("no answer from the server in time")
    main.post {
      svc.mediaProgressSyncer.stop {
        svc.apiHandler.playLibraryItem(itemId, episodeId, payload) { session ->
          if (session == null) {
            result = 502 to err("server play request failed for $itemId")
            latch.countDown()
          } else {
            if (startTime != null) session.currentTime = startTime
            main.post {
              try {
                PlayerListener.lazyIsPlaying = false
                svc.preparePlayer(session, true, rate)
                result = 200 to state(svc)
              } catch (e: Exception) {
                // preparePlayer can throw after it has taken the session (a
                // foreground-start refused in the background, say); say so
                // rather than time out with the player half-prepared.
                Log.w(tag, "play: preparePlayer threw: $e")
                result = 500 to err("preparePlayer threw: $e").put("state", state(svc))
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

  /**
   * `/play?url=<http(s)>&title=&artist=&t=&rate=`: one URL, one track, played
   * here. `item` is ignored. The rate is 1.0 unless given — never the saved
   * book speed. Whatever was playing is stopped first the way the app stops
   * it (a book syncs its last position), then the URL session is prepared;
   * MediaProgressSyncer refuses to start for it, so it writes no local
   * progress, no history and no server sync.
   */
  private fun playUrl(svc: PlayerNotificationService, q: Map<String, String>): Pair<Int, JSONObject> {
    val url = q["url"]?.trim() ?: ""
    val uri = if (url.isEmpty()) null else try { Uri.parse(url) } catch (_: Exception) { null }
    val scheme = uri?.scheme?.lowercase()
    if (uri == null || (scheme != "http" && scheme != "https") || uri.host.isNullOrEmpty()) {
      return 400 to err("play needs url=<http(s) URL>")
    }
    val title = q["title"]?.takeIf { it.isNotBlank() }
      ?: uri.lastPathSegment?.takeIf { it.isNotBlank() } ?: url
    // "" not null: the notification prints a null subtitle as "null".
    val artist = q["artist"]?.takeIf { it.isNotBlank() } ?: ""
    val startTime = q["t"]?.toDoubleOrNull()?.takeIf { it > 0.0 }
    val rate = q["rate"]?.toFloatOrNull()?.takeIf { it > 0f } ?: 1f

    val latch = CountDownLatch(1)
    var result: Pair<Int, JSONObject> = 504 to err("the player did not start in time")
    main.post {
      try {
        // Like AbsAudioPlayer.prepareLibraryItem's server path: let the syncer
        // finish with the old session (it calls back at once when idle, or
        // after the book's last sync, maybe off the main thread).
        svc.mediaProgressSyncer.stop {
          main.post {
            try {
              val session = urlSession(url, title, artist, startTime, svc.getDeviceInfo())
              PlayerListener.lazyIsPlaying = false
              svc.preparePlayer(session, true, rate)
              // preparePlayer restarts any session within 5 s of its duration,
              // and a URL session's duration is 0 until the player is ready,
              // so it always rewinds to 0. Put the start back: one track, and
              // a local session always ends on ExoPlayer, so this is the
              // same seekTo preparePlayer would have made.
              if (startTime != null && svc.currentPlaybackSession === session) {
                session.currentTime = startTime
                svc.currentPlayer.seekTo((startTime * 1000).toLong())
              }
              result = 200 to state(svc)
            } catch (e: Exception) {
              Log.w(tag, "play url: preparePlayer threw: $e")
              result = 500 to err("preparePlayer threw: $e").put("state", state(svc))
            } finally {
              latch.countDown()
            }
          }
        }
      } catch (e: Exception) {
        Log.w(tag, "play url: stopping the syncer threw: $e")
        result = 500 to err("stopping the previous session threw: $e").put("state", state(svc))
        latch.countDown()
      }
    }
    // The old book's last sync may go to the server first: same budget as /play?item.
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
