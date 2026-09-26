// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica; no Audiobookshelf-derived code.
package com.sasonica.next.speech;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * call_guard's quiet knock: when the readouts on :8774 have been gone a while,
 * agent-media on the phone sends {@code am broadcast -n
 * com.sasonica.app/com.sasonica.next.speech.WakeReceiver}, and this starts the
 * speech service again if it is turned on. Exported because the shell sends it;
 * all it can do is what opening the app does. If Android refuses the start
 * from the background, call_guard follows with the activity.
 */
public class WakeReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        SpeechService.sync(context, true);
    }
}
