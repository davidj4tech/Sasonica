// SPDX-License-Identifier: Apache-2.0
// From agent-media's companion app (android/companion/test, Apache-2.0),
// ported from its main() harness to JUnit so CI runs it with the rest: the
// assertion helper asserts instead of counting, and main() became one @Test
// running the same checks in the same order.
package com.sasonica.next.speech;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The rate at which the dictation hold fires, and when that rate is the fault.
 *
 * Both traces here are from p8a on 2026-08-20: the recogniser's cycle, which
 * paused Sam every half minute for an hour before anyone worked out it was a
 * microphone, and a day's worth of real dictation, which must never trip it.
 */
public class HoldRateTest {


    @Test
    public void all() throws Exception {
        int failures = 0;
        long t = 1_000_000L;

        // A person. Eight dictations spread over the hour is a talkative day
        // at the keyboard and still says nothing.
        HoldRate r = new HoldRate();
        for (int i = 0; i < 8; i++) r.engaged(t + i * 7L * 60_000L);
        long end = t + 59L * 60_000L;
        failures += check("eight dictations in an hour is a person",
                !r.suspicious(end));
        failures += check("and it says nothing", r.problem(end).isEmpty());

        // The hour that went unreported: 13 engagements, every one of them the
        // recogniser, while David was telling me speech kept stopping. The
        // first threshold sat above this and said nothing.
        r = new HoldRate();
        for (int i = 0; i < 13; i++) r.engaged(t + i * 4L * 60_000L);
        failures += check("the hour David complained through is reported",
                r.suspicious(t + 55L * 60_000L));

        // The recogniser: mic open ~10s every ~40s, around the clock. It
        // crosses the line inside fifteen minutes.
        r = new HoldRate();
        long now = t;
        for (int i = 0; i < 20; i++) {
            r.engaged(now);
            now += 40_000L;
        }
        failures += check("the recogniser's cycle is not a person",
                r.suspicious(now));
        String said = r.problem(now);
        failures += check("and it says so", !said.isEmpty());
        failures += check("naming the app-op, which is what to check",
                said.contains("com.google.android.as"));

        // The window rolls: an hour of quiet after a bad hour is a good hour.
        // Without this, one reverted app-op would flag the phone until restart.
        failures += check("an hour later, with nothing since, it is quiet",
                !r.suspicious(now + HoldRate.WINDOW_MS + 1000));
        failures += check("and the count is zero, not stale",
                r.recent(now + HoldRate.WINDOW_MS + 1000) == 0);

        // The boundary is inclusive, so the threshold means what it says.
        r = new HoldRate();
        for (int i = 0; i < HoldRate.TOO_MANY; i++) r.engaged(t + i * 1000L);
        failures += check("exactly TOO_MANY trips it",
                r.suspicious(t + HoldRate.TOO_MANY * 1000L));
    }

    private static int check(String what, boolean ok) {
        assertTrue(what, ok);
        return 0;
    }
}
