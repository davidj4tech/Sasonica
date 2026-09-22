// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Secrets (the device token) kept out of WebView storage: each value is
 * sealed with AES-256-GCM under a key that lives in the Android Keystore and
 * never leaves it, and only the ciphertext goes to a private
 * SharedPreferences file. Backup is off for the app (the key does not travel
 * with a backup, so restored ciphertext would be useless anyway).
 *
 * The sealing itself is SecretBox's, shared with NotifyService (which reads
 * the device token while no WebView is running).
 *
 * JS: SecureStore.get({key}) -> {value: string|null}; set({key, value});
 */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {
    private SharedPreferences prefs() {
        return SecretBox.prefs(getContext());
    }

    private String seal(String plain) throws Exception {
        return SecretBox.seal(plain);
    }

    private String open(String sealed) throws Exception {
        return SecretBox.open(sealed);
    }

    @PluginMethod
    public void get(PluginCall call) {
        String k = call.getString("key");
        if (k == null || k.isEmpty()) {
            call.reject("key is required");
            return;
        }
        JSObject ret = new JSObject();
        String sealed = prefs().getString(k, null);
        if (sealed == null) {
            ret.put("value", JSObject.NULL);
            call.resolve(ret);
            return;
        }
        try {
            ret.put("value", open(sealed));
        } catch (Exception e) {
            // A key lost (app data restored elsewhere, keystore reset): the
            // value cannot be read, so it is gone. Drop it; the app re-pairs.
            prefs().edit().remove(k).apply();
            ret.put("value", JSObject.NULL);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String k = call.getString("key");
        String v = call.getString("value");
        if (k == null || k.isEmpty() || v == null) {
            call.reject("key and value are required");
            return;
        }
        try {
            prefs().edit().putString(k, seal(v)).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("could not seal the value: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String k = call.getString("key");
        if (k == null || k.isEmpty()) {
            call.reject("key is required");
            return;
        }
        prefs().edit().remove(k).apply();
        call.resolve();
    }
}
