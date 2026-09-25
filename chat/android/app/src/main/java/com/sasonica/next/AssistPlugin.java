// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The phone's assistant button (the ACTION_ASSIST filter in the manifest:
 * the assist gesture, the power key's long press, an earbud's long press).
 *
 * The activity is singleTask, so a running app gets the intent through
 * onNewIntent and a cold start through the launching intent; both become one
 * `assist` event. It is retained until the page has a listener, which on a
 * cold start is some seconds after load() runs.
 *
 * `shown` says whether the app was on screen when the button was pressed
 * (started and not stopped: a press from another app, the lock screen or a
 * cold start is false), so the page can tell "into the chat I am looking at"
 * from "a new chat".
 *
 * JS: Assist.addListener('assist', ({at, shown}) => …) — lib/native.ts onAssist().
 */
@CapacitorPlugin(name = "Assist")
public class AssistPlugin extends Plugin {
    /** Between onStart and onStop. A new intent only pauses a visible activity. */
    private boolean started = false;

    @Override
    public void load() {
        if (getActivity() != null) assist(getActivity().getIntent(), false);
    }

    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        started = true;
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        started = false;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        assist(intent, started);
    }

    private void assist(Intent intent, boolean shown) {
        if (intent == null || !Intent.ACTION_ASSIST.equals(intent.getAction())) return;
        JSObject ev = new JSObject();
        ev.put("at", System.currentTimeMillis());
        ev.put("shown", shown);
        notifyListeners("assist", ev, true);
        // Consumed: a rotation or a recreate re-delivers the launching intent.
        intent.setAction(null);
    }
}
