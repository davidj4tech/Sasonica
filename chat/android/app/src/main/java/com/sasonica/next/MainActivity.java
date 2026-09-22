package com.sasonica.next;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(OutputSwitcherPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
