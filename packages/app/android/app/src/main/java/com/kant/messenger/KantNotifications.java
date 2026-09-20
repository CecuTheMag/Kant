package com.kant.messenger;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/**
 * Shared notification plumbing.
 *
 * Two different things raise notifications on Android and they must agree on the
 * channel, or the user ends up with two entries in system settings and silencing
 * one does nothing to the other:
 *
 *   • {@link KantMessagingService} — an FCM wake arrived while the app was not
 *     reachable, so all we can say is "something is waiting".
 *   • {@link KantNotificationsPlugin} — the app is running and has already
 *     decrypted a real message, so it can name the sender.
 *
 * Message content only ever reaches here from the second path. The FCM payload
 * never carries plaintext.
 */
final class KantNotifications {

    static final String CHANNEL_ID   = "kant_messages";
    static final String CHANNEL_NAME = "Messages";

    private KantNotifications() {}

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Kant incoming message notifications");
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    /** Tapping any Kant notification reopens the existing task rather than a new one. */
    static PendingIntent contentIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(context, 0, intent, flags);
    }

    static void show(Context context, int id, String title, String body) {
        createChannel(context);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(contentIntent(context));

        NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(id, builder.build());
    }
}
