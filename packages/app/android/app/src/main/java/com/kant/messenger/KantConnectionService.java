package com.kant.messenger;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps Kant reachable while the app is not on screen.
 *
 * The libp2p node lives in the WebView's JavaScript context, so it is only alive
 * for as long as the app's process is. Without a foreground service Android is
 * free to freeze or kill a backgrounded process within seconds, which drops the
 * relay WebSocket and the circuit reservation with it — the user goes offline
 * without ever being told, and inbound messages fall back to the FCM wake path
 * that can only say "something arrived".
 *
 * A foreground service is the one documented way to say "this process is doing
 * something the user asked for, leave it running". The ongoing notification is
 * not decoration: Android requires it, and it is also the honest disclosure that
 * a network connection is being held open. The Stop action makes that revocable
 * in one tap, which is the difference between a background connection the user
 * controls and one that merely happens to them.
 *
 * This does NOT survive the app being swiped out of Recents: that destroys the
 * Activity and with it the WebView, so the node is gone regardless of what this
 * service does. {@code START_NOT_STICKY} is therefore deliberate — resurrecting
 * a service whose only job is to protect a connection that no longer exists
 * would leave a notification claiming "Connected" over a dead node.
 */
public class KantConnectionService extends Service {

    static final String ACTION_START  = "com.kant.messenger.action.CONNECTION_START";
    static final String ACTION_UPDATE = "com.kant.messenger.action.CONNECTION_UPDATE";

    /**
     * Programmatic stop: the web layer has already torn the node down and just
     * wants the service gone.
     */
    static final String ACTION_STOP = "com.kant.messenger.action.CONNECTION_STOP";

    /**
     * The user tapped Stop on the notification. Distinct from ACTION_STOP
     * because only this one notifies the web layer — the JS handler responds by
     * disconnecting, which itself calls stop(), and a single shared action would
     * make that re-enter this method and fire the listener again on every pass.
     */
    static final String ACTION_USER_STOP = "com.kant.messenger.action.CONNECTION_USER_STOP";

    static final String EXTRA_STATUS = "status";

    private static final String CHANNEL_ID   = "kant_connection";
    private static final String CHANNEL_NAME = "Background connection";
    private static final int    NOTIFICATION_ID = 0x4B414E54; // "KANT"

    /** Mirrors the foreground state so the plugin can answer isRunning() cheaply. */
    private static volatile boolean running = false;

    /**
     * Invoked when the user taps Stop. The web layer registers this so it can
     * shut the libp2p node down cleanly instead of having the socket yanked.
     */
    private static volatile Runnable stopListener = null;

    static boolean isRunning() { return running; }

    static void setStopListener(Runnable listener) { stopListener = listener; }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        final String action = intent != null && intent.getAction() != null
                ? intent.getAction()
                : ACTION_START;

        if (ACTION_STOP.equals(action) || ACTION_USER_STOP.equals(action)) {
            // Only a tap on the notification asks the web layer to disconnect.
            // A stop that came *from* the web layer must not call back into it:
            // its handler disconnects, which calls stop() again, which would
            // re-enter here. stopSelf() only ends the service, so the process
            // stays alive long enough for the handler to finish.
            if (ACTION_USER_STOP.equals(action)) {
                final Runnable listener = stopListener;
                if (listener != null) {
                    try { listener.run(); } catch (Throwable ignored) { /* stop must not fail */ }
                }
            }
            running = false;
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        final String status = intent != null ? intent.getStringExtra(EXTRA_STATUS) : null;

        if (ACTION_UPDATE.equals(action) && running) {
            // Already in the foreground — just repaint the text. Calling
            // startForeground again would work but re-triggers the FGS timing
            // checks on Android 14 for no benefit.
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification(status));
            return START_NOT_STICKY;
        }

        createChannel();
        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(status), type);
        running = true;
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    /**
     * The task being swiped away destroys the WebView, so the node this service
     * exists to protect is already gone. Clear the notification rather than
     * leave one behind that claims a connection nobody is holding.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        running = false;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        // LOW, not DEFAULT: this notification is a permanent fixture. It must be
        // silent and must not interrupt — the message channel is where alerts
        // belong.
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shows that Kant is holding its relay connection open");
        channel.setShowBadge(false);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    private Notification buildNotification(String status) {
        final String text = status == null || status.isEmpty()
                ? "Running in the background"
                : status;

        Intent stopIntent = new Intent(this, KantConnectionService.class).setAction(ACTION_USER_STOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent stopPending = PendingIntent.getService(this, 1, stopIntent, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Kant")
                .setContentText(text)
                .setContentIntent(KantNotifications.contentIntent(this))
                .setOngoing(true)
                .setSilent(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                // Visible on the lock screen but without the status text, which
                // would otherwise leak connection state to anyone glancing at it.
                .setVisibility(NotificationCompat.VISIBILITY_SECRET)
                .addAction(0, "Stop", stopPending)
                .build();
    }

    /** Start or update the service from anywhere that has a Context. */
    static void send(Context context, String action, String status) {
        Intent intent = new Intent(context, KantConnectionService.class)
                .setAction(action)
                .putExtra(EXTRA_STATUS, status);
        final boolean stopping = ACTION_STOP.equals(action) || ACTION_USER_STOP.equals(action);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !stopping) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }
}
