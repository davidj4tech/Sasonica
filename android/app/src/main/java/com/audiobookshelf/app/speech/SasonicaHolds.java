package com.audiobookshelf.app.speech;

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
 * Sasonica: speech waits while David is talking to something else.
 *
 * Step 3 of agent-media's companion-into-Sasonica plan. The companion watched
 * the microphone (no permission needed: an app is told what others record)
 * and paused its own speech player, which is not the one that talks any more
 * — so from the switch on 2026-09-19 until this class, dictation, Claude Live
 * and calls no longer quieted a reply. {@link MicWatch}, {@link BargeIn},
 * {@link DictationHold} and {@link BookHold} came across unchanged; this is
 * the part of the companion's service that acted on them, without the parts
 * that only existed because mpv ignored audio focus:
 *
 * <ul>
 *   <li><b>Dictation</b> (the keyboard's mic): speech pauses, silently, and
 *       carries on when the mic closes — {@link DictationHold}, which gives up
 *       after two minutes.</li>
 *   <li><b>A voice session</b> (Claude Live, a call — anything recording as
 *       VOICE_COMMUNICATION): speech is held for the whole session and carries
 *       on after it, the companion's "hold" mode. An urgent reply takes the
 *       room.</li>
 *   <li><b>The book</b> stops for a voice session and comes back after it —
 *       {@link BookHold}, which never resumes after a call.</li>
 * </ul>
 *
 * Pauses are re-asserted on every tick, as the companion did: red5 clears the
 * speech player's pause at the start of each reply, and a reply arriving
 * mid-dictation would otherwise start talking over it.
 *
 * <b>A call counts as a voice session</b> by the phone's own audio mode
 * (ringing, in a call, in a voice chat): a telephony call is not a recording
 * another app is told about, and red5's call guard pauses the Termux players,
 * not this one.
 *
 * <b>The card.</b> While a reply waits out a session, a notification says so,
 * with "Speak now" (for the rest of the session) and "Later" (drop the card,
 * keep waiting) — the companion's, minus its queue nudges.
 *
 * <b>The readouts</b> the companion served on :8770 are here too, for the
 * same readers on the phone: {@link #micLine()} is call_guard's {@code /mic},
 * {@link #ringerLine()} is {@code ringer.py}'s, and the dictation hold rate is
 * what {@code media doctor} asks for. Fork-only file.
 */
public final class SasonicaHolds {
    private static final String TAG = "SasonicaHolds";
    private static final long TICK_MS = 500;
    private static final String CARD_CHANNEL = "sasonica-speech-waiting";
    private static final int CARD_ID = 7874;
    public static final String ACTION_SPEAK_NOW = "com.sasonica.app.SPEAK_NOW";
    public static final String ACTION_LATER = "com.sasonica.app.SPEAK_LATER";

    /** The book, as the book player sees it. Called on the main thread. */
    public interface Book {
        boolean audible();
        void pause();
        void resume();
    }

    private static Handler main;
    private static AudioManager audio;
    private static MicWatch mic;
    private static final BargeIn bargeIn = new BargeIn();
    private static final DictationHold dictation = new DictationHold();
    private static final BookHold bookHold = new BookHold();
    private static final HoldRate dictationRate = new HoldRate();
    private static Context appContext;
    private static boolean speakNow;
    private static volatile Book book;
    private static boolean heldForSession;
    private static boolean urgentForSession;
    private static String last = "";

    private SasonicaHolds() { }

    public static void onBook(Book b) { book = b; }

    public static synchronized void start(Context context) {
        if (main != null) return;
        main = new Handler(Looper.getMainLooper());
        appContext = context.getApplicationContext();
        audio = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
        bargeIn.logTo(line -> Log.i(TAG, line));
        mic = new MicWatch(audio, main, active -> {
            bargeIn.onMic(active, mic.source(), System.currentTimeMillis());
            evaluate();
        });
        mic.start();
        main.postDelayed(tick, TICK_MS);
    }

    public static synchronized void stop() {
        if (main == null) return;
        main.removeCallbacks(tick);
        if (mic != null) mic.stop();
        mic = null;
        main = null;
    }

    // ---- the readouts -----------------------------------------------------

    /** call_guard's {@code /mic}: "1|0 n=<count> <why> <detail>", as the companion wrote it. */
    public static String micLine() {
        MicWatch m = mic;
        if (m == null) return "0 n=0 not watching -";
        long now = System.currentTimeMillis();
        boolean hold = m.active() && bargeIn.holding(now);
        return (hold ? "1" : "0") + " n=" + m.count() + " " + bargeIn.why(now) + " " + m.detail();
    }

    /** ringer.py's {@code /ringer}: the ringer switch and Do Not Disturb, read live. */
    public static String ringerLine() {
        AudioManager a = audio;
        Context c = appContext;
        if (a == null || c == null) return "unknown dnd=unknown granted=0";
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        boolean granted = nm != null && nm.isNotificationPolicyAccessGranted();
        int filter = granted ? nm.getCurrentInterruptionFilter() : RingerState.FILTER_UNKNOWN;
        return RingerState.line(a.getRingerMode(), filter, granted);
    }

    /** Dictation holds in the last hour — `media doctor`'s check that the mic baseline has not come back. */
    public static int dictationHolds1h() { return dictationRate.recent(System.currentTimeMillis()); }

    /** "" or why the hold rate looks like a machine, not a person. */
    public static String dictationRateProblem() { return dictationRate.problem(System.currentTimeMillis()); }

    /** "Speak now" on the card: the rest of this session is not held. */
    public static void speakNow() {
        Handler h = main;
        if (h == null) return;
        h.post(() -> {
            speakNow = true;
            cancelCard();
            note("speak now: releasing the hold for this session");
            SasonicaSpeech.pause(false);
        });
    }

    /** "Later" on the card: the card goes, the hold stays. */
    public static void later() {
        Handler h = main;
        if (h != null) h.post(SasonicaHolds::cancelCard);
    }

    /** One line for /state: what the holds are doing and why. */
    public static String why() {
        long now = System.currentTimeMillis();
        return "mic: " + bargeIn.why(now) + "; dictation: " + dictation.why()
                + "; session: " + (heldForSession ? "holding speech" : urgentForSession ? "urgent, speaking" : "not holding")
                + "; book: " + bookHold.why();
    }

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
        MpvState s = SasonicaSpeech.state();
        boolean audible = s != null && !s.idleActive && !s.paused;
        boolean replying = s != null && (s.speaking || !s.idleActive);
        int mode = audio == null ? AudioManager.MODE_NORMAL : audio.getMode();
        boolean phoneCall = mode == AudioManager.MODE_RINGTONE || mode == AudioManager.MODE_IN_CALL
                || mode == AudioManager.MODE_IN_COMMUNICATION;
        boolean session = bargeIn.voiceSession() || phoneCall;

        // A voice session: hold every reply until it is over.
        if (session) {
            if (s != null && "urgent".equals(s.priority)) urgentForSession = true;
            if (!urgentForSession && !speakNow && replying) {
                if (!heldForSession) {
                    note("holding speech for a voice session" + (phoneCall ? " (the phone is in a call)" : ""));
                    if (s == null || !"low".equals(s.priority)) showCard();
                }
                heldForSession = true;
                if (audible) SasonicaSpeech.pause(true);
            }
        } else {
            urgentForSession = false;
            speakNow = false;
            if (heldForSession) {
                heldForSession = false;
                cancelCard();
                note("voice session over, speech carries on");
                SasonicaSpeech.pause(false);
            }
        }

        // Dictation: quiet, short, and it gives up on its own.
        boolean micOpen = mic != null && mic.active();
        boolean wasDictating = dictation.holding();
        DictationHold.Action d = dictation.onState(micOpen, bargeIn.conversationMic(), audible, now);
        if (dictation.holding() && !wasDictating) dictationRate.engaged(now);
        if (d == DictationHold.Action.PAUSE) {
            SasonicaSpeech.pause(true);
        } else if (d == DictationHold.Action.RESUME && !heldForSession) {
            note("dictation over, speech carries on");
            SasonicaSpeech.pause(false);
        }

        // The book, for a voice session (a reply's own pause is SasonicaSpeechHold's).
        Book b = book;
        if (b != null) {
            boolean inCall = audio != null && audio.getMode() == AudioManager.MODE_IN_CALL;
            BookHold.Action a = bookHold.onState(session, b.audible(), inCall || phoneCall && mode != AudioManager.MODE_IN_COMMUNICATION, now);
            if (a == BookHold.Action.PAUSE) {
                note("book paused for a voice session");
                b.pause();
            } else if (a == BookHold.Action.RESUME) {
                note("book resumed after the voice session");
                b.resume();
            }
        }
    }

    // ---- the card --------------------------------------------------------

    private static void showCard() {
        Context c = appContext;
        if (c == null) return;
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(CARD_CHANNEL, "Speech waiting",
                        NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("A reply is waiting until your call or conversation ends.");
                ch.setSound(null, null);
                nm.createNotificationChannel(ch);
            }
            int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent now = PendingIntent.getBroadcast(c, 1,
                    new Intent(ACTION_SPEAK_NOW).setClass(c, SasonicaSpeechReceiver.class), flags);
            PendingIntent later = PendingIntent.getBroadcast(c, 2,
                    new Intent(ACTION_LATER).setClass(c, SasonicaSpeechReceiver.class), flags);
            android.app.Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new android.app.Notification.Builder(c, CARD_CHANNEL)
                    : new android.app.Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_lock_silent_mode)
                    .setContentTitle("Sam has something to say")
                    .setContentText("Waiting until you are done talking")
                    .setOnlyAlertOnce(true)
                    .addAction(new android.app.Notification.Action.Builder(null, "Speak now", now).build())
                    .addAction(new android.app.Notification.Action.Builder(null, "Later", later).build())
                    .setDeleteIntent(later);
            nm.notify(CARD_ID, b.build());
        } catch (Throwable t) {
            Log.w(TAG, "card: " + t);
        }
    }

    private static void cancelCard() {
        Context c = appContext;
        if (c == null) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(CARD_ID);
    }

    private static void note(String line) {
        if (line.equals(last)) return;
        last = line;
        Log.i(TAG, line);
    }
}
