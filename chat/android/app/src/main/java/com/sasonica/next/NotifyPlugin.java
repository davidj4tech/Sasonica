// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The web app's handle on NotifyService (background notifications).
 *
 * - status() -> {enabled, decided, permitted, running, state}: `enabled` is
 *   the Settings toggle (on unless turned off), `decided` whether it was
 *   ever touched, `permitted` whether Android lets the app post, `running`
 *   whether the service is up, `state` what its notification says.
 * - setEnabled({enabled}) -> status: the toggle; starts or stops at once.
 * - sync({base}) -> status: the server address, and "credentials may have
 *   changed" (paired, unpaired, permission granted) — starts, pokes or
 *   stops the service to match.
 * - clear({session}): the thread was opened; its notification goes.
 * - event `open` {session}: a notification was tapped (retained until the
 *   page listens, like Assist's `assist`, for a cold start).
 *
 * It also tells the service whether the app is on screen (resume/pause):
 * nothing is posted then — the page shows its own notice.
 *
 * JS: lib/native.ts (BackgroundNotify).
 */
@CapacitorPlugin(name = "BackgroundNotify")
public class NotifyPlugin extends Plugin {
    @Override
    public void load() {
        if (getActivity() != null) route(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        route(intent);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        NotifyService.appOnScreen = true;
        NotifyService.poke();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        NotifyService.appOnScreen = false;
    }

    private void route(Intent intent) {
        if (intent == null || !NotifyService.ACTION_OPEN.equals(intent.getAction())) return;
        String session = intent.getStringExtra(NotifyService.EXTRA_SESSION);
        // Consumed: a rotation or a recreate re-delivers the launching intent.
        intent.setAction(null);
        if (session == null || session.isEmpty()) return;
        NotifyService.clearThread(getContext(), session);
        JSObject ev = new JSObject();
        ev.put("session", session);
        notifyListeners("open", ev, true);
    }

    private JSObject status() {
        JSObject ret = new JSObject();
        ret.put("enabled", NotifyService.enabled(getContext()));
        ret.put("decided", NotifyService.decided(getContext()));
        ret.put("permitted", NotifyService.permitted(getContext()));
        ret.put("running", NotifyService.running());
        ret.put("state", NotifyService.state());
        return ret;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean on = call.getBoolean("enabled");
        if (on == null) {
            call.reject("enabled is required");
            return;
        }
        NotifyService.setEnabled(getContext(), on);
        NotifyService.sync(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void sync(PluginCall call) {
        String base = call.getString("base");
        if (base != null) NotifyService.setBase(getContext(), base);
        NotifyService.sync(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotifyService.clearThread(getContext(), call.getString("session"));
        call.resolve();
    }
}
