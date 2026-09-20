package com.kant.messenger;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Web-layer control over {@link KantConnectionService}.
 *
 * The node lifecycle is owned by JavaScript (useKant), so the service has to be
 * driven from there: started when the node comes up, relabelled as the relay
 * link changes, stopped when the user disconnects. The reverse direction
 * matters too — tapping Stop on the notification has to reach the JS that owns
 * the libp2p node, which is what the {@code stopRequested} event is for.
 */
@CapacitorPlugin(name = "KantConnection")
public class KantConnectionPlugin extends Plugin {

    @Override
    public void load() {
        // The notification's Stop action runs inside the service. Hand it a way
        // back into the bridge so the node is closed properly rather than left
        // to die with the process.
        KantConnectionService.setStopListener(() -> notifyListeners("stopRequested", new JSObject()));
    }

    @Override
    protected void handleOnDestroy() {
        // The bridge is going away; a stale listener would hold a dead WebView.
        KantConnectionService.setStopListener(null);
        super.handleOnDestroy();
    }

    /**
     * Enter the foreground state.
     *
     * Android 12+ forbids starting a foreground service from the background, so
     * this is only safe to call while the app is actually on screen. Rather than
     * throwing, a refusal is reported as {@code started: false} — losing the
     * background connection is a degradation, not a reason to fail node startup.
     */
    @PluginMethod
    public void start(PluginCall call) {
        String status = call.getString("status", "Running in the background");
        JSObject result = new JSObject();
        try {
            KantConnectionService.send(getContext(), KantConnectionService.ACTION_START, status);
            result.put("started", true);
        } catch (Exception e) {
            result.put("started", false);
            result.put("reason", String.valueOf(e.getMessage()));
        }
        call.resolve(result);
    }

    /** Update the notification text without restarting the service. */
    @PluginMethod
    public void updateStatus(PluginCall call) {
        String status = call.getString("status");
        if (status == null) {
            call.reject("status is required");
            return;
        }
        if (KantConnectionService.isRunning()) {
            try {
                KantConnectionService.send(getContext(), KantConnectionService.ACTION_UPDATE, status);
            } catch (Exception ignored) {
                // A dropped label is cosmetic; never let it surface as an error.
            }
        }
        call.resolve();
    }

    /** Leave the foreground state and drop the notification. */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            KantConnectionService.send(getContext(), KantConnectionService.ACTION_STOP, null);
        } catch (Exception ignored) {
            // Already gone.
        }
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", KantConnectionService.isRunning());
        call.resolve(result);
    }

    /**
     * Whether Doze is exempted for this app.
     *
     * A foreground service stops the process being killed, but Doze can still
     * suspend its network access once the screen has been off for a while, which
     * silently drops the relay socket. Only the user can grant the exemption, so
     * the UI needs to know whether to ask.
     */
    @PluginMethod
    public void isBatteryOptimized(PluginCall call) {
        JSObject result = new JSObject();
        boolean optimized = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null) optimized = !pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        } else {
            optimized = false; // Pre-Doze; nothing to exempt.
        }
        result.put("optimized", optimized);
        call.resolve(result);
    }

    /**
     * Open the battery-optimisation settings for this app.
     *
     * Deliberately the settings screen rather than
     * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS' direct dialog: the direct prompt
     * requires a permission that app stores treat as policy-violating, and this
     * route needs no permission and leaves the decision visibly with the user.
     */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:" + getContext().getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open settings: " + e.getMessage());
        }
    }
}
