package com.audiobookshelf.app.speech;

import android.content.Context;
import android.util.Log;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Sasonica: agent-media's speech, played in this app.
 *
 * The four classes beside this one come from agent-media's companion app
 * ({@code android/companion}, Apache-2.0, same author), moved here unchanged
 * but for their package: {@link MpvServer} answers the subset of mpv's JSON
 * protocol that red5's speech lane speaks, and {@link BuiltinSpeech} plays
 * what it is told to with MediaPlayer, fetching each clip over HTTP a clip
 * ahead. red5 needs no change to use it — only
 * {@code MEDIA_SPEECH_SOCKET_APP=tcp://p8a:6613} — and moves back by pointing
 * that at the companion's 6612 again.
 *
 * Step 1 of {@code docs/proposals/2026-09-19-companion-into-sasonica.md} in
 * agent-media. No arbitration with the book player yet: speech and a book can
 * overlap. Runs for as long as the remote service does, which is what keeps
 * the process thawed. Fork-only file.
 */
public final class SasonicaSpeech {
    private static final String TAG = "SasonicaSpeech";
    /** The companion keeps 6612 until it is retired; this is the app's port. */
    public static final int PORT = 6613;
    private static final String LOOPBACK = "127.0.0.1";
    /** How often to ask whether the tailnet address has changed. */
    private static final long REBIND_CHECK_S = 30;

    private static BuiltinSpeech player;
    private static MpvServer server;
    private static String boundTo;
    private static ScheduledExecutorService rebinder;

    private SasonicaSpeech() { }

    public static synchronized void start(Context context) {
        if (player != null) return;
        try {
            player = new BuiltinSpeech(context, line -> Log.i(TAG, line));
            bind();
            rebinder = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "speech-rebind");
                t.setDaemon(true);
                return t;
            });
            rebinder.scheduleWithFixedDelay(SasonicaSpeech::followTailnet,
                    REBIND_CHECK_S, REBIND_CHECK_S, TimeUnit.SECONDS);
        } catch (Throwable t) {
            // Optional: an app that cannot bind the port still plays books.
            Log.w(TAG, "speech unavailable: " + t);
        }
    }

    public static synchronized void stop() {
        if (rebinder != null) rebinder.shutdownNow();
        rebinder = null;
        if (server != null) server.stop();
        server = null;
        if (player != null) player.stop();
        player = null;
        boundTo = null;
    }

    /** Is a reply being played (or waiting to be) right now? */
    public static synchronized boolean active() {
        return player != null && player.active();
    }

    /** Where the listener is, for /state: "100.x.y.z:6613", or "" when down. */
    public static synchronized String listening() {
        MpvServer s = server;
        return (s == null || s.boundPort() <= 0) ? "" : boundTo + ":" + s.boundPort();
    }

    private static void bind() {
        String address = tailnetAddress();
        if (server != null) server.stop();
        server = new MpvServer(address, PORT, player, line -> Log.i(TAG, line));
        player.attach(server);
        server.start();
        boundTo = address;
        Log.i(TAG, "listening on " + address + ":" + PORT);
    }

    /**
     * Move the listener when the tailnet address changes, or when it holds
     * none. At boot this service routinely starts before tailscaled has an
     * address, binds loopback, and red5 cannot reach it — the companion lost
     * an afternoon's speech to that on 2026-09-11. Never mid-reply: a rebind
     * drops the connection red5 is following the reply on.
     */
    private static synchronized void followTailnet() {
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

    /** This phone's tailnet (100.64.0.0/10) address, or loopback when it has none. */
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
}
