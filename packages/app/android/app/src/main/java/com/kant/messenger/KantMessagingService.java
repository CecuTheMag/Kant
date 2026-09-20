package com.kant.messenger;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * KantMessagingService
 *
 * Signal-style FCM handler. The relay sends an empty wake-up ping — no message
 * content, no sender, nothing. This service receives it, shows a minimal local
 * notification ("New message — tap to open"), and the app reconnects to the
 * relay over the normal libp2p channel when the user taps it.
 *
 * Message content is never in the FCM payload. FCM only carries the wake signal.
 */
public class KantMessagingService extends FirebaseMessagingService {

    private static final int NOTIF_ID = 1001;

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
        if (!"wake".equals(remoteMessage.getData().get("type"))) return;

        // Deliberately vague: the wake ping carries no sender and no content, so
        // this is all we can honestly say. Once the app reconnects and decrypts,
        // KantNotificationsPlugin replaces this with the real sender.
        KantNotifications.show(this, NOTIF_ID, "Kant", "New message — tap to open");
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        PushNotificationsPlugin.onNewToken(token);
    }
}
