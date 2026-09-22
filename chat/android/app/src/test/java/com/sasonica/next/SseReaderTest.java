// SPDX-License-Identifier: Apache-2.0
package com.sasonica.next;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class SseReaderTest {
    @Test
    public void readsNamedFramesAndSkipsTheRest() {
        SseReader r = new SseReader();
        assertNull(r.line("retry: 5000"));
        assertNull(r.line(""));
        assertNull(r.line("id: 1"));
        assertNull(r.line("event: sessions"));
        assertNull(r.line("data: {\"sessions\":[]}"));
        SseReader.Frame f = r.line("");
        assertEquals("sessions", f.event);
        assertEquals("{\"sessions\":[]}", f.data);
    }

    @Test
    public void unnamedIsMessageAndDataLinesJoin() {
        SseReader r = new SseReader();
        r.line(": a comment");
        r.line("data: one");
        r.line("data:two");
        SseReader.Frame f = r.line("");
        assertEquals("message", f.event);
        assertEquals("one\ntwo", f.data);
    }

    @Test
    public void anEventWithoutDataIsDropped() {
        SseReader r = new SseReader();
        r.line("event: ping");
        assertNull(r.line(""));
        r.line("data: x");
        assertEquals("message", r.line("").event);
    }
}
