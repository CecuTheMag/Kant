/**
 * Haptic feedback, where the device has it (the Capacitor Haptics plugin on
 * Android and iOS). Everywhere else every call is a no-op. Fire and forget:
 * nothing here throws or needs awaiting.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const available = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Haptics');
const quiet = (p: Promise<unknown>) => { void p.catch(() => {}); };

/** A light tap: something was picked up, sent or let go. */
export function tap(): void {
  if (available()) quiet(Haptics.impact({ style: ImpactStyle.Light }));
}

/** A selection tick: a switch flipped, a reaction chosen, a threshold crossed. */
export function select(): void {
  if (!available()) return;
  // iOS only ticks between a start/end pair.
  quiet(Haptics.selectionStart().then(() => Haptics.selectionChanged()).then(() => Haptics.selectionEnd()));
}

export function success(): void {
  if (available()) quiet(Haptics.notification({ type: NotificationType.Success }));
}

export function warning(): void {
  if (available()) quiet(Haptics.notification({ type: NotificationType.Warning }));
}
