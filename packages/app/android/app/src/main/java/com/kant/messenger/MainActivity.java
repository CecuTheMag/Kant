package com.kant.messenger;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KantNotificationsPlugin.class);
        registerPlugin(KantConnectionPlugin.class);
        registerPlugin(KantFilesPlugin.class);
        registerPlugin(KantBiometricPlugin.class);
        registerPlugin(KantScreenPlugin.class);
        // Before the first frame, so the recent-apps thumbnail is never taken
        // without it (see KantScreenPlugin).
        KantScreenPlugin.apply(this, KantScreenPlugin.isEnabled(this));
        super.onCreate(savedInstanceState);
    }
}
