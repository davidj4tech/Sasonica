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
 * JS: Assist.addListener('assist', ({at}) => …) — lib/native.ts onAssist().
 */
@CapacitorPlugin(name = "Assist")
public class AssistPlugin extends Plugin {
    @Override
    public void load() {
        if (getActivity() != null) assist(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        assist(intent);
    }

    private void assist(Intent intent) {
        if (intent == null || !Intent.ACTION_ASSIST.equals(intent.getAction())) return;
        JSObject ev = new JSObject();
        ev.put("at", System.currentTimeMillis());
        notifyListeners("assist", ev, true);
        // Consumed: a rotation or a recreate re-delivers the launching intent.
        intent.setAction(null);
    }
}
