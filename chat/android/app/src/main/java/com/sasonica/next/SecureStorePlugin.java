// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Secrets (the device token) kept out of WebView storage: each value is
 * sealed with AES-256-GCM under a key that lives in the Android Keystore and
 * never leaves it, and only the ciphertext goes to a private
 * SharedPreferences file. Backup is off for the app (the key does not travel
 * with a backup, so restored ciphertext would be useless anyway).
 *
 * JS: SecureStore.get({key}) -> {value: string|null}; set({key, value});
 */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "sasonica_next_secure_store";
    private static final String PREFS = "sasonica_secure_store";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        gen.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return gen.generateKey();
    }

    private String seal(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        ByteBuffer out = ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct);
        return Base64.encodeToString(out.array(), Base64.NO_WRAP);
    }

    private String open(String sealed) throws Exception {
        byte[] all = Base64.decode(sealed, Base64.NO_WRAP);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, all, 0, IV_BYTES));
        return new String(c.doFinal(all, IV_BYTES, all.length - IV_BYTES), StandardCharsets.UTF_8);
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
