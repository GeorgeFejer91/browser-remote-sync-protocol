import assert from "node:assert/strict";
import test from "node:test";

import {
  clearSessionMaterial,
  resolveSessionMaterial,
  showSessionMaterial,
} from "../examples/two-browser-demo/session-material.js";

function fakeSessionElements() {
  return {
    room: { value: "" },
    secret: { value: "" },
    roomReadback: { textContent: "" },
    secretReadback: { textContent: "" },
    sessionValues: { hidden: true },
  };
}

test("Stop clears pairing material and a target restart generates a fresh session", () => {
  const elements = fakeSessionElements();
  const generatedRooms = ["room_first_session", "room_second_session"];
  const generatedSecrets = [
    "first-generated-192-bit-style-secret",
    "second-generated-192-bit-style-secret",
  ];
  const startTarget = () => {
    const material = resolveSessionMaterial({
      role: "target",
      room: elements.room.value,
      secret: elements.secret.value,
      generateRoom: () => generatedRooms.shift(),
      generateSecret: () => generatedSecrets.shift(),
    });
    showSessionMaterial(elements, material);
    return material;
  };

  const first = startTarget();
  assert.deepEqual(first, {
    room: "room_first_session",
    secret: "first-generated-192-bit-style-secret",
  });
  assert.equal(elements.sessionValues.hidden, false);
  assert.equal(elements.secretReadback.textContent, first.secret);

  clearSessionMaterial(elements);
  assert.equal(elements.room.value, "");
  assert.equal(elements.secret.value, "");
  assert.equal(elements.roomReadback.textContent, "");
  assert.equal(elements.secretReadback.textContent, "");
  assert.equal(elements.sessionValues.hidden, true);

  const second = startTarget();
  assert.deepEqual(second, {
    room: "room_second_session",
    secret: "second-generated-192-bit-style-secret",
  });
  assert.notDeepEqual(second, first);
});
