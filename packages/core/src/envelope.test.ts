import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  REPLY_LIMITS, decodeContent, encodeContent, sanitizeCaps, sanitizeReplyRef,
} from './envelope.js';
import { decodeGroupText, encodeGroupText } from './groups.js';
import { stripLegacyWireFields } from './queue.js';

const reply = { id: 'm-1', from: 'maga', text: 'imaiki na predvid…' };

describe('content envelope', () => {
  test('plain text without a reply stays byte-identical (legacy peers read it unchanged)', () => {
    assert.equal(encodeContent('hello'), 'hello');
    assert.deepEqual(decodeContent('hello'), { text: 'hello', enveloped: false });
  });

  test('a reply round-trips inside the envelope', () => {
    const decoded = decodeContent(encodeContent('Duress pin', reply));
    assert.deepEqual(decoded, { text: 'Duress pin', replyTo: reply, enveloped: true });
  });

  test('text that merely looks like JSON is kept literally', () => {
    for (const raw of ['{', '{}', '{"text":"x"}', '{"__kantReply":2,"text":"x"}', '{"__kantReply":1}', '{"__kantReply":1,"text":5}', '[1,2]', 'null']) {
      assert.deepEqual(decodeContent(raw), { text: raw, enveloped: false }, raw);
    }
  });

  test('a malformed reply reference is dropped, the body survives', () => {
    const cases: unknown[] = [null, 'x', 7, [], {}, { id: 1, from: 'a', text: 'b' }, { id: 'a', from: {}, text: 'b' }, { id: '', from: 'a', text: 'b' }];
    for (const bad of cases) {
      const decoded = decodeContent(JSON.stringify({ __kantReply: 1, text: 'body', replyTo: bad }));
      assert.equal(decoded.text, 'body');
      assert.equal(decoded.replyTo, undefined);
      assert.equal(decoded.enveloped, true);
    }
  });

  test('reply fields are length-bounded on both encode and decode', () => {
    const huge = { id: 'i'.repeat(1000), from: 'f'.repeat(1000), text: 't'.repeat(5000) };
    const viaEncode = decodeContent(encodeContent('x', huge)).replyTo!;
    const viaDecode = decodeContent(JSON.stringify({ __kantReply: 1, text: 'x', replyTo: huge })).replyTo!;
    for (const r of [viaEncode, viaDecode]) {
      assert.equal(r.id.length, REPLY_LIMITS.id);
      assert.equal(r.from.length, REPLY_LIMITS.from);
      assert.equal(r.text.length, REPLY_LIMITS.text);
    }
  });

  test('extra envelope fields cannot smuggle properties into the reply', () => {
    const sanitized = sanitizeReplyRef({ ...reply, __proto__: { polluted: true }, extra: 'x' });
    assert.deepEqual(sanitized, reply);
    assert.equal(Object.keys(sanitized!).length, 3);
  });

  test('group codec is the same envelope (old group members keep decoding it)', () => {
    const wire = encodeGroupText('hi', reply);
    assert.equal(JSON.parse(wire).__kantReply, 1);
    assert.deepEqual(decodeGroupText(wire), { text: 'hi', replyTo: reply });
    assert.deepEqual(decodeGroupText('plain'), { text: 'plain' });
    // Previously an unvalidated object here crashed the renderer.
    assert.deepEqual(decodeGroupText(JSON.stringify({ __kantReply: 1, text: 'hi', replyTo: { id: 'a', from: { x: 1 }, text: 'b' } })), { text: 'hi' });
  });

  test('capability lists from presence are sanitised', () => {
    assert.deepEqual(sanitizeCaps(undefined), []);
    assert.deepEqual(sanitizeCaps('content-envelope-1'), []);
    assert.deepEqual(sanitizeCaps(['a', 'a', 3, '', 'x'.repeat(65), 'b']), ['a', 'b']);
    assert.equal(sanitizeCaps(Array.from({ length: 100 }, (_, i) => `c${i}`)).length, 32);
  });
});

describe('legacy wire metadata', () => {
  test('the plaintext reply snippet is stripped from queued wire payloads', () => {
    const legacy = JSON.stringify({ id: 'm', fromPubKeyHex: 'ab', replyTo: reply, header: { msgNum: 3 }, ciphertext: [1, 2], nonce: [3] });
    const scrubbed = JSON.parse(stripLegacyWireFields(legacy));
    assert.equal('replyTo' in scrubbed, false);
    assert.deepEqual(scrubbed, { id: 'm', fromPubKeyHex: 'ab', header: { msgNum: 3 }, ciphertext: [1, 2], nonce: [3] });
  });

  test('payloads without legacy fields, or that are not JSON objects, are returned untouched', () => {
    const current = JSON.stringify({ id: 'm', ciphertext: [1] });
    assert.equal(stripLegacyWireFields(current), current);
    for (const raw of ['not json', '[1]', '"s"', 'null']) assert.equal(stripLegacyWireFields(raw), raw);
  });
});
