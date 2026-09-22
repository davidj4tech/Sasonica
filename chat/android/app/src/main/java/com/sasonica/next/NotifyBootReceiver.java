// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Starts NotifyService after a reboot, and after the app is updated (a new
 * CI build installed over the last kills the running service) — but only
 * when background notifications are on, permitted and the device is paired
 * (NotifyService.sync decides). Both broadcasts are exempt from Android
 * 12+'s background-start limits for a specialUse service.
 */
public class NotifyBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            NotifyService.sync(ctx);
        }
    }
}
