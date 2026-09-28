import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initials } from './lib';

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
