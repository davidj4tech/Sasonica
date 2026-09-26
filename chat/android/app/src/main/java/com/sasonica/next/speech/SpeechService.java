// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next.speech;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.sasonica.next.MainActivity;
import com.sasonica.next.R;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Speech played here: the player and the socket red5 drives it through.
 *
 * agent-media's speech sink writes mpv's JSON IPC into a socket, and has for a
 * year. {@link MpvServer} answers on one, {@link Media3Speech} makes the noise,
 * and this service is what keeps both alive while the app is closed — a player
 * on an activity is frozen by ActivityManager about a minute after it leaves
 * the screen, which was measured, not guessed.
 *
 * <h4>Beside the old app, not instead of it</h4>
 *
 * The old Sasonica app answers on p8a:6613 and is still the one red5 points at.
 * This listens on {@link #PORT} (6614) so both can run, and red5 chooses with
 * {@code MEDIA_SPEECH_SOCKET_NEXT=tcp://p8a:6614} and {@code media say --target
 * next}. When Next becomes the default, the old app's port is free and this can
 * take it.
 *
 * <h4>Where it listens</h4>
 *
 * On the phone's tailnet address, re-checked every {@link #REBIND_CHECK_S}
 * seconds and never mid-reply. At boot a service routinely starts before
 * tailscaled has an address, binds loopback, and red5 cannot reach it — the
 * companion lost an afternoon's speech to that on 11 Sep 2026.
 *
 * <h4>What it cannot do yet</h4>
 *
 * Start itself after a reboot. A {@code mediaPlayback} service may not be
 * started from {@code BOOT_COMPLETED} on Android 15, unlike the {@code
 * specialUse} one that carries the notifications, so until the trial is over
 * and speech has a reason to be up before the app is opened, opening Sasonica
 * (or turning the toggle off and on) is what starts it.
 */
public class SpeechService extends Service {
    private static final String TAG = "SasonicaSpeech";

    /** The old app keeps 6613 until it retires; this is Next's port. */
    public static final int PORT = 6614;

    static final String ACTION_OFF = "com.sasonica.next.SPEECH_OFF";

    private static final String PREFS = "sasonica_speech";
    private static final String CH_SPEECH = "speech";
    private static final int ID_STATUS = 0x5a5201;
    private static final int COLOR = 0xFF7FD1AE;
    private static final String LOOPBACK = "127.0.0.1";

    /** How often to ask whether the tailnet address has changed. */
    private static final long REBIND_CHECK_S = 30;

    private static volatile SpeechService instance;

    private Media3Speech player;
    private MpvServer server;
    private boolean foreground;
    private static final String EXTRA_BACKGROUND = "background";
    private Readouts readouts;

    /**
     * The player, as {@link Holds} needs to see it.
     *
     * Two of these questions are the protocol's, not the player's: red5 sets a
     * speaking flag for the whole of a reply and a priority with it, and both
     * arrive as stored properties on the socket. Asking the player alone would
     * miss the gap between a reply being queued and its first clip opening,
     * which is exactly when a hold has to be decided.
     */
    private final Holds.Speech holds = new Holds.Speech() {
        @Override public boolean audible() {
            Media3Speech p = player;
            return p != null && !p.idle() && !p.paused();
        }

        @Override public boolean replying() {
            Media3Speech p = player;
            MpvServer s = server;
            if (p == null) return false;
            return (s != null && s.storedFlag("user-data/agent-media/speaking"))
                    || !p.idle();
        }

        @Override public String priority() {
            MpvServer s = server;
            return s == null ? "" : s.storedText("user-data/agent-media/priority");
        }

        @Override public void pause(boolean paused) {
            Media3Speech p = player;
            if (p != null) p.pause(paused);
        }
    };
    private String boundTo = "";
    private ScheduledExecutorService rebinder;

    // ── Settings, for SpeechPlugin ────────────────────────────────────────

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Off until turned on. The old app is still the speech player on this
     * phone, and two listeners both claiming to be it is the kind of thing
     * that is only noticed when a reply goes missing.
     */
    public static boolean enabled(Context ctx) {
        return prefs(ctx).getBoolean("enabled", true);
    }

    public static void setEnabled(Context ctx, boolean on) {
        prefs(ctx).edit().putBoolean("enabled", on).apply();
    }

    public static boolean running() {
        return instance != null;
    }

    /** Where the listener is, for Settings: "100.x.y.z:6614", or "". */
    public static String listening() {
        SpeechService s = instance;
        if (s == null) return "";
        synchronized (s) {
            MpvServer m = s.server;
            return (m == null || m.boundPort() <= 0) ? "" : s.boundTo + ":" + m.boundPort();
        }
    }

    /** What the holds are doing, for Settings ("" when not running). */
    public static String holding() {
        return instance == null ? "" : Holds.why();
    }

    /** Is the microphone watch alive (as against "is something recording")? */
    public static boolean watchingMic() {
        return instance != null && Holds.watching();
    }

    /** Is a reply playing (or parked, recently)? */
    public static boolean speaking() {
        SpeechService s = instance;
        if (s == null) return false;
        Media3Speech p;
        synchronized (s) {
            p = s.player;
        }
        return p != null && p.active();
    }

    /**
     * Bring the service in line with the setting. Returns why it is not
     * running, or "" when it is.
     */
    public static String sync(Context ctx) {
        return sync(ctx, false);
    }

    /**
     * The same, from a broadcast — a reboot or an update. Android 15 will not
     * start a mediaPlayback service from BOOT_COMPLETED, so a background start
     * goes foreground as specialUse instead: the same service playing the same
     * speech, under the type a boot receiver may start. Opening the app still
     * finds it running and leaves it be.
     */
    public static String sync(Context ctx, boolean background) {
        if (!enabled(ctx)) {
            ctx.stopService(new Intent(ctx, SpeechService.class));
            return "off";
        }
        if (running()) return "";
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, SpeechService.class)
                    .putExtra(EXTRA_BACKGROUND, background));
            return "";
        } catch (Exception e) {
            // ForegroundServiceStartNotAllowedException (12+): started from
            // the background without an exemption. Opening the app retries.
            Log.w(TAG, "could not start: " + e.getClass().getSimpleName());
            return "could not start";
        }
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
        channel();
    }

    /** Foreground on the first start command, which is the first place the
     *  service learns who started it. A sticky restart (no intent) is a
     *  background start too. */
    private void goForeground(Intent intent) {
        if (foreground) return;
        foreground = true;
        boolean background = intent == null || intent.getBooleanExtra(EXTRA_BACKGROUND, false);
        Notification n = status("Starting…");
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ID_STATUS, n, background
                    ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                    : ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(ID_STATUS, n);
        }
        start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        goForeground(intent);
        if (intent != null && ACTION_OFF.equals(intent.getAction())) {
            // "Turn off" on the notification: the same as the Settings toggle.
            setEnabled(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!enabled(this)) {
            // A sticky restart after the setting changed.
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stop();
        instance = null;
        super.onDestroy();
    }

    private synchronized void start() {
        if (player != null) return;
        try {
            player = new Media3Speech(this, line -> Log.i(TAG, line));
            bind();
            rebinder = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "speech-rebind");
                t.setDaemon(true);
                return t;
            });
            rebinder.scheduleWithFixedDelay(this::followTailnet,
                    REBIND_CHECK_S, REBIND_CHECK_S, TimeUnit.SECONDS);
            // Speech waits while he is talking to something else. Started
            // after the socket: the holds read the player, and a player that
            // failed to build is a service that has already given up.
            Holds.start(this, holds);
            startReadouts();
        } catch (Throwable t) {
            // The port may be taken, or the player may not build. Say so on the
            // notification rather than dying silently: the symptom otherwise is
            // a reply that is never heard.
            Log.w(TAG, "speech unavailable: " + t);
            say("Not listening · " + t);
        }
    }

    /** call_guard's /mic, ringer.py's /ringer and the doctor's /state, on
     *  loopback. Its own try: a taken port costs the readouts, not the speech. */
    private void startReadouts() {
        try {
            readouts = new Readouts(Readouts.PORT, Readouts.holds());
            readouts.start();
        } catch (Throwable t) {
            Log.w(TAG, "readouts unavailable on " + Readouts.PORT + ": " + t);
            readouts = null;
        }
    }

    private synchronized void stop() {
        if (readouts != null) readouts.stop();
        readouts = null;
        Holds.stop();
        if (rebinder != null) rebinder.shutdownNow();
        rebinder = null;
        if (server != null) server.stop();
        server = null;
        if (player != null) player.release();
        player = null;
        boundTo = "";
    }

    /** Bind (or move) the listener. Caller holds the monitor. */
    private void bind() {
        String address = tailnetAddress();
        if (server != null) server.stop();
        server = new MpvServer(address, PORT, player, line -> Log.i(TAG, line));
        player.attach(server);
        server.start();
        boundTo = address;
        Log.i(TAG, "listening on " + address + ":" + PORT);
        say(LOOPBACK.equals(address)
                ? "Waiting for the tailnet · listening on " + address + ":" + PORT
                : "Listening on " + address + ":" + PORT);
    }

    /**
     * Follow the tailnet address, and never mid-reply: a rebind drops the
     * connection red5 is following the reply on.
     */
    private synchronized void followTailnet() {
        try {
            if (player == null) return;
            MpvServer s = server;
            boolean listening = s != null && s.boundPort() > 0;
            String address = tailnetAddress();
            if (listening && address.equals(boundTo)) return;
            if (player.active()) return;
            Log.i(TAG, "listener moving to " + address + " (was " + boundTo + ")");
            bind();
        } catch (Throwable t) {
            Log.w(TAG, "rebind failed: " + t);
        }
    }

    /** This phone's tailnet (100.64.0.0/10) address, or loopback without one. */
    static String tailnetAddress() {
        try {
            Enumeration<NetworkInterface> nics = NetworkInterface.getNetworkInterfaces();
            while (nics != null && nics.hasMoreElements()) {
                Enumeration<InetAddress> addrs = nics.nextElement().getInetAddresses();
                while (addrs.hasMoreElements()) {
                    String a = addrs.nextElement().getHostAddress();
                    if (isTailnet(a)) return a;
                }
            }
        } catch (Exception ignored) {
            // No interfaces to read is the same answer as no tailnet.
        }
        return LOOPBACK;
    }

    static boolean isTailnet(String address) {
        if (address == null) return false;
        String[] parts = address.split("\\.");
        if (parts.length != 4) return false;
        try {
            int first = Integer.parseInt(parts[0]);
            int second = Integer.parseInt(parts[1]);
            return first == 100 && second >= 64 && second <= 127;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    // ── The notification ──────────────────────────────────────────────────

    private void channel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CH_SPEECH, "Speaking replies",
                NotificationManager.IMPORTANCE_MIN);
        ch.setDescription("Shown while Sasonica is ready to speak replies aloud");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private Notification status(String text) {
        PendingIntent off = PendingIntent.getService(this, 1,
                new Intent(this, SpeechService.class).setAction(ACTION_OFF),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CH_SPEECH)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(COLOR)
                .setContentTitle("Sasonica · speech")
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setOngoing(true)
                .setShowWhen(false)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(open)
                .addAction(0, "Turn off", off)
                .build();
    }

    private void say(String text) {
        try {
            NotificationManagerCompat.from(this).notify(ID_STATUS, status(text));
        } catch (SecurityException ignored) {
            // Notifications revoked: the service still runs, silently.
        }
    }
}
