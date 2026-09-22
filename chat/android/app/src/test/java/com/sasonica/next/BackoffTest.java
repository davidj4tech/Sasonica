// SPDX-License-Identifier: Apache-2.0
package com.sasonica.next;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BackoffTest {
    @Test
    public void doublesToTheCap() {
        Backoff b = new Backoff(2_000, 300_000, 1_800_000);
        long[] want = {2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000};
        for (long w : want) assertEquals(w, b.failure(1));
    }

    @Test
    public void successStartsOver() {
        Backoff b = new Backoff(2_000, 300_000, 1_800_000);
        b.failure(1);
        b.failure(2);
        b.success();
        assertEquals(2_000, b.failure(3));
        assertEquals(1, b.failures());
    }

    @Test
    public void givesUpAfterLongFailingOnly() {
        Backoff b = new Backoff(2_000, 300_000, 1_800_000);
        assertFalse(b.givenUp(10_000_000));
        b.failure(1_000);
        assertFalse(b.givenUp(1_000 + 1_799_999));
        assertTrue(b.givenUp(1_000 + 1_800_000));
        b.success();
        assertFalse(b.givenUp(10_000_000));
    }

    @Test
    public void jitterTakesOffAtMostAQuarter() {
        assertEquals(8_000, Backoff.jitter(8_000, 0.0));
        assertEquals(6_000, Backoff.jitter(8_000, 1.0));
        long mid = Backoff.jitter(8_000, 0.5);
        assertTrue(mid > 6_000 && mid < 8_000);
    }
}
