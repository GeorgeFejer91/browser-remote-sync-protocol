import assert from "node:assert/strict";
import test from "node:test";
import { waveformGrid, waveformPoints } from "../src/waveform.js";

test("waveform mirrors the headset mean-centering and recent-deviation scaling", () => {
  assert.deepEqual(waveformPoints({ values: [-1000, 0, 1000] }, 100, 50), [
    { x: 0, y: 45 },
    { x: 50, y: 25 },
    { x: 100, y: 5 },
  ]);
  assert.deepEqual(waveformPoints({ values: [4, 4] }, 100, 50), [
    { x: 0, y: 25 },
    { x: 100, y: 25 },
  ]);
});

test("waveform stays empty rather than synthesizing a trace", () => {
  assert.deepEqual(waveformPoints({ values: [] }, 100, 50), []);
  assert.deepEqual(waveformPoints({ values: [1] }, 100, 50), []);
  assert.deepEqual(waveformPoints(undefined, 100, 50), []);
});

test("waveform grid geometry is deterministic", () => {
  assert.deepEqual(waveformGrid(100, 80), { vertical: [36, 72], horizontal: [36, 72] });
  assert.deepEqual(waveformGrid(10, 10, 0), { vertical: [], horizontal: [] });
});
