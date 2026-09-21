package com.audiobookshelf.app.speech;

import android.content.Context;
import android.media.AudioManager;
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
 * mid-dictation would otherwise start talking over it. The companion's
 * notification cards ("Sam has something to say") did not come across yet.
 * Fork-only file.
 */
public final class SasonicaHolds {
    private static final String TAG = "SasonicaHolds";
    private static final long TICK_MS = 500;

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
    private static volatile Book book;
    private static boolean heldForSession;
    private static boolean urgentForSession;
    private static String last = "";

    private SasonicaHolds() { }

    public static void onBook(Book b) { book = b; }

    public static synchronized void start(Context context) {
        if (main != null) return;
        main = new Handler(Looper.getMainLooper());
        audio = (AudioManager) context.getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
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
        boolean session = bargeIn.voiceSession();

        // A voice session: hold every reply until it is over.
        if (session) {
            if (s != null && "urgent".equals(s.priority)) urgentForSession = true;
            if (!urgentForSession && replying) {
                if (!heldForSession) note("holding speech for a voice session");
                heldForSession = true;
                if (audible) SasonicaSpeech.pause(true);
            }
        } else {
            urgentForSession = false;
            if (heldForSession) {
                heldForSession = false;
                note("voice session over, speech carries on");
                SasonicaSpeech.pause(false);
            }
        }

        // Dictation: quiet, short, and it gives up on its own.
        boolean micOpen = mic != null && mic.active();
        DictationHold.Action d = dictation.onState(micOpen, bargeIn.conversationMic(), audible, now);
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
            BookHold.Action a = bookHold.onState(session, b.audible(), inCall, now);
            if (a == BookHold.Action.PAUSE) {
                note("book paused for a voice session");
                b.pause();
            } else if (a == BookHold.Action.RESUME) {
                note("book resumed after the voice session");
                b.resume();
            }
        }
    }

    private static void note(String line) {
        if (line.equals(last)) return;
        last = line;
        Log.i(TAG, line);
    }
}
