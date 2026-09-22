// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

/**
 * Server-sent events, one line at a time (plain Java; SseReaderTest). Only
 * what the server sends is handled: `event:`, `data:` (joined with "\n" when
 * repeated), comments, and the blank line that ends a frame. `id:` and
 * `retry:` are ignored — the service keeps its own timing and the server
 * ignores Last-Event-ID.
 */
final class SseReader {
    /** A finished frame. `event` is "message" when unnamed. */
    static final class Frame {
        final String event;
        final String data;

        Frame(String event, String data) {
            this.event = event;
            this.data = data;
        }
    }

    private String event = null;
    private StringBuilder data = null;

    /** Feed one line (without its newline); a frame when the line ended one. */
    Frame line(String line) {
        if (line.isEmpty()) {
            if (data == null) {
                event = null;
                return null;
            }
            Frame f = new Frame(event == null ? "message" : event, data.toString());
            event = null;
            data = null;
            return f;
        }
        if (line.startsWith(":")) return null;
        int colon = line.indexOf(':');
        String field = colon < 0 ? line : line.substring(0, colon);
        String value = colon < 0 ? "" : line.substring(colon + 1);
        if (value.startsWith(" ")) value = value.substring(1);
        if ("event".equals(field)) {
            event = value;
        } else if ("data".equals(field)) {
            if (data == null) data = new StringBuilder(value);
            else data.append('\n').append(value);
        }
        return null;
    }
}
