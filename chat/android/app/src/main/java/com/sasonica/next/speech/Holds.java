// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next, from the old Sasonica app's SasonicaHolds (which
// came from agent-media's companion app, Apache-2.0 at both ends). The classes
// it drives — MicWatch, BargeIn, DictationHold, HoldRate, RingerState — came
// across unchanged. No Audiobookshelf-derived code.
package com.sasonica.next.speech;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Speech waits while David is talking to something else.
 *
 * Without this, a reply talks straight over him. The microphone says who is
 * talking and to what — no permission needed, because an app is told what
 * others record — and the phone's audio mode says when it is a call:
 *
 * <ul>
 *   <li><b>Dictation</b> (the keyboard's mic): speech pauses, silently, and
 *       carries on when the mic closes — {@link DictationHold}, which gives up
 *       after two minutes.</li>
 *   <li><b>A voice session</b> (Claude Live, a call — anything recording as
 *       {@code VOICE_COMMUNICATION}): speech is held for the whole session and
 *       carries on after it. An urgent reply takes the room.</li>
 * </ul>
 *
 * Pauses are re-asserted on every tick, as the companion did: red5 clears the
 * speech player's pause at the start of each reply, and a reply arriving
 * mid-dictation would otherwise start talking over it.
 *
 * <h4>What is different here from the old app</h4>
 *
 * No {@code BookHold}: Next has no book player, so there is no book of its own
 * to pause. While both apps are installed the old app holds its own book, and
 * once Next plays books too this is where that hold comes back.
 *
 * The speech player is reached through {@link Speech} rather than a mirrored
 * {@code MpvState}: Next has one player and the protocol already knows what it
 * is doing, so a second copy of its state would only be a way to disagree.
 *
 * <h4>A call counts as a voice session</h4>
 *
 * By the phone's own audio mode (ringing, in a call, in a voice chat): a
 * telephony call is not a recording another app is told about, and red5's call
 * guard pauses the Termux players, not this one.
 *
 * <h4>The card</h4>
 *
 * While a reply waits out a session, a notification says so, with "Speak now"
 * (for the rest of the session) and "Later" (drop the card, keep waiting).
 */
final class Holds {
    private static final String TAG = "SasonicaHolds";
    private static final long TICK_MS = 500;
    private static final String CARD_CHANNEL = "speech-waiting";
    private static final int CARD_ID = 0x5a5202;
    static final String ACTION_SPEAK_NOW = "com.sasonica.next.SPEAK_NOW";
    static final String ACTION_LATER = "com.sasonica.next.SPEAK_LATER";

    /** The speech player, as the holds need to see it. */
    interface Speech {
        /** Something is being said out loud right now. */
        boolean audible();
        /** A reply is in flight — playing, or queued and about to be. */
        boolean replying();
        /** red5's priority for the reply in hand: "urgent", "low", or "". */
        String priority();
        /** Hold or release the player. */
        void pause(boolean paused);
    }

    private static Handler main;
    private static AudioManager audio;
    private static MicWatch mic;
    private static final BargeIn bargeIn = new BargeIn();
    private static final DictationHold dictation = new DictationHold();
    private static final HoldRate dictationRate = new HoldRate();
    private static Context appContext;
    private static Speech speech;
    private static boolean speakNow;
    private static boolean heldForSession;
    private static boolean urgentForSession;
    private static String last = "";

    private Holds() { }

    static synchronized void start(Context context, Speech player) {
        if (main != null) return;
        main = new Handler(Looper.getMainLooper());
        appContext = context.getApplicationContext();
        speech = player;
        audio = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
        bargeIn.logTo(line -> Log.i(TAG, line));
        mic = new MicWatch(audio, main, active -> {
            bargeIn.onMic(active, mic.source(), System.currentTimeMillis());
            evaluate();
        });
        mic.start();
        main.postDelayed(tick, TICK_MS);
    }

    static synchronized void stop() {
        if (main == null) return;
        main.removeCallbacks(tick);
        if (mic != null) mic.stop();
        mic = null;
        cancelCard();
        speech = null;
        main = null;
        heldForSession = false;
        urgentForSession = false;
        speakNow = false;
    }

    static boolean watching() {
        MicWatch m = mic;
        return m != null && m.watching();
    }

    // ---- the readouts -----------------------------------------------------

    /** call_guard's {@code /mic}: "1|0 n=<count> <why> <detail>". */
    static String micLine() {
        MicWatch m = mic;
        if (m == null) return "0 n=0 not watching -";
        long now = System.currentTimeMillis();
        boolean hold = m.active() && bargeIn.holding(now);
        return (hold ? "1" : "0") + " n=" + m.count() + " " + bargeIn.why(now) + " " + m.detail();
    }

    /** ringer.py's {@code /ringer}: the ringer switch and Do Not Disturb, read live. */
    static String ringerLine() {
        AudioManager a = audio;
        Context c = appContext;
        if (a == null || c == null) return "unknown dnd=unknown granted=0";
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        boolean granted = nm != null && nm.isNotificationPolicyAccessGranted();
        int filter = granted ? nm.getCurrentInterruptionFilter() : RingerState.FILTER_UNKNOWN;
        return RingerState.line(a.getRingerMode(), filter, granted);
    }

    /** Dictation holds in the last hour — `media doctor`'s check that the mic
     *  baseline has not come back (Android System Intelligence never lets go). */
    static int dictationHolds1h() {
        return dictationRate.recent(System.currentTimeMillis());
    }

    /** "" or why the hold rate looks like a machine, not a person. */
    static String dictationRateProblem() {
        return dictationRate.problem(System.currentTimeMillis());
    }

    /** One line for the Settings page and the log: what is holding, and why. */
    static String why() {
        long now = System.currentTimeMillis();
        return "mic: " + bargeIn.why(now) + "; dictation: " + dictation.why()
                + "; session: " + (heldForSession ? "holding speech"
                        : urgentForSession ? "urgent, speaking" : "not holding");
    }

    /** "Speak now" on the card: the rest of this session is not held. */
    static void speakNow() {
        Handler h = main;
        if (h == null) return;
        h.post(() -> {
            speakNow = true;
            cancelCard();
            note("speak now: releasing the hold for this session");
            pause(false);
        });
    }

    /** "Later" on the card: the card goes, the hold stays. */
    static void later() {
        Handler h = main;
        if (h != null) h.post(Holds::cancelCard);
    }

    // ---- the tick ---------------------------------------------------------

    private static final Runnable tick = new Runnable() {
        @Override public void run() {
            try {
                bargeIn.onTick(System.currentTimeMillis());
                evaluate();
            } catch (Throwable t) {
                Log.w(TAG, "tick: " + t);
            }
            Handler h = main;
            if (h != null) h.postDelayed(this, TICK_MS);
        }
    };

    private static void evaluate() {
        long now = System.currentTimeMillis();
        Speech s = speech;
        if (s == null) return;
        boolean audible = s.audible();
        boolean replying = s.replying();
        String priority = s.priority();
        int mode = audio == null ? AudioManager.MODE_NORMAL : audio.getMode();
        boolean phoneCall = mode == AudioManager.MODE_RINGTONE
                || mode == AudioManager.MODE_IN_CALL
                || mode == AudioManager.MODE_IN_COMMUNICATION;
        boolean session = bargeIn.voiceSession() || phoneCall;

        // A voice session: hold every reply until it is over.
        if (session) {
            if ("urgent".equals(priority)) urgentForSession = true;
            if (!urgentForSession && !speakNow && replying) {
                if (!heldForSession) {
                    note("holding speech for a voice session"
                            + (phoneCall ? " (the phone is in a call)" : ""));
                    if (!"low".equals(priority)) showCard();
                }
                heldForSession = true;
                if (audible) pause(true);
            }
        } else {
            urgentForSession = false;
            speakNow = false;
            if (heldForSession) {
                heldForSession = false;
                cancelCard();
                note("voice session over, speech carries on");
                pause(false);
            }
        }

        // Dictation: quiet, short, and it gives up on its own.
        boolean micOpen = mic != null && mic.active();
        boolean wasDictating = dictation.holding();
        DictationHold.Action d =
                dictation.onState(micOpen, bargeIn.conversationMic(), audible, now);
        if (dictation.holding() && !wasDictating) dictationRate.engaged(now);
        if (d == DictationHold.Action.PAUSE) {
            pause(true);
        } else if (d == DictationHold.Action.RESUME && !heldForSession) {
            note("dictation over, speech carries on");
            pause(false);
        }
    }

    private static void pause(boolean wanted) {
        Speech s = speech;
        if (s != null) s.pause(wanted);
    }

    // ---- the card ---------------------------------------------------------

    private static void showCard() {
        Context c = appContext;
        if (c == null) return;
        try {
            NotificationManager nm =
                    (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(CARD_CHANNEL,
                        "Speech waiting", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("A reply is waiting until your call or conversation ends.");
                ch.setSound(null, null);
                nm.createNotificationChannel(ch);
            }
            int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent now = PendingIntent.getBroadcast(c, 1,
                    new Intent(ACTION_SPEAK_NOW).setClass(c, SpeechReceiver.class), flags);
            PendingIntent later = PendingIntent.getBroadcast(c, 2,
                    new Intent(ACTION_LATER).setClass(c, SpeechReceiver.class), flags);
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(c, CARD_CHANNEL)
                    : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_lock_silent_mode)
                    .setContentTitle("Sasonica has something to say")
                    .setContentText("Waiting until you are done talking")
                    .setOnlyAlertOnce(true)
                    .addAction(new Notification.Action.Builder(null, "Speak now", now).build())
                    .addAction(new Notification.Action.Builder(null, "Later", later).build())
                    .setDeleteIntent(later);
            nm.notify(CARD_ID, b.build());
        } catch (Throwable t) {
            Log.w(TAG, "card: " + t);
        }
    }

    private static void cancelCard() {
        Context c = appContext;
        if (c == null) return;
        NotificationManager nm =
                (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(CARD_ID);
    }

    private static void note(String line) {
        if (line.equals(last)) return;
        last = line;
        Log.i(TAG, line);
    }
}
