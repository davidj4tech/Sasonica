// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The sealing behind SecureStorePlugin, usable without a plugin: AES-256-GCM
 * under a key that lives in the Android Keystore, ciphertext in a private
 * SharedPreferences file. NotifyService reads the paired device's token with
 * {@link #read} while the app's WebView is not running.
 */
final class SecretBox {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "sasonica_next_secure_store";
    private static final String PREFS = "sasonica_secure_store";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private SecretBox() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static synchronized SecretKey key() throws Exception {
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

    static String seal(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        ByteBuffer out = ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct);
        return Base64.encodeToString(out.array(), Base64.NO_WRAP);
    }

    static String open(String sealed) throws Exception {
        byte[] all = Base64.decode(sealed, Base64.NO_WRAP);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, all, 0, IV_BYTES));
        return new String(c.doFinal(all, IV_BYTES, all.length - IV_BYTES), StandardCharsets.UTF_8);
    }

    /** The value under `key`, or null (absent, or no longer readable). Never logs it. */
    static String read(Context ctx, String key) {
        String sealed = prefs(ctx).getString(key, null);
        if (sealed == null) return null;
        try {
            return open(sealed);
        } catch (Exception e) {
            return null;
        }
    }
}
