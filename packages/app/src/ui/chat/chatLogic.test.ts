import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { plainText, applyFormat, classifyDrag, formatForShortcut, summarizeReactions, swipeOffset, toggledReaction, SWIPE } from './chatLogic';

describe('applyFormat', () => {
  test('wraps the selection and keeps it selected', () => {
    assert.deepEqual(applyFormat('say hello now', 4, 9, 'bold'), { value: 'say **hello** now', start: 6, end: 11 });
    assert.deepEqual(applyFormat('x', 0, 1, 'strike'), { value: '~~x~~', start: 2, end: 3 });
  });
  test('keeps edge whitespace outside the markers', () => {
    assert.equal(applyFormat('a big deal', 1, 6, 'italic').value, 'a _big_ deal');
  });
  test('unwraps when applied again', () => {
    const once = applyFormat('say hello now', 4, 9, 'bold');
    assert.deepEqual(applyFormat(once.value, once.start, once.end, 'bold'), { value: 'say hello now', start: 4, end: 9 });
    assert.equal(applyFormat('**hi**', 0, 6, 'bold').value, 'hi');
  });
  test('an empty selection inserts a marker pair around the caret', () => {
    assert.deepEqual(applyFormat('ab', 1, 1, 'code'), { value: 'a``b', start: 2, end: 2 });
  });
  test('block styles prefix each line and toggle off', () => {
    const quoted = applyFormat('one\ntwo\n\nthree', 0, 7, 'quote');
    assert.equal(quoted.value, '> one\n> two\n\nthree');
    assert.equal(applyFormat(quoted.value, quoted.start, quoted.end, 'quote').value, 'one\ntwo\n\nthree');
    assert.equal(applyFormat('milk', 2, 2, 'list').value, '- milk');
  });
  test('shortcuts', () => {
    assert.equal(formatForShortcut('b', true, false), 'bold');
    assert.equal(formatForShortcut('X', true, true), 'strike');
    assert.equal(formatForShortcut('b', false, false), null);
  });
});

describe('reactions', () => {
  test('one chip per emoji, most used first, yours marked', () => {
    const chips = summarizeReactions({ me: '👍', a: '❤️', b: '👍', them: '😂' });
    assert.deepEqual(chips.map(c => [c.emoji, c.count, c.mine]), [['👍', 2, true], ['❤️', 1, false], ['😂', 1, false]]);
    assert.deepEqual(summarizeReactions(undefined), []);
  });
  test('tapping your own reaction again removes it', () => {
    assert.equal(toggledReaction('👍', '👍'), '');
    assert.equal(toggledReaction('👍', '❤️'), '❤️');
    assert.equal(toggledReaction(undefined, '❤️'), '❤️');
  });
});

describe('swipe to reply', () => {
  test('only a rightward, mostly horizontal drag is a swipe', () => {
    assert.equal(classifyDrag(4, 2), 'pending');
    assert.equal(classifyDrag(30, 5), 'swipe');
    assert.equal(classifyDrag(-30, 2), 'scroll');
    assert.equal(classifyDrag(12, 20), 'scroll');
  });
  test('the bubble follows the finger, then resists', () => {
    assert.equal(swipeOffset(-5), 0);
    assert.equal(swipeOffset(30), 30);
    assert.ok(swipeOffset(200) <= SWIPE.max);
    assert.ok(swipeOffset(SWIPE.trigger + 10) > SWIPE.trigger);
  });
});

describe('plainText', () => {
  test('drops formatting markers for quotes and previews', () => {
    assert.equal(plainText('Plan for **Friday** — _please_ check `deploy.sh`\n- buy ~~milk~~ coffee'), 'Plan for Friday — please check deploy.sh\n• buy milk coffee');
    assert.equal(plainText('> quoted\n\n1. first'), 'quoted\n1. first');
    assert.equal(plainText('just text'), 'just text');
    assert.equal(plainText('snake_case_name stays'), 'snake_case_name stays');
  });
});
