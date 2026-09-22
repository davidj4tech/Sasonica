// SPDX-License-Identifier: Apache-2.0
// Written for Sasonica Next; no Audiobookshelf-derived code.
package com.sasonica.next;

import android.content.Intent;
import android.provider.Settings;
import androidx.mediarouter.app.SystemOutputSwitcherDialogController;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens Android's own media output picker (earbuds / speaker / Cast).
 *
 * androidx.mediarouter's SystemOutputSwitcherDialogController picks the
 * right door per version: MediaRouter2.showSystemOutputSwitcher() on 14+,
 * SystemUI's media output dialog on 12-13, the Settings media-output panel
 * on 11. Where none of those exist (10 and older, or an OEM that removed
 * them) it opens Bluetooth settings instead.
 *
 * Speech is played by the OLD app (com.sasonica.app), not this one. For
 * Bluetooth and the phone speaker that does not matter: the active output
 * device is global. A Cast route chosen here would apply to this app only.
 *
 * JS: OutputSwitcher.open() -> {shown: "system" | "bluetooth"}.
 */
@CapacitorPlugin(name = "OutputSwitcher")
public class OutputSwitcherPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        JSObject ret = new JSObject();
        boolean shown = false;
        try {
            shown = SystemOutputSwitcherDialogController.showDialog(getActivity());
        } catch (Exception e) {
            shown = false;
        }
        if (shown) {
            ret.put("shown", "system");
            call.resolve(ret);
            return;
        }
        try {
            Intent bt = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            bt.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(bt);
            ret.put("shown", "bluetooth");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("no output picker on this device", e);
        }
    }
}
