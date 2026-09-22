// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.app.Activity;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

/**
 * Dictation for the composer, through the platform recogniser's own screen
 * (ACTION_RECOGNIZE_SPEECH). That screen holds the microphone, so this app
 * needs no RECORD_AUDIO permission: it only gets the words back. The
 * manifest's <queries> make the recogniser visible (Android 11+ package
 * visibility hides it otherwise, and available() would say no).
 *
 * A cancelled or empty listen resolves {text: ""}: saying nothing is a
 * normal outcome, not an error.
 *
 * JS: SpeechInput.available() -> {available}; SpeechInput.listen({prompt})
 * -> {text}. Used through lib/native.ts dictate().
 */
@CapacitorPlugin(name = "SpeechInput")
public class SpeechInputPlugin extends Plugin {
    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void listen(PluginCall call) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, call.getString("prompt", "Say it"));
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("no speech recogniser on this device");
            return;
        }
        startActivityForResult(call, intent, "heard");
    }

    @ActivityCallback
    private void heard(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        String text = "";
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> hits = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (hits != null && !hits.isEmpty() && hits.get(0) != null) text = hits.get(0);
        }
        ret.put("text", text);
        call.resolve(ret);
    }
}
