// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code. The protocol it
// sits behind (MpvServer, Json, ClipCache) came from agent-media's companion
// app, Apache-2.0 there too.
package com.sasonica.next.speech;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * agent-media's speech, played by Media3 inside this app.
 *
 * <h4>Why Media3 and not the MediaPlayer this replaces</h4>
 *
 * The old Sasonica app plays speech with {@code android.media.MediaPlayer},
 * because the companion it came from had no Gradle build and therefore no
 * AndroidX at all. Next has one, so the reason is gone (David, 23 Sep 2026).
 * What Media3 gives back is the two hardest parts of the old player as library
 * code: a playlist that joins clips without a gap, instead of a hand-rolled
 * {@code setNextMediaPlayer} handoff with a documented way of refusing; and
 * audio focus handled by the player that is making the sound.
 *
 * <h4>Fetch, then play — still</h4>
 *
 * The spike that chose the old player measured HTTP {@code prepare()} at
 * 8.5–9.8 seconds against red5's clip server and 44–78 ms from a local file. A
 * reply is many short clips, so clips are downloaded to the cache and played
 * from disk, one fetched while the last one plays. Media3 buffers better than
 * MediaPlayer did, but the tailnet link is the same link and a local file
 * cannot rebuffer mid-sentence.
 *
 * <h4>The window</h4>
 *
 * The playlist the server sees is a list of URLs, and it may be queued long
 * before any of it is on the device. ExoPlayer is given only what is local:
 * the clip being played and the next one, appended as it lands. {@link #base}
 * is the playlist index of ExoPlayer's item 0, which is what turns an
 * ExoPlayer item transition back into the {@code playlist-pos} the coordinator
 * follows a reply by.
 *
 * <h4>Focus, deliberately taken</h4>
 *
 * The old app's speech player never asks for audio focus, because that app
 * already has a focus owner and the two competed at about five requests a
 * second. Next has one player and no focus owner of its own, so the honest
 * thing is also the simple one: {@code setAudioAttributes(…, true)} and let
 * Media3 duck and pause against other apps — including, while the two run side
 * by side, the old app's book.
 *
 * <h4>Threading</h4>
 *
 * ExoPlayer must be touched on the one thread it was built on. Commands
 * arrive on socket threads, so everything hops to {@link #player}'s looper;
 * the protocol's getters block briefly on it ({@link #ask}) rather than read
 * a mirror, because {@code time-pos} is arithmetic the server does.
 */
final class Media3Speech implements MpvServer.Player {

    interface Log {
        void line(String text);
    }

    /** How long a finished reply still counts as this player's. */
    private static final long PARKED_MS = 10 * 60 * 1000;

    /** Long enough for a player call, short enough not to stall the socket. */
    private static final long ASK_MS = 500;

    private final Context context;
    private final Log log;
    private final ClipCache clips;

    private final HandlerThread thread;
    private final Handler handler;
    private volatile ExoPlayer player;

    /** Two at a time: enough to stay ahead, few enough not to fight the clip
     *  that is playing for a share of a slow tailnet link. */
    private final ExecutorService fetcher = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "speech-fetch");
        t.setDaemon(true);
        return t;
    });

    /** The reply, as the server queued it: URLs, not files. Guarded by this. */
    private final List<String> playlist = new ArrayList<String>();
    private volatile int pos = -1;
    /** The playlist index of ExoPlayer's item 0. Player thread only. */
    private int base = -1;
    /** The last playlist index handed to ExoPlayer. Player thread only. */
    private int queued = -1;

    private volatile boolean paused;
    private volatile boolean muted;
    private volatile double volume = 100;
    private volatile double speed = 1.0;
    private volatile boolean ended;
    private volatile long lastCommandAt;

    private volatile MpvServer server;

    Media3Speech(Context context, Log log) {
        this.context = context.getApplicationContext();
        this.log = log;
        this.clips = new ClipCache(new File(this.context.getCacheDir(), "speech"));
        this.thread = new HandlerThread("speech-player");
        this.thread.start();
        this.handler = new Handler(thread.getLooper());
        run(this::build);
    }

    void attach(MpvServer server) {
        this.server = server;
    }

    /**
     * Is this player the one making noise right now?
     *
     * Not "is something open": between two replies nothing is, and between two
     * clips the answer must still be yes or the channel is handed back to
     * whatever else claims it. A reply that has finished stays ours for
     * {@link #PARKED_MS}, which is what stops a player nobody will send
     * another command to from claiming the channel for ever.
     */
    boolean active() {
        if (!idle()) return true;
        if (pos < 0 || playlistCount() == 0) return false;
        return System.currentTimeMillis() - lastCommandAt < PARKED_MS;
    }

    void release() {
        run(() -> {
            ExoPlayer p = player;
            player = null;
            if (p != null) p.release();
        });
        thread.quitSafely();
        fetcher.shutdownNow();
    }

    // ---- the player thread -------------------------------------------------

    private void build() {
        ExoPlayer p = new ExoPlayer.Builder(context)
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                        .build(), /* handleAudioFocus= */ true)
                .setLooper(thread.getLooper())
                .build();
        p.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(MediaItem item, int reason) {
                // A clip ended and the next began. mpv volunteers this, and the
                // coordinator follows a reply by it — a player that only
                // answered when asked would break the highlighting while
                // looking correct.
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO
                        || reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK) {
                    int now = base + exo().getCurrentMediaItemIndex();
                    if (now != pos) {
                        pos = now;
                        volunteer("playlist-pos");
                    }
                    queueAhead();
                }
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state != Player.STATE_ENDED) return;
                if (restarting) {
                    // Our own doing: an empty timeline ends playback, so
                    // clearMediaItems() on the way into the next clip arrives
                    // here looking exactly like the end of a reply. Believing
                    // it took the follow-along and the player card off the
                    // screen at the start of the last clip, while the audio
                    // played happily on (David, 23 Sep 2026: "follow along
                    // disappeared and so did the player before it finished
                    // speaking... the audio finished okay though").
                    return;
                }
                // ExoPlayer ran off the end of what it had. Either the reply
                // is over, or a clip we have not fetched yet is next — in
                // which case restarting at it is how it gets fetched.
                if (pos + 1 < playlistCount()) {
                    startAt(pos + 1);
                    return;
                }
                ended = true;
                volunteer("idle-active");
            }

            @Override
            public void onPlayerError(PlaybackException e) {
                // One clip failing must not strand the rest of the reply: the
                // sentence is lost, the paragraph continues.
                log.line("speech: clip failed (" + e.getErrorCodeName() + "), skipping");
                int next = pos + 1;
                if (next < playlistCount()) {
                    startAt(next);
                } else {
                    ended = true;
                    volunteer("idle-active");
                }
            }
        });
        p.setPlaybackParameters(new PlaybackParameters((float) speed, 1.0f));
        p.setVolume(gain());
        player = p;
    }

    private ExoPlayer exo() {
        return player;
    }

    /**
     * Start the reply at {@code index}, rebuilding ExoPlayer's window.
     *
     * The clip is fetched off the player thread and the item set when it
     * lands: a warmed clip is a cache hit and one thread hop, and a cold one
     * does not hold up the commands queued behind it — the sink sends pause,
     * mute and playlist-pos as a batch. {@link #generation} is what stops a
     * fetch that was overtaken by the next reply from playing into it.
     */
    private void startAt(int index) {
        ExoPlayer p = exo();
        if (p == null) return;
        String uri = at(index);
        if (uri == null) return;
        pos = index;
        ended = false;
        base = index;
        queued = index;
        final int mine = ++generation;
        // Between here and the new clip being set, ExoPlayer's own state is
        // not evidence about the reply: see onPlaybackStateChanged.
        restarting = true;
        p.clearMediaItems();
        volunteer("playlist-pos");
        fetcher.execute(() -> {
            File file;
            try {
                file = local(uri);
            } catch (Exception e) {
                log.line("speech: " + uri + " failed: " + e);
                run(() -> {
                    if (mine != generation) return;
                    restarting = false;
                    if (index + 1 < playlistCount()) {
                        startAt(index + 1);
                    } else {
                        ended = true;
                        volunteer("idle-active");
                    }
                });
                return;
            }
            final File ready = file;
            run(() -> {
                ExoPlayer on = exo();
                if (on == null || mine != generation) return;
                restarting = false;
                on.setMediaItem(MediaItem.fromUri(Uri.fromFile(ready)));
                on.prepare();
                on.setPlayWhenReady(!paused);
                queueAhead();
            });
        });
    }

    /** Bumped by every start; an overtaken fetch drops itself. Player thread. */
    private int generation;

    /**
     * A "read from here" for a sentence the player has not been handed yet,
     * or -1. Applied by the append that makes it real. Player thread.
     */
    private int pending = -1;

    /**
     * Clearing the playlist, on the way into another clip. Player thread.
     *
     * ExoPlayer ends playback when its timeline empties, and it says so the
     * same way it says a reply is over. Everything between the clear and the
     * next clip being set is therefore ours, not news.
     */
    private volatile boolean restarting;

    /**
     * Keep one clip queued behind the one playing, fetching it first.
     *
     * The fetch happens off the player thread — a slow clip must not stall the
     * socket — and the append hops back.
     */
    private void queueAhead() {
        final int index = pos + 1;
        if (index <= queued || index >= playlistCount()) return;
        final String uri = at(index);
        if (uri == null) return;
        queued = index;
        fetcher.execute(() -> {
            final File file;
            try {
                file = local(uri);
            } catch (Exception e) {
                log.line("speech: fetching " + uri + " failed: " + e);
                run(() -> {
                    // Let it be tried again rather than leaving a hole: the
                    // ENDED handler restarts at the clip that is missing.
                    if (queued == index) queued = index - 1;
                });
                return;
            }
            run(() -> {
                ExoPlayer p = exo();
                // The playlist may have moved on while this was fetching — a
                // new reply replaces everything — in which case this clip is
                // already history and must not be queued behind anything.
                if (p == null || queued != index || index != pos + 1) return;
                p.addMediaItem(MediaItem.fromUri(Uri.fromFile(file)));
            });
        });
    }

    private float gain() {
        return muted ? 0f : (float) Math.max(0, Math.min(100, volume)) / 100f;
    }

    private void volunteer(String property) {
        MpvServer s = server;
        if (s != null) s.changed(property);
    }

    // ---- the playlist ------------------------------------------------------

    @Override
    public void load(String uri, String mode) {
        lastCommandAt = System.currentTimeMillis();
        if ("replace".equals(mode)) {
            synchronized (this) {
                playlist.clear();
                playlist.add(uri);
            }
            run(() -> {
                pending = -1;
                startAt(0);
            });
            return;
        }
        // append does NOT auto-play, and the sink depends on that: it builds a
        // whole reply into an idle player before jumping to index 0, because a
        // first clip that started early could end before the rest were queued.
        synchronized (this) {
            playlist.add(uri);
        }
        // That batch is the earliest this device can know the whole reply, so
        // start fetching all of it now rather than one clip ahead: every
        // sentence after the first becomes a local file while the first plays.
        warm(uri);
        volunteer("playlist-count");
        run(() -> {
            if (pending >= 0 && pending < playlistCount()) {
                // The sentence someone asked for has arrived.
                int go = pending;
                pending = -1;
                startAt(go);
                return;
            }
            queueAhead();
        });
    }

    @Override
    public void playlistClear() {
        String current;
        synchronized (this) {
            current = at(pos);
            playlist.clear();
            if (current != null) playlist.add(current);
        }
        run(() -> {
            if (current == null) {
                pos = -1;
                base = -1;
                queued = -1;
                ExoPlayer p = exo();
                if (p != null) p.clearMediaItems();
            } else {
                // The clip keeps playing; only its index moves to 0.
                pos = 0;
                base = 0;
                queued = 0;
                ExoPlayer p = exo();
                if (p != null && p.getMediaItemCount() > 1) {
                    p.removeMediaItems(1, p.getMediaItemCount());
                }
            }
            volunteer("playlist-count");
        });
    }

    @Override
    public void stop() {
        synchronized (this) {
            playlist.clear();
        }
        run(() -> {
            pos = -1;
            base = -1;
            queued = -1;
            generation++;    // a clip still being fetched is no longer wanted
            pending = -1;
            restarting = false;  // this clear IS the end, and may be reported
            ended = false;   // idle by the empty-playlist half of the test
            ExoPlayer p = exo();
            if (p != null) {
                p.stop();
                p.clearMediaItems();
            }
            volunteer("playlist-pos");
            volunteer("idle-active");
        });
    }

    @Override
    public void playlistPos(int index) {
        lastCommandAt = System.currentTimeMillis();
        run(() -> {
            if (index >= 0 && index >= playlistCount()) {
                // A sentence that has not been rendered yet.
                //
                // "Read from here" on a reply still streaming in names a clip
                // the player has not been handed: the sink appends them as
                // they render, so the tapped index routinely runs ahead of
                // the list. Stopping the player for it — which is what this
                // used to do — silenced a reply because someone asked to hear
                // a later part of it. Remember it instead, and go there when
                // it arrives; until then the reply carries on where it is.
                pending = index;
                log.line("speech: read from here at " + index
                        + ", which has not arrived yet; waiting for it");
                return;
            }
            if (index < 0) {
                pos = index;
                base = -1;
                queued = -1;
                pending = -1;
                generation++;
                ExoPlayer p = exo();
                if (p != null) {
                    p.stop();
                    p.clearMediaItems();
                }
                volunteer("playlist-pos");
                return;
            }
            pending = -1;
            startAt(index);
        });
    }

    @Override
    public void playlistNext() {
        run(() -> {
            if (pos + 1 < playlistCount()) {
                startAt(pos + 1);
            } else {
                ended = true;
                ExoPlayer p = exo();
                if (p != null) p.stop();
                volunteer("idle-active");
                volunteer("playlist-pos");
            }
        });
    }

    @Override
    public void playlistPrev() {
        run(() -> {
            if (pos > 0) startAt(pos - 1);
        });
    }

    // ---- playback ----------------------------------------------------------

    @Override
    public void seek(double seconds) {
        lastCommandAt = System.currentTimeMillis();
        run(() -> {
            ExoPlayer p = exo();
            if (p == null || pos < 0) return;
            long dur = p.getDuration();
            if (dur != C.TIME_UNSET && seconds * 1000 >= dur) {
                // Running into the end and being sent to it are the same
                // event: `>` seeks to 100% to make the reply move on, and a
                // playhead parked at the end would finish nothing.
                playlistNext();
                return;
            }
            p.seekTo(Math.round(Math.max(0, seconds) * 1000));
            volunteer("time-pos");
        });
    }

    @Override
    public void pause(boolean wanted) {
        lastCommandAt = System.currentTimeMillis();
        paused = wanted;
        run(() -> {
            ExoPlayer p = exo();
            if (p != null) p.setPlayWhenReady(!paused);
            volunteer("pause");
        });
    }

    @Override
    public void mute(boolean wanted) {
        muted = wanted;
        run(() -> {
            ExoPlayer p = exo();
            if (p != null) p.setVolume(gain());
            volunteer("mute");
        });
    }

    @Override
    public void volume(double wanted) {
        volume = wanted;
        run(() -> {
            ExoPlayer p = exo();
            if (p != null) p.setVolume(gain());
            volunteer("volume");
        });
    }

    @Override
    public void speed(double wanted) {
        speed = wanted <= 0 ? 1.0 : wanted;
        run(() -> {
            ExoPlayer p = exo();
            // Pitch held at 1.0. Media3 resamples with Sonic, which is the
            // same algorithm mpv's scaletempo2 is, and unlike the pinned
            // filter that ate 1.6× it is not configured anywhere else.
            if (p != null) p.setPlaybackParameters(
                    new PlaybackParameters((float) speed, 1.0f));
            volunteer("speed");
        });
    }

    // ---- what the protocol asks --------------------------------------------

    @Override public boolean paused() { return paused; }
    @Override public boolean muted() { return muted; }
    @Override public double volume() { return volume; }
    @Override public double speed() { return speed; }
    @Override public int playlistPos() { return pos; }

    @Override
    public synchronized int playlistCount() {
        return playlist.size();
    }

    @Override
    public String path() {
        return at(pos);
    }

    @Override
    public double timePos() {
        return ask(() -> {
            ExoPlayer p = exo();
            if (p == null || pos < 0) return -1.0;
            long ms = p.getCurrentPosition();
            return ms < 0 ? -1.0 : ms / 1000.0;
        }, -1.0);
    }

    @Override
    public double duration() {
        return ask(() -> {
            ExoPlayer p = exo();
            if (p == null) return -1.0;
            long ms = p.getDuration();
            return ms == C.TIME_UNSET ? -1.0 : ms / 1000.0;
        }, -1.0);
    }

    /**
     * Nothing playing and nothing left to play.
     *
     * Not "no player": the coordinator ends its follow when this says yes, and
     * a gap between two sentences is not the end of a reply. The {@code ended}
     * flag is what the old player learned to keep — without it a finished reply
     * reported "not idle" for ever, and the coordinator held the global speech
     * token for the whole of it.
     */
    @Override
    public boolean idle() {
        return ended || (pos < 0 && playlistCount() == 0);
    }

    // ---- helpers -----------------------------------------------------------

    private synchronized String at(int index) {
        return index >= 0 && index < playlist.size() ? playlist.get(index) : null;
    }

    /**
     * The clip as a file on this device, fetching it if it is a URL.
     *
     * A {@code file://} or bare path is used where it lies — the server may
     * have pre-staged the whole reply, and copying it again would be work for
     * nothing.
     */
    private File local(String uri) throws Exception {
        if (uri.startsWith("http://") || uri.startsWith("https://")) {
            return clips.fetch(uri);
        }
        return new File(uri.startsWith("file://") ? uri.substring(7) : uri);
    }

    /** Fetch in the background, once, and never complain: this is a warmup. */
    private void warm(String uri) {
        if (!uri.startsWith("http")) return;
        fetcher.execute(() -> {
            try {
                clips.fetch(uri);
            } catch (Exception e) {
                // Its turn will come, and the failure is reported there, where
                // there is a sentence waiting on it.
            }
        });
    }

    /** Do it on the player thread, now if we are already there. */
    private void run(Runnable r) {
        if (Looper.myLooper() == thread.getLooper()) {
            r.run();
        } else {
            handler.post(r);
        }
    }

    /** Ask the player thread, and settle for {@code fallback} if it is busy. */
    private <T> T ask(Callable<T> call, T fallback) {
        if (Looper.myLooper() == thread.getLooper()) {
            try {
                return call.call();
            } catch (Exception e) {
                return fallback;
            }
        }
        final BlockingQueue<Object> answer = new ArrayBlockingQueue<Object>(1);
        handler.post(() -> {
            try {
                Object v = call.call();
                answer.offer(v == null ? fallback : v);
            } catch (Exception e) {
                answer.offer(fallback);
            }
        });
        try {
            @SuppressWarnings("unchecked")
            T v = (T) answer.poll(ASK_MS, TimeUnit.MILLISECONDS);
            return v == null ? fallback : v;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return fallback;
        }
    }
}
