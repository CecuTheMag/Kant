package com.kant.messenger;

import android.app.Activity;
import android.content.Context;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screen security: keeps Kant out of screenshots, screen recordings and the
 * recent-apps preview.
 *
 * Android draws a thumbnail of every app for the recent-apps screen and lets
 * any screen recorder capture the display, so an open conversation is visible
 * outside Kant unless the window carries FLAG_SECURE. The choice is the
 * user's (Settings → Security) and off by default, because it also stops them
 * taking their own screenshots.
 *
 * The preference is stored natively, not in the web layer, so MainActivity can
 * apply it before the first frame is drawn — otherwise the thumbnail taken
 * during startup would still show the previous session's last screen.
 */
@CapacitorPlugin(name = "KantScreen")
public class KantScreenPlugin extends Plugin {

    private static final String PREFS = "kant_screen";
    private static final String KEY_SECURE = "secure";

    /** Whether the user turned screen security on. */
    static boolean isEnabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_SECURE, false);
    }

    /** Set or clear FLAG_SECURE on the activity's window. Call on the UI thread. */
    static void apply(Activity activity, boolean secure) {
        if (secure) {
            activity.getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", isEnabled(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_SECURE, enabled).apply();
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(() -> {
            apply(activity, enabled);
            JSObject result = new JSObject();
            result.put("enabled", enabled);
            call.resolve(result);
        });
    }
}
