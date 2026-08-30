import assert from "node:assert/strict";
import test from "node:test";

import {
  VDO_BRSP_CONTROL_CHANNEL,
  VDO_BRSP_STATE_CHANNEL,
  VdoNinjaTransport,
} from "../src/vdo-ninja-transport.js";

class MockChannel extends EventTarget {
  constructor(label, options = {}) {
    super();
    this.label = `x-${label}`;
    this.options = options;
    this.readyState = "open";
    this.bufferedAmount = 0;
    this.sent = [];
  }

  send(value) {
    this.sent.push(value);
  }

  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  }
}

class MockSdk extends EventTarget {
  constructor(options, listing = []) {
    super();
    this.options = options;
    this.listing = listing;
    this.calls = [];
    this.channels = new Map();
  }

  emit(type, detail) {
    const event = new Event(type);
    Object.defineProperty(event, "detail", { value: detail });
    this.dispatchEvent(event);
  }

  async connect() { this.calls.push(["connect"]); }

  async joinRoom(options) {
    this.calls.push(["joinRoom", options]);
    this.emit("listing", { list: this.listing });
  }

  async announce(options) { this.calls.push(["announce", options]); }

  async view(streamId, options) { this.calls.push(["view", streamId, options]); }

  async openChannel(peerKey, label, options) {
    this.calls.push(["openChannel", peerKey, label, options]);
    const channel = new MockChannel(label, options);
    this.channels.set(label, channel);
    return channel;
  }

  async disconnect() { this.calls.push(["disconnect"]); }
}

function eventOnce(target, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}; phase=${target.phase}`)), 2_000);
    target.addEventListener(type, (event) => {
      clearTimeout(timer);
      resolve(event.detail);
    }, { once: true });
  });
}

test("constructing the adapter performs no network or SDK work", () => {
  let constructed = 0;
  const transport = new VdoNinjaTransport({
    role: "target",
    room: "brsp_no_auto_connection",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: () => { constructed += 1; return new MockSdk({}); },
  });
  assert.equal(constructed, 0);
  assert.equal(transport.phase, "idle");
});

test("target announces data-only and opens reliable control plus unordered zero-retry state", async () => {
  let sdk;
  const transport = new VdoNinjaTransport({
    role: "target",
    room: "brsp_target_room_1234",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => { sdk = new MockSdk(options); return sdk; },
  });
  await transport.start();
  assert.equal(sdk.options.password, "generated-secret-with-enough-entropy");
  assert.equal(sdk.calls.some(([name]) => name === "announce"), true);
  assert.equal(sdk.calls.some(([name]) => name === "view"), false);
  const opened = eventOnce(transport, "peeropen");
  sdk.emit("dataChannelOpen", { uuid: "controller-uuid" });
  assert.deepEqual(await opened, { peerKey: "controller-uuid" });
  assert.deepEqual(sdk.calls.filter(([name]) => name === "openChannel").map((call) => call.slice(2)), [
    [VDO_BRSP_CONTROL_CHANNEL, { ordered: true }],
    [VDO_BRSP_STATE_CHANNEL, { ordered: false, maxRetransmits: 0 }],
  ]);
  await transport.stop();
});

test("controller requests no audio or video and accepts the two custom channels", async () => {
  let sdk;
  const transport = new VdoNinjaTransport({
    role: "controller",
    room: "brsp_controller_room",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => {
      sdk = new MockSdk(options, [{
        streamID: "brsp_target_test_123",
        UUID: "target-uuid",
        label: "Test target",
      }]);
      return sdk;
    },
  });
  await transport.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const view = sdk.calls.find(([name]) => name === "view");
  assert.equal(view[1], "brsp_target_test_123");
  assert.deepEqual(view[2], {
    audio: false,
    video: false,
    downloads: false,
    allowresources: false,
    label: "BRSP controller",
  });
  const opened = eventOnce(transport, "peeropen");
  sdk.emit("channelOpen", {
    uuid: "target-uuid",
    streamID: "brsp_target_test_123",
    label: `x-${VDO_BRSP_CONTROL_CHANNEL}`,
    channel: new MockChannel(VDO_BRSP_CONTROL_CHANNEL, { ordered: true }),
  });
  sdk.emit("channelOpen", {
    uuid: "target-uuid",
    streamID: "brsp_target_test_123",
    label: `x-${VDO_BRSP_STATE_CHANNEL}`,
    channel: new MockChannel(VDO_BRSP_STATE_CHANNEL, { ordered: false, maxRetransmits: 0 }),
  });
  assert.deepEqual(await opened, { peerKey: "target-uuid" });
  await transport.stop();
});

test("state lane retains only the newest pending frame under backpressure", async () => {
  let sdk;
  const transport = new VdoNinjaTransport({
    role: "target",
    room: "brsp_backpressure_room",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => { sdk = new MockSdk(options); return sdk; },
  });
  await transport.start();
  const opened = eventOnce(transport, "peeropen");
  sdk.emit("dataChannelOpen", { uuid: "controller-uuid" });
  await opened;
  const state = sdk.channels.get(VDO_BRSP_STATE_CHANNEL);
  state.bufferedAmount = 10;
  assert.equal(transport.sendState("controller-uuid", "old"), false);
  assert.equal(transport.sendState("controller-uuid", "new"), false);
  state.bufferedAmount = 0;
  state.dispatchEvent(new Event("bufferedamountlow"));
  assert.deepEqual(state.sent, ["new"]);
  await transport.stop();
});
