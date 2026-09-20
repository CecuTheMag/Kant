package com.kant.messenger;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KantNotificationsPlugin.class);
        registerPlugin(KantConnectionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
