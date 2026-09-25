// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * What another app shares to this one (the SEND / SEND_MULTIPLE filters in
 * the manifest): text, a link, a photo, a PDF, several files.
 *
 * Like AssistPlugin, the activity is singleTask, so a running app gets the
 * intent through onNewIntent and a cold start through the launching one; both
 * become one retained `share` event, {at, text, subject, files: [{path,
 * name, mime, size}]}. The files are copied out of the sender's content URIs
 * into the cache first (the read grant ends with the sender's task), off the
 * main thread, so the event comes a moment after the intent.
 *
 * `upload({path, url, headers})` streams one of those copies to the server's
 * POST /upload (the page adds the name to the URL and the bearer to the
 * headers) and answers its JSON as `body`; streamed, so a video never sits in
 * the WebView's memory. `clear()` drops the copies once the share is done.
 *
 * JS: lib/native.ts onShare(), uploadShared(), clearShared().
 */
@CapacitorPlugin(name = "ShareIn")
public class ShareInPlugin extends Plugin {
    @Override
    public void load() {
        if (getActivity() != null) share(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        share(intent);
    }

    private File dir() {
        return new File(getContext().getCacheDir(), "shared-in");
    }

    private void share(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = stream(intent);
            if (u != null) uris.add(u);
        } else {
            ArrayList<Uri> many = streams(intent);
            if (many != null) for (Uri u : many) if (u != null) uris.add(u);
        }
        String type = intent.getType();
        // Consumed: a rotation or a recreate re-delivers the launching intent.
        intent.setAction(null);
        long at = System.currentTimeMillis();
        new Thread(() -> {
            JSArray files = new JSArray();
            File into = new File(dir(), String.valueOf(at));
            for (Uri u : uris) {
                JSObject f = copy(u, into, uris.size() == 1 ? type : null);
                if (f != null) files.put(f);
            }
            JSObject ev = new JSObject();
            ev.put("at", at);
            ev.put("text", text == null ? "" : text.toString());
            ev.put("subject", subject == null ? "" : subject);
            ev.put("files", files);
            ev.put("failed", uris.size() - files.length());
            notifyListeners("share", ev, true);
        }, "share-in").start();
    }

    @SuppressWarnings("deprecation")
    private static Uri stream(Intent i) {
        if (Build.VERSION.SDK_INT >= 33) return i.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        return i.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private static ArrayList<Uri> streams(Intent i) {
        if (Build.VERSION.SDK_INT >= 33) return i.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        return i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }

    /** The file behind `u`, copied into `into`; null when it cannot be read. */
    private JSObject copy(Uri u, File into, String type) {
        ContentResolver cr = getContext().getContentResolver();
        String name = null;
        try (Cursor c = cr.query(u, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
        } catch (Exception e) {
            // A file:// URI or a provider without the column: the path's end below.
        }
        if (name == null || name.trim().isEmpty()) name = u.getLastPathSegment();
        if (name == null || name.trim().isEmpty()) name = "shared";
        name = name.replaceAll("[/\\\\]", "-");
        String mime = cr.getType(u);
        if (mime == null) mime = type;
        if (!into.isDirectory() && !into.mkdirs()) return null;
        File out = new File(into, name);
        for (int n = 2; out.exists(); n++) out = new File(into, n + "-" + name);
        long size = 0;
        try (InputStream in = cr.openInputStream(u); OutputStream os = new FileOutputStream(out)) {
            if (in == null) return null;
            byte[] buf = new byte[1 << 16];
            for (int r; (r = in.read(buf)) > 0; ) {
                os.write(buf, 0, r);
                size += r;
            }
        } catch (Exception e) {
            out.delete();
            return null;
        }
        JSObject f = new JSObject();
        f.put("path", out.getAbsolutePath());
        f.put("name", name);
        f.put("mime", mime == null ? "" : mime);
        f.put("size", size);
        return f;
    }

    @PluginMethod
    public void upload(PluginCall call) {
        String path = call.getString("path", "");
        String url = call.getString("url", "");
        JSObject headers = call.getObject("headers", new JSObject());
        File f = new File(path == null ? "" : path);
        // Only the copies made here: the page cannot send any other file.
        try {
            if (!f.getCanonicalPath().startsWith(dir().getCanonicalPath() + File.separator) || !f.isFile()) {
                call.reject("Not a shared file: " + path);
                return;
            }
        } catch (Exception e) {
            call.reject(e.getMessage());
            return;
        }
        new Thread(() -> {
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setRequestMethod("POST");
                con.setDoOutput(true);
                con.setConnectTimeout(15_000);
                con.setReadTimeout(120_000);
                con.setFixedLengthStreamingMode(f.length());
                con.setRequestProperty("Content-Type", "application/octet-stream");
                for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                    String k = it.next();
                    con.setRequestProperty(k, headers.getString(k));
                }
                try (InputStream in = new FileInputStream(f); OutputStream os = con.getOutputStream()) {
                    byte[] buf = new byte[1 << 16];
                    for (int r; (r = in.read(buf)) > 0; ) os.write(buf, 0, r);
                }
                int status = con.getResponseCode();
                InputStream body = status < 400 ? con.getInputStream() : con.getErrorStream();
                String text = "";
                if (body != null) {
                    try (InputStream b = body; java.io.ByteArrayOutputStream all = new java.io.ByteArrayOutputStream()) {
                        byte[] buf = new byte[8192];
                        for (int r; (r = b.read(buf)) > 0; ) all.write(buf, 0, r);
                        text = all.toString("UTF-8");
                    }
                }
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("body", text);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not send " + f.getName() + ": " + e.getMessage());
            } finally {
                if (con != null) con.disconnect();
            }
        }, "share-upload").start();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        delete(dir());
        call.resolve();
    }

    private static void delete(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) delete(k);
        f.delete();
    }
}
