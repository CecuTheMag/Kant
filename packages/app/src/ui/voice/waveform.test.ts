import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  WAVEFORM_BARS, baseMime, extensionForMime, formatDuration, levelsToWaveform, nextPlaybackRate, pickRecorderMime,
  placeholderWaveform, resampleBars, spokenDuration, voiceFileName,
} from './waveform';

test('durations read like a clock', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(7_400), '0:07');
  assert.equal(formatDuration(65_000), '1:05');
  assert.equal(formatDuration(3_723_000), '1:02:03');
  assert.equal(formatDuration(-5), '0:00');
  assert.equal(formatDuration(Number.NaN), '0:00');
  assert.equal(formatDuration(Infinity), '0:00');
});

test('spoken durations are grammatical', () => {
  assert.equal(spokenDuration(1_000), '1 second');
  assert.equal(spokenDuration(12_000), '12 seconds');
  assert.equal(spokenDuration(60_000), '1 minute');
  assert.equal(spokenDuration(125_000), '2 minutes 5 seconds');
  assert.equal(spokenDuration(0), '0 seconds');
});

test('levels become a normalised peak waveform', () => {
  const levels = Array.from({ length: 640 }, (_, i) => (i % 64 === 0 ? 0.5 : 0.05));
  const wave = levelsToWaveform(levels);
  assert.equal(wave.length, WAVEFORM_BARS);
  assert.ok(wave.every(v => v >= 0 && v <= 100 && Number.isInteger(v)));
  assert.equal(Math.max(...wave), 100);
});

test('silence, empty and junk input give a flat line, never NaN', () => {
  assert.deepEqual(levelsToWaveform([], 4), [0, 0, 0, 0]);
  assert.deepEqual(levelsToWaveform([0, 0, 0], 3), [0, 0, 0]);
  assert.deepEqual(levelsToWaveform([Number.NaN, -1, 5], 3), [0, 0, 100]);
  assert.deepEqual(levelsToWaveform([1], 0), []);
});

test('fewer samples than bars still fills every bar', () => {
  const wave = levelsToWaveform([0.2, 0.8], 8);
  assert.equal(wave.length, 8);
  assert.ok(wave.every(v => v > 0));
});

test('resampling keeps peaks when shrinking and length when growing', () => {
  assert.deepEqual(resampleBars([10, 90, 20, 30], 2), [90, 30]);
  assert.equal(resampleBars([10, 20], 6).length, 6);
  assert.deepEqual(resampleBars([], 3), [0, 0, 0]);
  assert.deepEqual(resampleBars([5], 0), []);
});

test('placeholder waveform is stable per seed and bounded', () => {
  const a = placeholderWaveform('file-1');
  assert.deepEqual(a, placeholderWaveform('file-1'));
  assert.notDeepEqual(a, placeholderWaveform('file-2'));
  assert.equal(a.length, WAVEFORM_BARS);
  assert.ok(a.every(v => v >= 0 && v <= 100));
});

test('recorder format prefers Opus and survives throwing probes', () => {
  assert.equal(pickRecorderMime(m => m.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.equal(pickRecorderMime(m => m === 'audio/mp4'), 'audio/mp4');
  assert.equal(pickRecorderMime(() => false), '');
  assert.equal(pickRecorderMime(() => { throw new Error('nope'); }), '');
});

test('file names and types follow the container', () => {
  assert.equal(extensionForMime('audio/webm;codecs=opus'), 'webm');
  assert.equal(extensionForMime('audio/mp4;codecs=mp4a.40.2'), 'm4a');
  assert.equal(extensionForMime('audio/ogg'), 'ogg');
  assert.equal(extensionForMime(''), 'webm');
  assert.equal(baseMime('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(baseMime(''), 'audio/webm');
  const name = voiceFileName('audio/mp4', new Date(2026, 8, 28, 14, 3, 7));
  assert.equal(name, 'Voice message 2026-09-28 at 14.03.07.m4a');
  assert.doesNotMatch(name, /[/\\:*?"<>|]/);
});

test('playback speed cycles 1× → 1.5× → 2× → 1×', () => {
  assert.equal(nextPlaybackRate(1), 1.5);
  assert.equal(nextPlaybackRate(1.5), 2);
  assert.equal(nextPlaybackRate(2), 1);
  assert.equal(nextPlaybackRate(3), 1);
});
