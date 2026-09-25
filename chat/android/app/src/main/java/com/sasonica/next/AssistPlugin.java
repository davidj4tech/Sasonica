// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
 * The other assistants: `targets()` lists the apps that answer the assist
 * intent and take shared text (browsers left out, and this app), and
 * `handOff({id, text})` shares the words to one, or with no words opens it
 * as its own assistant. The Google app's assist is Gemini, whose share
 * target lives in its own package.
 *
 * JS: Assist.addListener('assist', ({at, shown}) => …) — lib/native.ts onAssist();
 * Assist.targets(), Assist.handOff() — lib/native.ts handOffTargets(), handOff().
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

    /** The Google app answers the assist intent; Gemini takes the words. */
    private static final String GOOGLE = "com.google.android.googlequicksearchbox";
    private static final String GEMINI = "com.google.android.apps.bard";

    @PluginMethod
    public void targets(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Set<String> browsers = new HashSet<>();
        Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("http://www.example.com"));
        for (ResolveInfo r : pm.queryIntentActivities(web, PackageManager.MATCH_ALL)) browsers.add(r.activityInfo.packageName);
        Map<String, ComponentName> shares = new LinkedHashMap<>();
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain");
        for (ResolveInfo r : pm.queryIntentActivities(send, 0)) {
            String pkg = r.activityInfo.packageName;
            if (!shares.containsKey(pkg)) shares.put(pkg, new ComponentName(pkg, r.activityInfo.name));
        }
        JSArray out = new JSArray();
        Set<String> seen = new HashSet<>();
        String self = getContext().getPackageName();
        List<ResolveInfo> assists = pm.queryIntentActivities(new Intent(Intent.ACTION_ASSIST), 0);
        for (ResolveInfo r : assists) {
            String pkg = r.activityInfo.packageName;
            if (pkg.equals(self) || pkg.startsWith("com.sasonica.") || browsers.contains(pkg) || !seen.add(pkg)) continue;
            String sharePkg = pkg.equals(GOOGLE) ? GEMINI : pkg;
            ComponentName share = shares.get(sharePkg);
            if (share == null) continue;
            JSObject t = new JSObject();
            t.put("id", pkg);
            t.put("label", label(pm, sharePkg));
            t.put("share", share.flattenToString());
            out.put(t);
        }
        JSObject ret = new JSObject();
        ret.put("targets", out);
        call.resolve(ret);
    }

    @PluginMethod
    public void handOff(PluginCall call) {
        String id = call.getString("id", "");
        String share = call.getString("share", "");
        String text = call.getString("text", "");
        Intent i;
        if (text != null && !text.trim().isEmpty() && share != null && !share.isEmpty()) {
            i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
            i.setComponent(ComponentName.unflattenFromString(share));
        } else {
            i = new Intent(Intent.ACTION_ASSIST).setPackage(id);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open " + id + ": " + e.getMessage());
        }
    }

    private static String label(PackageManager pm, String pkg) {
        try {
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (PackageManager.NameNotFoundException e) {
            return pkg;
        }
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
