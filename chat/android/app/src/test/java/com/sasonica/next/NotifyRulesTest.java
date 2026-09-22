// SPDX-License-Identifier: Apache-2.0
package com.sasonica.next;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class NotifyRulesTest {
    private static NotifyRules.Row row(String s, String state) {
        return new NotifyRules.Row(s, "Title " + s, state);
    }

    private static List<NotifyRules.Row> rows(NotifyRules.Row... r) {
        return Arrays.asList(r);
    }

    @Test
    public void theFirstListIsTheBaseline() {
        NotifyRules r = new NotifyRules();
        assertTrue(r.next(rows(row("a", "waiting"), row("b", "approval")), false).isEmpty());
    }

    @Test
    public void aTurnEndingIsANewReply() {
        NotifyRules r = new NotifyRules();
        r.next(rows(row("a", "working")), false);
        List<NotifyRules.Action> got = r.next(rows(row("a", "waiting")), false);
        assertEquals("[REPLY:a]", got.toString());
        assertEquals("New reply · Title a", got.get(0).heading());
    }

    @Test
    public void aDialogIsNeedsYouOnce() {
        NotifyRules r = new NotifyRules();
        r.next(rows(row("a", "working")), false);
        List<NotifyRules.Action> got = r.next(rows(row("a", "approval")), false);
        assertEquals("[NEEDS_YOU:a]", got.toString());
        assertEquals("Needs you · Title a", got.get(0).heading());
        assertTrue(r.next(rows(row("a", "approval")), false).isEmpty());
    }

    @Test
    public void aNewSessionOnADialogIsNeedsYou() {
        NotifyRules r = new NotifyRules();
        r.next(rows(), false);
        assertEquals("[NEEDS_YOU:b]", r.next(rows(row("b", "approval")), false).toString());
    }

    @Test
    public void aNewSessionWaitingIsNotNews() {
        NotifyRules r = new NotifyRules();
        r.next(rows(), false);
        assertTrue(r.next(rows(row("b", "waiting")), false).isEmpty());
    }

    @Test
    public void answeredElsewhereCancelsTheDialog() {
        NotifyRules r = new NotifyRules();
        r.next(rows(row("a", "approval"), row("b", "approval"), row("c", "approval")), false);
        List<NotifyRules.Action> got = r.next(rows(row("a", "working"), row("b", "waiting")), false);
        assertEquals("[CANCEL:a, CANCEL:b, CANCEL:c]", got.toString());
    }

    @Test
    public void nothingIsPostedWhileTheAppIsOnScreen() {
        NotifyRules r = new NotifyRules();
        r.next(rows(row("a", "working"), row("b", "working")), false);
        assertTrue(r.next(rows(row("a", "waiting"), row("b", "approval")), true).isEmpty());
        // ...and going to the background later does not replay it.
        assertTrue(r.next(rows(row("a", "waiting"), row("b", "approval")), false).isEmpty());
    }

    @Test
    public void cancelsStillApplyOnScreen() {
        NotifyRules r = new NotifyRules();
        r.next(rows(row("a", "approval")), false);
        assertEquals("[CANCEL:a]", r.next(rows(row("a", "working")), true).toString());
    }

    @Test
    public void aReconnectIsNotANewBaseline() {
        // The list is kept across reconnects: a turn that ended while the
        // connection was down is told when the next list arrives.
        NotifyRules r = new NotifyRules();
        r.next(rows(row("a", "working")), false);
        assertEquals("[REPLY:a]", r.next(rows(row("a", "waiting")), false).toString());
    }

    @Test
    public void resetStartsAFreshBaseline() {
        NotifyRules r = new NotifyRules();
        r.next(rows(row("a", "working")), false);
        r.reset();
        assertTrue(r.next(rows(row("a", "waiting")), false).isEmpty());
    }

    @Test
    public void anUntitledThreadIsNamedByItsId() {
        NotifyRules.Action a = new NotifyRules.Action(NotifyRules.Action.Kind.REPLY, "0123456789abcdef", "");
        assertEquals("New reply · 01234567", a.heading());
    }
}
