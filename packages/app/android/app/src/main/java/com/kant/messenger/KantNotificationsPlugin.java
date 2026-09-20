package com.kant.messenger;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Lets the web layer raise a real Android notification.
 *
 * The app used the Web Notifications API for this, which silently does nothing
 * inside an Android WebView: messages arrived and were decrypted, but the user
 * was never told. Notifications therefore only ever appeared via the FCM wake
 * path, which the relay skips whenever it still considers the device reachable
 * — i.e. exactly the common case of the app being backgrounded for a minute.
 *
 * Notification ids are derived from the conversation so a busy chat replaces its
 * own notification instead of stacking one per message.
 *
 * The POST_NOTIFICATIONS permission is owned here rather than left to the push
 * plugin. That plugin only asks once an FCM registration is attempted, which
 * happens after a relay circuit is established — so a user who had not yet
 * connected, or whose circuit was slow, was never asked at all, and every
 * notification this class posts was silently dropped by the system.
 */
@CapacitorPlugin(
    name = "KantNotifications",
    permissions = {
        @Permission(alias = KantNotificationsPlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class KantNotificationsPlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    @PluginMethod
    public void notify(PluginCall call) {
        String title = call.getString("title");
        String body  = call.getString("body");
        if (title == null || body == null) {
            call.reject("title and body are required");
            return;
        }
        String tag = call.getString("tag", title);

        KantNotifications.show(getContext(), tag.hashCode(), title, body);
        call.resolve();
    }

    /** Current POST_NOTIFICATIONS state, without prompting. */
    @PluginMethod
    public void checkPermission(PluginCall call) {
        call.resolve(permissionResult());
    }

    /**
     * Ask for POST_NOTIFICATIONS if it has not been decided yet.
     *
     * Below Android 13 the permission does not exist and notifications are
     * allowed by default, so this resolves as granted without prompting.
     */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(permissionResult());
            return;
        }
        requestPermissionForAlias(NOTIFICATIONS, call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(permissionResult());
    }

    private JSObject permissionResult() {
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED;
        JSObject result = new JSObject();
        result.put("granted", granted);
        // Distinguishes "not asked yet" from "refused", so the UI can offer a
        // route to system settings only when prompting would no longer work.
        result.put("state", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                ? "granted"
                : getPermissionState(NOTIFICATIONS).toString());
        return result;
    }
}
