// SPDX-License-Identifier: Apache-2.0
// From agent-media's companion app (android/companion/test, Apache-2.0),
// ported from its main() harness to JUnit so CI runs it with the rest.
package com.sasonica.next.speech;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The app answering as mpv, tested with what the server actually sends.
 *
 * The sequences below are lifted from agent-media's {@code sinks/speech.py}
 * rather than invented: a single {@code play} is a loadfile plus the
 * pause/mute reset, and a reply is {@code play_playlist}'s batch — stop,
 * playlist-clear, a loadfile append per sentence, then pause/mute off and
 * playlist-pos 0. If this app is going to sit on that socket, the test that
 * matters is that the real traffic produces the real behaviour; anything else
 * tests a protocol we made up.
 *
 * {@link MpvServer} imports nothing from {@code android.*}, which is what lets
 * this run as a plain JVM test rather than on a device.
 */
public class MpvServerTest {

    private FakePlayer player;
    private MpvServer server;
    private Conn c;

    @Before
    public void start() throws Exception {
        player = new FakePlayer();
        // Port 0: let the OS choose, so a stray mpv or a parallel test run
        // cannot make this fail for a reason that is not about the code.
        server = new MpvServer("127.0.0.1", 0, player, null);
        server.start();
        for (int i = 0; i < 100 && server.boundPort() <= 0; i++) Thread.sleep(10);
        assertTrue("bound", server.boundPort() > 0);
        c = new Conn(server.boundPort());
    }

    @After
    public void stop() throws Exception {
        c.close();
        server.stop();
        for (int i = 0; i < 100 && server.boundPort() != -1; i++) Thread.sleep(10);
        assertEquals("stops", -1, server.boundPort());
    }

    @Test
    public void playsOneClip() throws Exception {
        assertTrue(c.call("{\"command\":[\"loadfile\",\"/tmp/a.mp3\",\"replace\"],"
                + "\"request_id\":1}").contains("\"error\":\"success\""));
        assertEquals("the clip reached the player", "/tmp/a.mp3", player.path());
        assertEquals(1, player.loads.size());
        c.call("{\"command\":[\"set_property\",\"pause\",false],\"request_id\":2}");
        c.call("{\"command\":[\"set_property\",\"mute\",false],\"request_id\":3}");
        assertFalse("pause cleared", player.paused());
        assertFalse("mute cleared", player.muted());
    }

    @Test
    public void queuesAReplyAsOneBatch() throws Exception {
        c.send("{\"command\":[\"set_property\",\"gapless-audio\",\"yes\"],\"request_id\":10}");
        c.send("{\"command\":[\"stop\"],\"request_id\":11}");
        c.send("{\"command\":[\"playlist-clear\"],\"request_id\":12}");
        c.send("{\"command\":[\"loadfile\",\"/tmp/1.mp3\",\"append\"],\"request_id\":13}");
        c.send("{\"command\":[\"loadfile\",\"/tmp/2.mp3\",\"append\"],\"request_id\":14}");
        c.send("{\"command\":[\"set_property\",\"pause\",false],\"request_id\":15}");
        c.send("{\"command\":[\"set_property\",\"playlist-pos\",0],\"request_id\":16}");
        List<String> replies = c.read(7);
        assertEquals("every command in the batch answered", 7, replies.size());
        for (String r : replies) {
            assertTrue("all of them succeeded: " + r, r.contains("\"error\":\"success\""));
        }
        assertEquals("both sentences queued", 2, player.playlistCount());
        assertEquals("and it started at the first", 0, player.playlistPos());

        assertTrue("playlist-pos reads back",
                c.call("{\"command\":[\"get_property\",\"playlist-pos\"],"
                        + "\"request_id\":20}").contains("\"data\":0"));
        assertTrue("idle-active is false while playing",
                c.call("{\"command\":[\"get_property\",\"idle-active\"],"
                        + "\"request_id\":21}").contains("\"data\":false"));
        assertTrue("time-pos answers while playing",
                c.call("{\"command\":[\"get_property\",\"time-pos\"],"
                        + "\"request_id\":22}").contains("\"data\":"));
    }

    @Test
    public void storesTheMetadataTheCardIsBuiltFrom() throws Exception {
        c.call("{\"command\":[\"loadfile\",\"/tmp/a.mp3\",\"replace\"],\"request_id\":1}");
        c.call("{\"command\":[\"set_property\",\"force-media-title\","
                + "\"Sam on the player spike\"],\"request_id\":30}");
        assertTrue("media-title follows force-media-title",
                c.call("{\"command\":[\"get_property\",\"media-title\"],"
                        + "\"request_id\":31}").contains("Sam on the player spike"));
        assertTrue(c.call("{\"command\":[\"set_property\","
                + "\"user-data/agent-media/speaking\",true],\"request_id\":32}")
                .contains("success"));
        assertTrue("the speaking flag is stored",
                server.storedFlag("user-data/agent-media/speaking"));
        assertTrue("and read back",
                c.call("{\"command\":[\"get_property\","
                        + "\"user-data/agent-media/speaking\"],\"request_id\":33}")
                        .contains("\"data\":true"));
    }

    /**
     * Both spellings of pause, because both reach this socket: the CLI writes
     * the value it wants, and an older checkout elsewhere on the fleet still
     * sends mpv's {@code cycle}. This server used to answer {@code cycle} with
     * "invalid parameter" — and the CLI sent it fire-and-forget, so the refusal
     * was never heard and the popup's Space key just did nothing while a reply
     * was being spoken.
     */
    @Test
    public void pauses() throws Exception {
        c.call("{\"command\":[\"set_property\",\"pause\",true],\"request_id\":36}");
        assertTrue("set_property pause holds the clip", player.paused());
        assertTrue("cycle pause is answered, not refused",
                c.call("{\"command\":[\"cycle\",\"pause\"],\"request_id\":37}")
                        .contains("\"error\":\"success\""));
        assertFalse("and it flipped the player", player.paused());
        assertTrue(c.call("{\"command\":[\"cycle\",\"pause\"],\"request_id\":38}")
                .contains("success"));
        assertTrue("cycle flips back", player.paused());
        assertTrue("a property that cannot be cycled says so",
                c.call("{\"command\":[\"cycle\",\"volume\"],\"request_id\":43}")
                        .contains("property not found"));
    }

    /**
     * Seeking, which is {@code <}, {@code >} and the jump keys. The player is
     * handed one number in seconds: mpv's four modes are arithmetic on where we
     * are (1.5 s) and how long the clip is (4 s), and doing that arithmetic in
     * the protocol is what keeps a player from having to know it.
     */
    @Test
    public void seeks() throws Exception {
        c.call("{\"command\":[\"loadfile\",\"/tmp/a.mp3\",\"replace\"],\"request_id\":1}");
        assertTrue(c.call("{\"command\":[\"seek\",5,\"relative\"],\"request_id\":44}")
                .contains("success"));
        assertEquals("a relative seek moves from where we are", 6.5, player.seeked, 0);
        c.call("{\"command\":[\"seek\",0,\"absolute\"],\"request_id\":45}");
        assertEquals("an absolute seek is the number itself", 0.0, player.seeked, 0);
        c.call("{\"command\":[\"seek\",100,\"absolute-percent\"],\"request_id\":46}");
        assertEquals("a percentage is of the clip's length", 4.0, player.seeked, 0);
        c.call("{\"command\":[\"seek\",-1],\"request_id\":47}");
        assertEquals("no flags means relative, as mpv defaults", 0.5, player.seeked, 0);
        c.call("{\"command\":[\"seek\",5,\"relative+exact\"],\"request_id\":48}");
        assertEquals("the exactness modifier is not a different mode",
                6.5, player.seeked, 0);
        assertTrue("a mode we do not know is refused, not guessed",
                c.call("{\"command\":[\"seek\",5,\"chapter\"],\"request_id\":49}")
                        .contains("invalid parameter"));
    }

    @Test
    public void survivesWhatItCannotAnswer() throws Exception {
        assertTrue("unknown property is 'property not found'",
                c.call("{\"command\":[\"set_property\",\"sub-visibility\",false],"
                        + "\"request_id\":40}").contains("property not found"));
        assertTrue("and the connection survives it",
                c.call("{\"command\":[\"get_property\",\"pause\"],\"request_id\":41}")
                        .contains("success"));
        assertTrue(c.call("not json at all").contains("error"));
        assertTrue("so does a malformed line",
                c.call("{\"command\":[\"get_property\",\"pause\"],\"request_id\":42}")
                        .contains("success"));
    }

    /** Observing, which is how a reply is followed sentence by sentence. */
    @Test
    public void volunteersChanges() throws Exception {
        c.send("{\"command\":[\"loadfile\",\"/tmp/1.mp3\",\"append\"],\"request_id\":1}");
        c.send("{\"command\":[\"loadfile\",\"/tmp/2.mp3\",\"append\"],\"request_id\":2}");
        c.send("{\"command\":[\"set_property\",\"playlist-pos\",0],\"request_id\":3}");
        c.read(3);
        assertTrue("observe answers success",
                c.call("{\"command\":[\"observe_property\",7,\"playlist-pos\"],"
                        + "\"request_id\":50}").contains("success"));
        String initial = c.readOne();
        assertTrue("observing sends the current value at once",
                initial.contains("property-change") && initial.contains("\"id\":7"));

        player.advance();
        server.changed("playlist-pos");
        assertTrue("and an advance is volunteered",
                c.readOne().contains("\"data\":1"));

        // A follower is entitled to treat every event as news. The first
        // end-to-end reply sent playlist-pos twice per sentence, because the
        // advance and the next clip's start both announced it.
        server.changed("playlist-pos");
        server.changed("playlist-pos");
        // Nothing may have been sent for those two. The proof is that the next
        // line off the socket is the next real change, not a repeat.
        player.playlistPos(0);
        server.changed("playlist-pos");
        assertTrue("an unchanged value is not repeated",
                c.readOne().contains("\"data\":0"));
    }

    // ---- a player that only remembers what it was told ---------------------

    static final class FakePlayer implements MpvServer.Player {
        final List<String> loads = new ArrayList<String>();
        private final List<String> playlist = new ArrayList<String>();
        private int pos = -1;
        private boolean paused, muted;
        private double volume = 100, speed = 1.0;
        /** Where the last seek landed; NaN until one does. */
        double seeked = Double.NaN;

        void advance() {
            if (pos + 1 < playlist.size()) pos++;
        }

        @Override public void load(String uri, String mode) {
            loads.add(mode + " " + uri);
            if ("replace".equals(mode)) {
                playlist.clear();
                playlist.add(uri);
                pos = 0;
            } else {
                playlist.add(uri);
            }
        }
        @Override public void playlistClear() {
            String current = pos >= 0 && pos < playlist.size() ? playlist.get(pos) : null;
            playlist.clear();
            pos = -1;
            if (current != null) {
                playlist.add(current);
                pos = 0;
            }
        }
        @Override public void stop() {
            playlist.clear();
            pos = -1;
        }
        @Override public void playlistPos(int index) { pos = index; }
        @Override public void playlistNext() { advance(); }
        @Override public void playlistPrev() { if (pos > 0) pos--; }
        @Override public void seek(double seconds) { seeked = seconds; }
        @Override public void pause(boolean p) { paused = p; }
        @Override public void mute(boolean m) { muted = m; }
        @Override public void volume(double v) { volume = v; }
        @Override public void speed(double s) { speed = s; }
        @Override public boolean paused() { return paused; }
        @Override public boolean muted() { return muted; }
        @Override public double volume() { return volume; }
        @Override public double speed() { return speed; }
        @Override public int playlistPos() { return pos; }
        @Override public int playlistCount() { return playlist.size(); }
        @Override public double timePos() { return pos < 0 ? -1 : 1.5; }
        @Override public double duration() { return pos < 0 ? -1 : 4.0; }
        @Override public String path() {
            return pos >= 0 && pos < playlist.size() ? playlist.get(pos) : null;
        }
        @Override public boolean idle() { return pos < 0; }
    }

    // ---- a client that talks the line protocol -----------------------------

    static final class Conn implements AutoCloseable {
        private final Socket socket;
        private final OutputStream out;
        private final BufferedReader in;

        Conn(int port) throws Exception {
            socket = new Socket("127.0.0.1", port);
            socket.setSoTimeout(3000);
            out = socket.getOutputStream();
            in = new BufferedReader(new InputStreamReader(
                    socket.getInputStream(), StandardCharsets.UTF_8));
        }

        void send(String line) throws Exception {
            out.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        }

        String call(String line) throws Exception {
            send(line);
            return in.readLine();
        }

        String readOne() throws Exception {
            return in.readLine();
        }

        List<String> read(int n) throws Exception {
            List<String> lines = new ArrayList<String>();
            for (int i = 0; i < n; i++) lines.add(in.readLine());
            return lines;
        }

        @Override public void close() throws Exception {
            socket.close();
        }
    }
}
