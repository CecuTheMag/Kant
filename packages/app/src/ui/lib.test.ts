import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initials, isOnline, seenLabel, ONLINE_WINDOW_MS } from './lib';

test('initials never split a character in half', () => {
  assert.equal(initials('Carol Blossom'), 'CB');
  assert.equal(initials('Carol \u{1F338}'), 'C' + '\u{1F338}');
  assert.equal(initials('\u{1F468}\u200D\u{1F469}\u200D\u{1F467} Family'), '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}' + 'F');
  assert.equal(initials('\u{1F1E7}\u{1F1EC}'), '\u{1F1E7}\u{1F1EC}');
  assert.equal(initials('\u0438\u0432\u0430\u043d \u043f\u0435\u0442\u0440\u043e\u0432'), '\u0418\u041f');
  assert.equal(initials('   '), '');
  for (const name of ['Carol \u{1F338}', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} x', '\u{1F1E7}\u{1F1EC}']) {
    assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(initials(name)), false, name);
  }
});

test('online means heard from recently, and goes away when they do', () => {
  const now = 1_000_000_000;
  assert.equal(isOnline(undefined, now), false, 'never heard from');
  assert.equal(isOnline(now - 5_000, now), true);
  // Presence goes out every 60 s: a contact is still online between two pings.
  assert.equal(isOnline(now - 90_000, now), true);
  // Before 0.5.0 a contact stayed "Online" until the app restarted.
  assert.equal(isOnline(now - ONLINE_WINDOW_MS, now), false);
  assert.equal(isOnline(now - 60 * 60_000, now), false);
});

test('seen label: online wins, otherwise how long ago', () => {
  assert.equal(seenLabel({ online: true, lastSeen: Date.now() - 3 * 3_600_000 }), 'Online');
  assert.equal(seenLabel({ online: false, lastSeen: Date.now() - 10_000 }), 'Last seen just now');
  assert.equal(seenLabel({ online: false, lastSeen: Date.now() - 5 * 60_000 }), 'Last seen 5 min ago');
  assert.equal(seenLabel({ online: false, lastSeen: undefined }), '');
});
