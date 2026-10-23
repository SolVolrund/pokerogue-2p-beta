import test from "node:test";
import assert from "node:assert/strict";
import "../tools/yes-move-audio-engine.js";
const E = globalThis.YesMoveAudioEngine;
const pcm = (samples, sampleRate = 4) => ({ sampleRate, length: samples.length, numberOfChannels: 1, getChannelData: () => Float32Array.from(samples) });
const event = overrides => ({ path: "test.wav", start: 0, rate: 1, gain: 1, ...overrides });
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);

test("events preserve frame timing, pitch, PRSFX attenuation, track offset and optional cry", () => {
  const config = { frames: Array.from({ length: 21 }, () => []), frameTimedEvents: {
    20: [{ resourceName: "PRSFX- Test.wav", eventType: "AnimTimedSoundEvent", volume: 80, pitch: 50 },
      { resourceName: "", eventType: "AnimTimedSoundEvent", volume: 100, pitch: 100 }],
    21: [{ resourceName: "unreachable.wav", eventType: "AnimTimedSoundEvent" }],
  } };
  const result = E.soundEvents(config, { gain: 0.5, offset: 0.25 });
  assert.equal(result.events.length, 1); assert.equal(result.omittedCries, 1);
  assert.equal(result.events[0].start, 1.25); assert.equal(result.events[0].rate, 0.5); near(result.events[0].gain, 0.2);
  assert.equal(E.soundEvents(config, {}, "mew").events[1].path, "cry/151.m4a");
  assert.equal(E.soundEvents(config, { muted: true }).events.length, 0);
});
test("deduplication preserves different gain, pitch and start time", () => {
  const events = [event(), event(), event({ gain: 0.5 }), event({ rate: 2 }), event({ start: 1 })];
  assert.equal(E.deduplicate(events, true).length, 4);
  assert.equal(E.deduplicate(events, false).length, 5);
});
test("overlapping signals sum, mono is duplicated to stereo and final peak is normalized", async () => {
  const result = await E.mix([event(), event(), event({ gain: 2 })], async () => pcm([0.25, -0.25]), { sampleRate: 4 });
  assert.equal(result.duplicates, 1); assert.equal(result.mixed, 2); near(result.peak, 0.75);
  assert.deepEqual([...result.channels[0]], [0.5, -0.5]);
  assert.deepEqual([...result.channels[0]], [...result.channels[1]]);
});
test("negative offset clips the beginning, pitch changes duration, and tail trimming works", async () => {
  const shifted = await E.mix([event({ start: -0.25 })], async () => pcm([0.2, 0.4, 0.6, 0.8]), { sampleRate: 4 });
  assert.equal(shifted.channels[0].length, 3); near(shifted.channels[0][0], 0.25); near(shifted.channels[0][2], 0.5);
  const faster = await E.mix([event({ rate: 2 })], async () => pcm([0.2, 0.4, 0.6, 0.8]), { sampleRate: 4 });
  assert.equal(faster.duration, 0.5);
  const trimmed = await E.mix([event()], async () => pcm([0.2, 0.4, 0.6, 0.8]), { sampleRate: 4, duration: 0.5, trim: true });
  assert.equal(trimmed.duration, 0.5);
});
test("missing assets are reported and cancellation stops the mix", async () => {
  const result = await E.mix([event(), event({ path: "missing.wav" })], async path => {
    if (path === "missing.wav") throw new Error("404"); return pcm([0.25]);
  }, { sampleRate: 4 });
  assert.equal(result.missing.length, 1); assert.equal(result.mixed, 1);
  await assert.rejects(E.mix([event()], async () => pcm([1]), { cancelled: () => true }), /cancelled/);
});
test("WAV output has stereo PCM headers and interleaved normalized samples", () => {
  const bytes = E.wav({ sampleRate: 44100, channels: [Float32Array.from([0.5, 0]), Float32Array.from([-0.5, 0])] });
  const view = new DataView(bytes);
  assert.equal(new TextDecoder().decode(new Uint8Array(bytes, 0, 4)), "RIFF");
  assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(40, true), 8); assert.equal(view.getInt16(44, true), 16384); assert.equal(view.getInt16(46, true), -16384);
});
