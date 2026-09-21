package com.audiobookshelf.app.speech;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Sasonica: the "Speak now" / "Later" buttons on the speech-waiting card. Fork-only file. */
public final class SasonicaSpeechReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (SasonicaHolds.ACTION_SPEAK_NOW.equals(action)) SasonicaHolds.speakNow();
        else if (SasonicaHolds.ACTION_LATER.equals(action)) SasonicaHolds.later();
    }
}
