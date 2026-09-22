// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Background notifications without Firebase (David, 22 Sep 2026): a small
 * foreground service that keeps ONE stream open to the paired server —
 * GET /sessions/events (server-contract.md §6.13) — while the app is closed
 * or in the background, and posts "New reply · <title>" / "Needs you ·
 * <title>" from it. What to post is NotifyRules'; retry timing is Backoff's.
 *
 * - Type `specialUse` (Android 14+), not `dataSync`: from Android 15 a
 *   dataSync service is stopped after 6 hours a day, and this one is meant
 *   to run all day. specialUse may also start from BOOT_COMPLETED, which
 *   dataSync may not (15+).
 * - One connection. The server is asked for a ping every PING_S (120 s), so
 *   an idle stream wakes the radio only for a change or a ping; the read
 *   times out at twice that, which is how a dead connection is noticed.
 * - No wake lock: the thread blocks in a socket read and the CPU sleeps.
 * - Errors: Backoff (2 s doubling to 5 min, jittered). After 30 min without
 *   one good connection it PARKS — no timer, no attempts — and the
 *   persistent notification says so. A network change (default network
 *   callback) or the app being opened retries at once.
 * - A 401/403 parks too ("open Sasonica to pair again"): retrying a refused
 *   token only spends battery.
 * - Swiping the app away leaves the service running (stopWithTask is off by
 *   default); START_STICKY brings it back if the process is killed.
 * - The token comes from SecretBox (the SecureStore the web app writes);
 *   it is never logged, and neither is the URL's query (it has none).
 *
 * Settings live in the plain prefs file "sasonica_notify": `enabled`
 * (absent = on, once notifications are permitted) and `base` (the server
 * address, handed over by the web app's sync()).
 */
public class NotifyService extends Service {
    private static final String TAG = "SasonicaNotify";

    static final String ACTION_OFF = "com.sasonica.next.NOTIFY_OFF";
    static final String ACTION_KICK = "com.sasonica.next.NOTIFY_KICK";
    static final String ACTION_OPEN = "com.sasonica.next.OPEN_THREAD";
    static final String EXTRA_SESSION = "session";

    // The web app's LocalNotifications channels (lib/native.ts) use the same
    // two ids, so there is one "Replies" and one "Needs you" in Settings.
    static final String CH_REPLY = "replies";
    static final String CH_URGENT = "needs-you";
    static final String CH_LISTEN = "listening";

    static final int ID_STATUS = 0x5a5101;
    static final int ID_THREAD = 0x5a5102;
    static final int ID_SUMMARY = 0x5a5103;
    static final String GROUP = "com.sasonica.next.threads";
    private static final int COLOR = 0xFF7FD1AE;

    private static final int PING_S = 120;
    private static final int READ_TIMEOUT_MS = (PING_S * 2 + 30) * 1000;
    private static final int CONNECT_TIMEOUT_MS = 20_000;

    private static final String PREFS = "sasonica_notify";
    private static final String DEVICE_KEY = "sasonica.chat.device";
    private static final String TOKEN_KEY = "sasonica.chat.token";

    /** The app's activity is resumed (NotifyPlugin sets it). */
    static volatile boolean appOnScreen = false;
    private static volatile NotifyService instance;
    private static volatile String lastState = "";

    private final Object lock = new Object();
    private final NotifyRules rules = new NotifyRules();
    private final Backoff backoff = new Backoff(2_000, 5 * 60_000, 30 * 60_000);
    private volatile boolean stopping = false;
    private volatile HttpURLConnection conn;
    private boolean kicked = false;
    private Thread worker;
    private String identity = "";
    private Network network;
    private ConnectivityManager.NetworkCallback netCb;

    // ── Settings, for NotifyPlugin and NotifyBootReceiver ─────────────────

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** On unless turned off: the default once notifications are permitted. */
    static boolean enabled(Context ctx) {
        return prefs(ctx).getBoolean("enabled", true);
    }

    /** Whether the person has chosen (the toggle was ever touched). */
    static boolean decided(Context ctx) {
        return prefs(ctx).contains("enabled");
    }

    static void setEnabled(Context ctx, boolean on) {
        prefs(ctx).edit().putBoolean("enabled", on).apply();
    }

    static void setBase(Context ctx, String base) {
        if (base == null) return;
        prefs(ctx).edit().putString("base", stripSlashes(base.trim())).apply();
    }

    static boolean permitted(Context ctx) {
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
    }

    static boolean running() {
        return instance != null;
    }

    /** What the persistent notification says now ("" when not running). */
    static String state() {
        return instance != null ? lastState : "";
    }

    /** Where to connect and with what. Never logged. */
    static final class Creds {
        final String base;
        final String token;

        Creds(String base, String token) {
            this.base = base;
            this.token = token;
        }
    }

    static Creds creds(Context ctx) {
        String token = null;
        String base = null;
        String dev = SecretBox.read(ctx, DEVICE_KEY);
        if (dev != null) {
            try {
                JSONObject o = new JSONObject(dev);
                token = o.optString("token", null);
                JSONObject server = o.optJSONObject("server");
                if (server != null) base = server.optString("base", null);
            } catch (Exception e) {
                token = null;
            }
        }
        if (token == null || token.isEmpty()) token = SecretBox.read(ctx, TOKEN_KEY);
        String set = prefs(ctx).getString("base", "");
        if (set != null && !set.isEmpty()) base = set;
        if (token == null || token.isEmpty() || base == null || base.isEmpty()) return null;
        return new Creds(stripSlashes(base), token);
    }

    private static String stripSlashes(String s) {
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    /**
     * Bring the service in line with the settings: started (or poked to
     * retry now) when on, permitted and paired; stopped otherwise. Returns
     * why it is not running, or "" when it is (or was just started).
     */
    static String sync(Context ctx) {
        String why = !enabled(ctx) ? "off"
            : !permitted(ctx) ? "notifications not allowed"
            : creds(ctx) == null ? "not paired" : "";
        if (!why.isEmpty()) {
            ctx.stopService(new Intent(ctx, NotifyService.class));
            return why;
        }
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, NotifyService.class).setAction(ACTION_KICK));
            return "";
        } catch (Exception e) {
            // ForegroundServiceStartNotAllowedException (12+): started from
            // the background without an exemption. The next app start retries.
            Log.w(TAG, "could not start: " + e.getClass().getSimpleName());
            return "could not start";
        }
    }

    /** The app came to the front: a parked or waiting service tries again now. */
    static void poke() {
        NotifyService s = instance;
        if (s != null) s.kick();
    }

    /** The thread was opened: its notification has done its job. */
    static void clearThread(Context ctx, String session) {
        if (session == null || session.isEmpty()) return;
        NotificationManagerCompat.from(ctx).cancel(session, ID_THREAD);
        summarise(ctx);
    }

    // ── The service ───────────────────────────────────────────────────────

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        channels(this);
        Notification n = status("Sasonica · listening for replies", "Connecting…");
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ID_STATUS, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(ID_STATUS, n);
        }
        watchNetwork();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_OFF.equals(intent.getAction())) {
            // "Turn off" on the persistent notification: the same as the
            // Settings toggle.
            setEnabled(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!enabled(this) || creds(this) == null) {
            // A sticky restart after the setting changed or the device unpaired.
            stopSelf();
            return START_NOT_STICKY;
        }
        synchronized (lock) {
            if (worker == null || !worker.isAlive()) {
                stopping = false;
                worker = new Thread(this::loop, "sasonica-notify");
                worker.start();
            }
        }
        kick();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopping = true;
        instance = null;
        kick();
        drop();
        if (netCb != null) {
            try {
                ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(netCb);
            } catch (Exception ignored) {
                // Never registered.
            }
        }
        super.onDestroy();
    }

    /** Wake a wait (retry now) and forget the backoff. */
    void kick() {
        synchronized (lock) {
            kicked = true;
            lock.notifyAll();
        }
    }

    /** Close the connection in hand; its read ends and the loop goes on. */
    private void drop() {
        HttpURLConnection c = conn;
        if (c != null) {
            new Thread(c::disconnect, "sasonica-notify-drop").start();
        }
    }

    private void watchNetwork() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null || Build.VERSION.SDK_INT < 24) return;
        netCb = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network n) {
                // Called at once for the current network, and on every change
                // of default network (Wi-Fi ⇄ mobile): the old socket is dead
                // then, so drop it rather than wait for the read timeout.
                Network was = network;
                network = n;
                if (was != null && !was.equals(n)) drop();
                kick();
            }
        };
        try {
            cm.registerDefaultNetworkCallback(netCb);
        } catch (Exception e) {
            netCb = null;
        }
    }

    // ── The loop ──────────────────────────────────────────────────────────

    private static final class Refused extends IOException {
        Refused(int code) {
            super("HTTP " + code);
        }
    }

    private void loop() {
        while (!stopping) {
            Creds c = creds(this);
            if (c == null) {
                park("Not paired · open Sasonica to pair");
                continue;
            }
            // A different server or device: its first list is a new baseline.
            String who = c.base + "|" + Integer.toHexString(c.token.hashCode());
            if (!who.equals(identity)) {
                identity = who;
                rules.reset();
            }
            String why;
            try {
                synchronized (lock) {
                    kicked = false;
                }
                why = stream(c);
            } catch (Refused e) {
                park("Signed out · open Sasonica to pair again");
                continue;
            } catch (IOException e) {
                why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            } catch (Exception e) {
                why = e.getClass().getSimpleName();
            }
            if (stopping) break;
            long now = SystemClock.elapsedRealtime();
            long wait = Backoff.jitter(backoff.failure(now), Math.random());
            if (backoff.givenUp(now)) {
                park("Can't reach " + host(c.base) + " · paused until the network changes or you open Sasonica");
                continue;
            }
            say("Sasonica · reconnecting", "Retrying in " + Math.max(1, wait / 1000) + " s · " + why);
            sleep(wait);
        }
    }

    /** Stop trying until kicked (a network change, the app opened, a sync). */
    private void park(String why) {
        say("Sasonica · paused", why);
        synchronized (lock) {
            while (!kicked && !stopping) {
                try {
                    lock.wait();
                } catch (InterruptedException e) {
                    return;
                }
            }
            kicked = false;
        }
        backoff.success();
    }

    private void sleep(long ms) {
        long end = SystemClock.elapsedRealtime() + ms;
        synchronized (lock) {
            long left;
            while (!kicked && !stopping && (left = end - SystemClock.elapsedRealtime()) > 0) {
                try {
                    lock.wait(left);
                } catch (InterruptedException e) {
                    return;
                }
            }
            if (kicked) backoff.success();
            kicked = false;
        }
    }

    /** One connection, until it ends. Returns why it ended. */
    private String stream(Creds c) throws IOException {
        HttpURLConnection h = (HttpURLConnection) new URL(c.base + "/sessions/events?ping=" + PING_S).openConnection();
        conn = h;
        try {
            h.setConnectTimeout(CONNECT_TIMEOUT_MS);
            h.setReadTimeout(READ_TIMEOUT_MS);
            h.setUseCaches(false);
            h.setRequestProperty("Authorization", "Bearer " + c.token);
            h.setRequestProperty("Accept", "text/event-stream");
            int code = h.getResponseCode();
            if (code == 401 || code == 403) throw new Refused(code);
            if (code == 404) throw new IOException("the server has no /sessions/events yet");
            if (code != 200) throw new IOException("HTTP " + code);
            BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream(), StandardCharsets.UTF_8));
            SseReader sse = new SseReader();
            boolean first = true;
            String line;
            while (!stopping && (line = r.readLine()) != null) {
                SseReader.Frame f = sse.line(line);
                if (f == null || !"sessions".equals(f.event)) continue;
                List<NotifyRules.Row> rows = parse(f.data);
                if (rows == null) continue;
                if (first) {
                    first = false;
                    backoff.success();
                    say("Sasonica · listening for replies", "Connected to " + host(c.base));
                }
                for (NotifyRules.Action a : rules.next(rows, appOnScreen)) act(a);
            }
            return "the server closed the stream";
        } finally {
            conn = null;
            h.disconnect();
        }
    }

    static List<NotifyRules.Row> parse(String data) {
        try {
            JSONArray arr = new JSONObject(data).getJSONArray("sessions");
            List<NotifyRules.Row> rows = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                String s = o.optString("session", "");
                if (!s.isEmpty()) rows.add(new NotifyRules.Row(s, o.optString("title", ""), o.optString("state", "waiting")));
            }
            return rows;
        } catch (Exception e) {
            return null;
        }
    }

    private static String host(String base) {
        try {
            return new URL(base).getHost();
        } catch (Exception e) {
            return "the server";
        }
    }

    // ── Notifications ─────────────────────────────────────────────────────

    private static void channels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        // An existing channel keeps its settings: creating one again is a no-op
        // (the web app may have made "replies" and "needs-you" first).
        NotificationChannel reply = new NotificationChannel(CH_REPLY, "Replies", NotificationManager.IMPORTANCE_DEFAULT);
        reply.setDescription("A reply finished in a thread");
        NotificationChannel urgent = new NotificationChannel(CH_URGENT, "Needs you", NotificationManager.IMPORTANCE_HIGH);
        urgent.setDescription("A question or permission prompt is waiting");
        urgent.enableVibration(true);
        NotificationChannel listen = new NotificationChannel(CH_LISTEN, "Listening for replies", NotificationManager.IMPORTANCE_MIN);
        listen.setDescription("Shown while Sasonica keeps its connection open in the background");
        listen.setShowBadge(false);
        nm.createNotificationChannel(reply);
        nm.createNotificationChannel(urgent);
        nm.createNotificationChannel(listen);
    }

    private PendingIntent openApp(String session, int requestCode) {
        Intent i = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (session != null) i.setAction(ACTION_OPEN).putExtra(EXTRA_SESSION, session);
        return PendingIntent.getActivity(this, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification status(String title, String text) {
        PendingIntent off = PendingIntent.getService(this, 1,
            new Intent(this, NotifyService.class).setAction(ACTION_OFF),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CH_LISTEN)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(COLOR)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openApp(null, 0))
            .addAction(0, "Turn off", off)
            .build();
    }

    /** Update the persistent notification (and what status() reports). */
    private void say(String title, String text) {
        lastState = text;
        if (stopping) return;
        try {
            NotificationManagerCompat.from(this).notify(ID_STATUS, status(title, text));
        } catch (SecurityException ignored) {
            // Notifications revoked: the service still runs, silently.
        }
    }

    private void act(NotifyRules.Action a) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(this);
        if (a.kind == NotifyRules.Action.Kind.CANCEL) {
            // Only a "Needs you" is withdrawn: a reply stays readable.
            StatusBarNotification sb = shown(this, a.session);
            if (sb != null && (Build.VERSION.SDK_INT < 26 || CH_URGENT.equals(sb.getNotification().getChannelId()))) {
                nm.cancel(a.session, ID_THREAD);
                summarise(this);
            }
            return;
        }
        if (!nm.areNotificationsEnabled()) return;
        boolean urgent = a.kind == NotifyRules.Action.Kind.NEEDS_YOU;
        Notification n = new NotificationCompat.Builder(this, urgent ? CH_URGENT : CH_REPLY)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(COLOR)
            .setContentTitle(a.heading())
            .setContentText(urgent ? "Waiting for you in Sasonica" : "Tap to open the thread")
            .setAutoCancel(true)
            .setGroup(GROUP)
            .setPriority(urgent ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(urgent ? NotificationCompat.CATEGORY_REMINDER : NotificationCompat.CATEGORY_MESSAGE)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setContentIntent(openApp(a.session, a.session.hashCode()))
            .build();
        try {
            // One per thread (tag = session): a newer one replaces it.
            nm.notify(a.session, ID_THREAD, n);
        } catch (SecurityException ignored) {
            return;
        }
        summarise(this);
    }

    private static StatusBarNotification shown(Context ctx, String session) {
        if (Build.VERSION.SDK_INT < 23) return null;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return null;
        for (StatusBarNotification sb : nm.getActiveNotifications()) {
            if (sb.getId() == ID_THREAD && session.equals(sb.getTag())) return sb;
        }
        return null;
    }

    /** A group summary while two or more threads have a notification up. */
    private static void summarise(Context ctx) {
        if (Build.VERSION.SDK_INT < 23) return;
        NotificationManager sys = ctx.getSystemService(NotificationManager.class);
        if (sys == null) return;
        int threads = 0;
        for (StatusBarNotification sb : sys.getActiveNotifications()) {
            if (sb.getId() == ID_THREAD) threads++;
        }
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        if (threads < 2) {
            nm.cancel(ID_SUMMARY);
            return;
        }
        Notification sum = new NotificationCompat.Builder(ctx, CH_REPLY)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(COLOR)
            .setContentTitle("Sasonica")
            .setContentText(threads + " threads")
            .setGroup(GROUP)
            .setGroupSummary(true)
            .setAutoCancel(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .build();
        try {
            nm.notify(ID_SUMMARY, sum);
        } catch (SecurityException ignored) {
            // Not permitted.
        }
    }
}
