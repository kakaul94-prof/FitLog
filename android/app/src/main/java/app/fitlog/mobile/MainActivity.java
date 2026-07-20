package app.fitlog.mobile;

import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RestTimerPlugin.class);
        registerPlugin(StepCounterPlugin.class);
        super.onCreate(savedInstanceState);

        // Hardware back button: navigate back within the webview history (the SPA
        // router pushes an entry per navigation) instead of exiting. Registered on
        // the OnBackPressedDispatcher because the deprecated onBackPressed() is no
        // longer invoked on newer Android (targetSdk 36). Exit only at the root.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView().canGoBack()) {
                    bridge.getWebView().goBack();
                } else {
                    finish();
                }
            }
        });
    }
}
