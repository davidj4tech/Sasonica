package com.audiobookshelf.app.plugins

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Dictation for the reply box.
 *
 * On a television there is no keyboard worth typing on, and the remote's
 * assistant button cannot help: it is bound to the system's voice interaction
 * service and consumed before any app sees it. So the app asks for dictation
 * itself, through the platform recogniser — the same one behind that button.
 *
 * `ACTION_RECOGNIZE_SPEECH` hands the microphone to the recogniser's own
 * activity, so this app needs no RECORD_AUDIO permission of its own; it only
 * receives the words back. A cancelled dialog resolves with empty text rather
 * than rejecting, because "said nothing" is a normal outcome, not an error.
 */
@CapacitorPlugin(name = "AbsSpeechInput")
class AbsSpeechInput : Plugin() {

  @PluginMethod
  fun available(call: PluginCall) {
    call.resolve(JSObject().put("available", SpeechRecognizer.isRecognitionAvailable(context)))
  }

  @PluginMethod
  fun listen(call: PluginCall) {
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PROMPT, call.getString("prompt") ?: "Reply")
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    }
    if (intent.resolveActivity(context.packageManager) == null) {
      call.reject("no speech recogniser on this device")
      return
    }
    startActivityForResult(call, intent, "spoken")
  }

  @ActivityCallback
  private fun spoken(call: PluginCall?, result: ActivityResult) {
    if (call == null) return
    if (result.resultCode != Activity.RESULT_OK) {
      call.resolve(JSObject().put("text", ""))
      return
    }
    val hits = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
    call.resolve(JSObject().put("text", hits?.firstOrNull() ?: ""))
  }
}
