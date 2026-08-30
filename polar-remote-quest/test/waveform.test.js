import assert from "node:assert/strict";
import test from "node:test";

import { waveformPoints } from "../src/waveform.js";

test("waveform projection is deterministic and bounded to the canvas", () => {
  const points = waveformPoints({ values: [-1000, 0, 1000] }, 108, 58, 4);
  assert.deepEqual(points, [
    { x: 4, y: 54 },
    { x: 54, y: 29 },
    { x: 104, y: 4 },
  ]);
  assert.deepEqual(waveformPoints({ values: [] }, 108, 58), []);
  assert.deepEqual(waveformPoints(undefined, 108, 58), []);
});
