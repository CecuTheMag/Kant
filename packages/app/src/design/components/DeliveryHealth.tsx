/**
 * Whether messages will actually reach this device while it is not in use.
 *
 * On Android three separate things have to be true, and all three fail
 * silently: the app needs POST_NOTIFICATIONS or the system drops every
 * notification without a word; it needs the foreground service running or the
 * process is frozen within seconds of being backgrounded; and it needs a Doze
 * exemption or the connection is suspended once the screen has been off a
 * while. Nothing in the UI used to say any of this, so "I stopped getting
 * messages" had no visible cause and no route to a fix.
 *
 * Each row states the current state plainly and, where the user can do
 * something, offers the one action that changes it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ensureNotificationPermission, getNotificationPermission } from '../../lib/localNotify';
import {
  isBatteryOptimized, openBatterySettings, isBackgroundServiceRunning,
} from '../../lib/backgroundService';
import { Check, ShieldAlert } from './icons';

type Health = {
  notifications: boolean;
  background: boolean;
  /** True when Doze may still suspend us — i.e. the exemption is NOT granted. */
  batteryRestricted: boolean;
};

export function DeliveryHealth() {
  const [health, setHealth] = useState<Health | null>(null);

  const refresh = useCallback(async () => {
    const [notifications, background, batteryRestricted] = await Promise.all([
      getNotificationPermission(),
      isBackgroundServiceRunning(),
      isBatteryOptimized(),
    ]);
    setHealth({ notifications, background, batteryRestricted });
  }, []);

  useEffect(() => {
    void refresh();
    // Returning from the system settings screen is the moment these change, and
    // it arrives as a visibility change rather than anything React can observe.
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  // Android is the only platform where any of this is actionable.
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return null;
  if (!health) return null;

  const allGood = health.notifications && health.background && !health.batteryRestricted;

  return (
    <div className="card">
      <div className="card-head" style={{ cursor: 'default' }}>
        <span className="icon-tile">
          {allGood ? <Check size={14} /> : <ShieldAlert size={14} />}
        </span>
        <div>
          <div className="card-title">Message delivery</div>
          <div className="card-desc">
            {allGood
              ? 'Set up to receive messages while the app is closed.'
              : 'Something here will stop messages reaching you.'}
          </div>
        </div>
      </div>
      <div className="card-body">
        <HealthRow
          ok={health.notifications}
          name="Notifications"
          okText="Allowed. You will be told when a message arrives."
          badText="Blocked. Messages still arrive, but nothing tells you."
          actionLabel="Allow"
          onAction={async () => { await ensureNotificationPermission(); void refresh(); }}
        />
        <HealthRow
          ok={health.background}
          name="Background connection"
          okText="Running. Kant stays reachable while it is not on screen."
          badText="Not running. Connect to the relay to start it."
        />
        <HealthRow
          ok={!health.batteryRestricted}
          name="Battery restrictions"
          okText="Unrestricted. The connection survives a long screen-off."
          badText="Restricted. Android may cut the connection after the screen is off a while."
          actionLabel="Change"
          onAction={openBatterySettings}
        />
      </div>
      <div className="card-body" style={{ paddingTop: 0 }}>
        <p className="setting-desc" style={{ margin: 0 }}>
          Closing Kant from the app switcher always disconnects it — messages
          then wait until you next open the app.
        </p>
      </div>
    </div>
  );
}

function HealthRow({
  ok, name, okText, badText, actionLabel, onAction,
}: {
  ok: boolean;
  name: string;
  okText: string;
  badText: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}) {
  return (
    <div className="setting-row">
      <span
        className={`status-led ${ok ? 'led-ok' : 'led-warn'}`}
        style={{ alignSelf: 'center', flexShrink: 0 }}
        aria-hidden="true"
      />
      <div className="setting-body">
        <div className="setting-name">{name}</div>
        <div className="setting-desc">{ok ? okText : badText}</div>
      </div>
      {!ok && actionLabel && onAction && (
        <button className="btn btn-sm" onClick={() => void onAction()} style={{ flexShrink: 0 }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
