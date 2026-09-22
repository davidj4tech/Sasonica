// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next.speech;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The two buttons on the waiting card ({@link Holds}). */
public class SpeechReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (Holds.ACTION_SPEAK_NOW.equals(action)) {
            Holds.speakNow();
        } else if (Holds.ACTION_LATER.equals(action)) {
            Holds.later();
        }
    }
}
