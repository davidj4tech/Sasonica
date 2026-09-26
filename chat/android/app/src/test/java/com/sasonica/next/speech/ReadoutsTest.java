// SPDX-License-Identifier: Apache-2.0
package com.sasonica.next.speech;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * The readouts answer the lines agent-media's readers parse — call_guard's
 * {@code /mic}, ringer.py's {@code /ringer}, and the {@code /state} keys
 * {@code media doctor} reads — the same as the old app did on 8772.
 */
public class ReadoutsTest {
    private Readouts server;
    private String rate = "";

    @Before
    public void up() throws Exception {
        server = new Readouts(0, new Readouts.Source() {
            @Override public String mic() { return "1 n=3 talking mic=com.google.android.tts"; }
            @Override public String ringer() { return "silent dnd=priority granted=1"; }
            @Override public String holds() { return "mic: quiet"; }
            @Override public int dictationHolds1h() { return 13; }
            @Override public String dictationRate() { return rate; }
        });
        server.start();
    }

    @After
    public void down() {
        server.stop();
    }

    private String[] get(String target) throws Exception {
        try (Socket s = new Socket("127.0.0.1", server.boundPort())) {
            OutputStream out = s.getOutputStream();
            out.write(("GET " + target + " HTTP/1.0\r\nHost: x\r\n\r\n")
                    .getBytes(StandardCharsets.UTF_8));
            out.flush();
            InputStream in = s.getInputStream();
            String all = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            int split = all.indexOf("\r\n\r\n");
            return new String[] {all.substring(0, split), all.substring(split + 4)};
        }
    }

    @Test
    public void micAndRingerAreTheirLines() throws Exception {
        String[] mic = get("/mic");
        assertTrue(mic[0].startsWith("HTTP/1.0 200"));
        assertEquals("1 n=3 talking mic=com.google.android.tts\n", mic[1]);
        assertEquals("silent dnd=priority granted=1\n", get("/ringer?x=1")[1]);
    }

    @Test
    public void stateCarriesTheDoctorsKeys() throws Exception {
        Map<String, Object> state = Json.parseObject(get("/state")[1]);
        assertEquals(13, (int) Json.asDouble(state.get("dictation_holds_1h"), -1));
        assertEquals("mic: quiet", state.get("holds"));
        assertFalse("no problem, no key", state.containsKey("dictation_rate"));

        rate = "13 holds in an hour";
        state = Json.parseObject(get("/")[1]);
        assertEquals("13 holds in an hour", state.get("dictation_rate"));
    }

    @Test
    public void anythingElseIsNotFound() throws Exception {
        assertTrue(get("/play")[0].startsWith("HTTP/1.0 404"));
    }
}
