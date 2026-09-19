package com.audiobookshelf.app.player

// Sasonica: what a reply does to the book and the music in this app.
//
// David's rule, as the companion had it: duck the music, pause the book.
// Speech plays in this process (com.audiobookshelf.app.speech) and never asks
// for audio focus — a focus request from our own speech would make ExoPlayer
// pause or duck as if another app had interrupted, through the one mechanism
// the companion spent a month learning not to trust. So the channels settle it
// here, directly, when SasonicaSpeech says a reply has started or ended.
//
// It only ever undoes what it did: the music's volume is restored only if it
// is still the ducked level, and the book is resumed only if it was this that
// paused it, it has not been started again by hand, and the reply was not so
// long that the book coming back is a thing to decide rather than have happen.
// red5 pauses the book for a reply too (the book channel); whichever gets
// there first holds the pause and the other finds nothing playing, so they
// never both resume. Fork-only file.

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.audiobookshelf.app.speech.SasonicaSpeech

class SasonicaSpeechHold(private val player: () -> PlayerNotificationService?) : SasonicaSpeech.Replies {
  companion object {
    private const val tag = "SasonicaSpeechHold"
    /** Music under speech: quiet, not silent — route/policy.py's duck level, on ExoPlayer's 0..1. */
    private const val DUCK_VOLUME = 0.1f
    /** A reply longer than this leaves the book paused for David to lift (BookHold's window). */
    private const val BOOK_RESUME_WINDOW_MS = 30 * 60 * 1000L
  }

  private val main = Handler(Looper.getMainLooper())
  private var duckedFrom: Float? = null
  private var pausedBookAt = 0L

  override fun replyChanged(speaking: Boolean) {
    main.post {
      try {
        if (speaking) hold() else release()
      } catch (e: Exception) {
        Log.w(tag, "reply ${if (speaking) "start" else "end"}: $e")
      }
    }
  }

  private fun hold() {
    val svc = player() ?: return
    // Casting plays elsewhere: the room is not this phone's to duck.
    if (svc.currentPlayer != svc.mPlayer) return
    val exo = svc.mPlayer
    if (!exo.isPlaying) return
    if (SasonicaControl.isUrlSession(svc.currentPlaybackSession)) {
      if (duckedFrom == null) duckedFrom = exo.volume
      exo.volume = DUCK_VOLUME
      Log.i(tag, "music ducked for a reply")
    } else {
      svc.pause()
      pausedBookAt = System.currentTimeMillis()
      Log.i(tag, "book paused for a reply")
    }
  }

  private fun release() {
    val svc = player() ?: return
    val exo = svc.mPlayer
    duckedFrom?.let { was ->
      // Still our level: nobody else has set it since. Otherwise leave it be.
      if (kotlin.math.abs(exo.volume - DUCK_VOLUME) < 0.01f) exo.volume = was
      duckedFrom = null
      Log.i(tag, "music restored")
    }
    if (pausedBookAt > 0L) {
      val owed = !exo.isPlaying && System.currentTimeMillis() - pausedBookAt < BOOK_RESUME_WINDOW_MS &&
        !SasonicaControl.isUrlSession(svc.currentPlaybackSession)
      pausedBookAt = 0L
      if (owed) {
        svc.play()
        Log.i(tag, "book resumed after the reply")
      }
    }
  }
}
