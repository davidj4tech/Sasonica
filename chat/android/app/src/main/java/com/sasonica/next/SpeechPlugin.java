// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.sasonica.next.speech.SpeechService;

/**
 * The web app's handle on SpeechService — replies spoken by this app.
 *
 * - status() -> {enabled, running, listening, speaking, port}: `enabled` is
 *   the Settings toggle (off until turned on, while the old Sasonica app is
 *   still the phone's speech player), `listening` the address and port red5
 *   should be pointed at, `speaking` whether a reply is playing now.
 * - setEnabled({enabled}) -> status: the toggle; starts or stops at once.
 *
 * Opening the app syncs the service, which is also how it comes back after a
 * reboot: a mediaPlayback service may not start itself from BOOT_COMPLETED.
 *
 * JS: lib/native.ts (Speech).
 */
@CapacitorPlugin(name = "Speech")
public class SpeechPlugin extends Plugin {

    @Override
    public void load() {
        SpeechService.sync(getContext());
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        SpeechService.sync(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        SpeechService.setEnabled(getContext(), call.getBoolean("enabled", false));
        SpeechService.sync(getContext());
        call.resolve(state());
    }

    private JSObject state() {
        JSObject o = new JSObject();
        o.put("enabled", SpeechService.enabled(getContext()));
        o.put("running", SpeechService.running());
        o.put("listening", SpeechService.listening());
        o.put("speaking", SpeechService.speaking());
        o.put("port", SpeechService.PORT);
        return o;
    }
}
