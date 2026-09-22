package com.sasonica.next;

import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(OutputSwitcherPlugin.class);
        registerPlugin(AssistPlugin.class);
        registerPlugin(SpeechInputPlugin.class);
        super.onCreate(savedInstanceState);
        fitWebViewToBarsAndKeyboard();
        backClosesMenusFirst();
    }

    /**
     * Back (the gesture or the button) asks the page first: an open menu or
     * sheet closes and nothing else happens (David, 22 Sep 2026). The page
     * answers through window.__sasonicaBack() (chat/app/lib/layers.ts), true
     * when it closed one. Otherwise back is the WebView's history — the
     * screen you came from — and, with none left, leaving the app as before.
     * Without this, Capacitor (no App plugin) finished the activity on every
     * back press, whatever was on screen.
     */
    private void backClosesMenusFirst() {
        OnBackPressedCallback cb = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge().getWebView();
                web.evaluateJavascript(
                    "(function(){try{return !!(window.__sasonicaBack&&window.__sasonicaBack())}catch(e){return false}})()",
                    closed -> {
                        if ("true".equals(closed)) return;
                        if (web.canGoBack()) {
                            web.goBack();
                            return;
                        }
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    });
            }
        };
        getOnBackPressedDispatcher().addCallback(this, cb);
    }

    /**
     * The WebView sits clear of the system bars AND the soft keyboard.
     *
     * targetSdk 35 draws edge to edge, and there adjustResize no longer
     * shrinks the window for the keyboard: the app has to read the IME inset
     * itself. Capacitor's own adjustMarginsForEdgeToEdge pads for the bars
     * only and consumes the insets, so the keyboard covered the composer
     * (David, 22 Sep 2026: "I can't see it at all with the touch keyboard on
     * the screen"). Here the bottom margin is the larger of the navigation
     * bar and the keyboard, so the WebView itself gets shorter while the
     * keyboard is up — the page (100dvh / visualViewport) follows, and the
     * composer rides just above the keys. The insets are consumed, so the
     * page's env(safe-area-inset-*) are 0 and nothing is counted twice.
     * capacitor.config.ts turns Capacitor's handler off (this replaces it).
     */
    private void fitWebViewToBarsAndKeyboard() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WebView web = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            int bottom = Math.max(bars.bottom, ime.bottom);
            if (mlp.leftMargin != bars.left || mlp.topMargin != bars.top || mlp.rightMargin != bars.right || mlp.bottomMargin != bottom) {
                mlp.leftMargin = bars.left;
                mlp.topMargin = bars.top;
                mlp.rightMargin = bars.right;
                mlp.bottomMargin = bottom;
                v.setLayoutParams(mlp);
            }
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(web);
    }
}
