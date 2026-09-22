// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

/**
 * NotifyService's retry timing (plain Java; BackoffTest).
 *
 * Doubling from `base` to `cap`, with up to a quarter of jitter taken off so
 * a server restart is not met by every client at once. After `giveUpMs` of
 * failing without one good connection it says to give up: the service then
 * stops trying and waits for a network change or the app being opened —
 * no timer, nothing to wake the phone.
 */
final class Backoff {
    private final long baseMs;
    private final long capMs;
    private final long giveUpMs;
    private int failures = 0;
    private long failingSince = 0;

    Backoff(long baseMs, long capMs, long giveUpMs) {
        this.baseMs = baseMs;
        this.capMs = capMs;
        this.giveUpMs = giveUpMs;
    }

    /** A connection got through (its first frame arrived). */
    void success() {
        failures = 0;
        failingSince = 0;
    }

    /** A failed attempt at `nowMs`; the wait before the next, before jitter. */
    long failure(long nowMs) {
        if (failingSince == 0) failingSince = nowMs;
        failures++;
        long d = baseMs;
        for (int i = 1; i < failures && d < capMs; i++) d *= 2;
        return Math.min(d, capMs);
    }

    /** `delay` with up to 25% taken off; `unit` in [0, 1). */
    static long jitter(long delay, double unit) {
        return delay - (long) (delay * 0.25 * unit);
    }

    /** Failing for longer than `giveUpMs` without a good connection. */
    boolean givenUp(long nowMs) {
        return failingSince != 0 && nowMs - failingSince >= giveUpMs;
    }

    int failures() {
        return failures;
    }
}
