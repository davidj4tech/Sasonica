// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * What NotifyService posts, decided from two session lists (plain Java, no
 * Android: unit-tested in NotifyRulesTest).
 *
 * Each `sessions` frame of GET /sessions/events (server-contract.md §6.13) is
 * the whole list of live sessions with their state. Compared with the last
 * list held:
 *
 * - into `approval` (a question or a permission prompt)  → "Needs you" (urgent)
 * - `working` → `waiting` (a turn ended)                  → "New reply"
 * - out of `approval` any other way, or gone while in it   → cancel that
 *   thread's notification (answered or dismissed elsewhere: nothing waits)
 *
 * The first list ever is the baseline, not news. A reconnect is NOT a new
 * baseline: the last list is kept across reconnects, so a turn that ended
 * while the connection was down is still told once it is back.
 *
 * While the app is on screen nothing is posted (the app shows its own
 * in-app notice, lib/arrivals.ts); the list is still taken in, so going to
 * the background later does not replay what was seen. Cancels still apply.
 *
 * Mirrors the rules of lib/arrivals.ts noteStates(), which does the same in
 * the WebView while it runs.
 */
final class NotifyRules {
    static final String WORKING = "working";
    static final String WAITING = "waiting";
    static final String APPROVAL = "approval";

    /** One row of the stream. */
    static final class Row {
        final String session;
        final String title;
        final String state;

        Row(String session, String title, String state) {
            this.session = session;
            this.title = title == null ? "" : title;
            this.state = state == null ? WAITING : state;
        }
    }

    /** Something to do: post (urgent or not) or cancel one thread's notification. */
    static final class Action {
        enum Kind { REPLY, NEEDS_YOU, CANCEL }

        final Kind kind;
        final String session;
        final String title;

        Action(Kind kind, String session, String title) {
            this.kind = kind;
            this.session = session;
            this.title = title;
        }

        /** "New reply · <title>" / "Needs you · <title>"; the id's first 8 when untitled. */
        String heading() {
            String name = title == null || title.isEmpty()
                ? (session.length() > 8 ? session.substring(0, 8) : session)
                : title;
            return (kind == Kind.NEEDS_YOU ? "Needs you" : "New reply") + " · " + name;
        }

        @Override
        public String toString() {
            return kind + ":" + session;
        }
    }

    private Map<String, String> last = null;

    /** Forget the baseline (a different server or device was paired). */
    void reset() {
        last = null;
    }

    /** Take in a new list; what to post or cancel because of it. */
    List<Action> next(List<Row> rows, boolean appOnScreen) {
        List<Action> out = new ArrayList<>();
        Map<String, String> now = new HashMap<>();
        for (Row r : rows) now.put(r.session, r.state);
        Map<String, String> prev = last;
        last = now;
        if (prev == null) return out;
        for (Row r : rows) {
            String was = prev.get(r.session);
            if (APPROVAL.equals(r.state)) {
                if (!APPROVAL.equals(was) && !appOnScreen) out.add(new Action(Action.Kind.NEEDS_YOU, r.session, r.title));
            } else if (WAITING.equals(r.state) && WORKING.equals(was)) {
                if (!appOnScreen) out.add(new Action(Action.Kind.REPLY, r.session, r.title));
            } else if (APPROVAL.equals(was)) {
                out.add(new Action(Action.Kind.CANCEL, r.session, r.title));
            }
        }
        for (Map.Entry<String, String> e : prev.entrySet()) {
            if (!now.containsKey(e.getKey()) && APPROVAL.equals(e.getValue())) {
                out.add(new Action(Action.Kind.CANCEL, e.getKey(), ""));
            }
        }
        return out;
    }
}
