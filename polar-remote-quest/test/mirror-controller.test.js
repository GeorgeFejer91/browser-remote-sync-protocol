import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { MAX_LATENCY_SAMPLES, MAX_PENDING_COMMANDS, PolarRemoteController } from "../src/controller.js";
import { commandForId } from "../src/profile.js";
import { CAPABILITY_MANIFEST, EXPECTED_CAPABILITY_HASH } from "../src/profile.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class FakeTransport extends EventTarget {
  constructor(options) { super(); this.options = options; this.started = false; this.stopped = false; }
  async start() { this.started = true; }
  async stop() { this.stopped = true; }
  sendControl() { return true; }
  sendState() { return true; }
}

function detailEvent(type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail, enumerable: true });
  return event;
}

function fakeReadySession(overrides = {}) {
  const state = {
    phase: "ready",
    capabilities: ["command-ack", "latest-state", "polar-remote-v1", "state-snapshot"],
    acceptedScopes: ["app.observe", "polar.control"],
    pendingCommands: 0,
    ...overrides,
  };
  return {
    snapshot: () => state,
    isStateStale: () => false,
    sendCommand: () => "cmd_deterministic01",
  };
}

test("construction is inert and transport receives only the transport secret", async () => {
  let transport;
  const controller = new PolarRemoteController({ transportFactory: (options) => (transport = new FakeTransport(options)) });
  assert.equal(controller.snapshot().phase, "idle");
  await controller.connect({
    room: "polar_room_01", session: "polar.session-01",
    transportSecret: "transport-secret-with-adequate-length",
    pairingSecret: "pairing-secret-with-adequate-length",
  });
  assert.equal(transport.started, true);
  assert.equal(transport.options.sharedSecret, "transport-secret-with-adequate-length");
  assert.notEqual(transport.options.sharedSecret, "pairing-secret-with-adequate-length");
  await controller.stop();
  assert.equal(transport.stopped, true);
});

test("commands require command-ack, granted scope, and room in the pending bound", () => {
  const controller = new PolarRemoteController();
  const command = commandForId("rescan");
  controller.confirmed = { revision: 0, state: { capabilityHash: EXPECTED_CAPABILITY_HASH } };
  controller.manifestVerified = true;

  controller.session = fakeReadySession({ capabilities: ["latest-state"] });
  assert.equal(controller.canSend(command), false, "command-ack is mandatory");

  controller.session = fakeReadySession({ acceptedScopes: ["app.observe"] });
  assert.equal(controller.canSend(command), false, "the command scope must be granted");

  controller.session = fakeReadySession({ pendingCommands: MAX_PENDING_COMMANDS - 1 });
  assert.equal(controller.canSend(command), true);

  controller.session = fakeReadySession({ pendingCommands: MAX_PENDING_COMMANDS });
  assert.equal(controller.canSend(command), false, "the browser must not grow an unbounded command set");
});

test("ECG preview requires its negotiated read scope and survives reliable status projections", () => {
  const preview = { format: "normalized-int-v1", sampleRateHz: 65, values: [-1000, 0, 1000] };
  const controller = new PolarRemoteController();
  controller.session = fakeReadySession({ acceptedScopes: ["polar.ecg.observe"] });
  controller.acceptConfirmed({ revision: 4, state: { revision: 4, ecg: "streaming", ecgPreview: preview } }, { replaceEcgPreview: true });
  assert.deepEqual(controller.snapshot().state.ecgPreview, preview);

  controller.acceptConfirmed({ revision: 5, state: { revision: 5, ecg: "streaming" } });
  assert.deepEqual(controller.snapshot().state.ecgPreview, preview, "a reliable applied/snapshot projection omits but does not erase preview data");
  controller.acceptConfirmed({ revision: 5, state: { revision: 5, ecg: "stopped", ecgPreview: null } }, { replaceEcgPreview: true });
  assert.equal(controller.snapshot().state.ecgPreview, null);

  controller.session = fakeReadySession({ acceptedScopes: ["app.observe"] });
  controller.acceptConfirmed({ revision: 6, state: { revision: 6, ecgPreview: preview } }, { replaceEcgPreview: true });
  assert.equal(Object.hasOwn(controller.snapshot().state, "ecgPreview"), false);
});

test("mutations require a current-session manifest and reconnect clears prior confirmation", async () => {
  const controller = new PolarRemoteController({ transportFactory: (options) => new FakeTransport(options) });
  controller.session = fakeReadySession();
  controller.confirmed = { revision: 41, state: { capabilityHash: EXPECTED_CAPABILITY_HASH } };
  controller.manifestVerified = false;
  assert.equal(controller.canSend(commandForId("rescan")), false);
  controller.session = fakeReadySession({ acceptedScopes: ["polar.control"] });
  assert.equal(controller.canSend(commandForId("request-capabilities")), false, "scope still applies to observe commands");

  controller.session = undefined;
  await controller.connect({
    room: "polar_room_02", session: "polar.session-02",
    transportSecret: "transport-secret-with-adequate-length",
    pairingSecret: "pairing-secret-with-adequate-length",
  });
  controller.session.snapshot = () => ({
    phase: "ready",
    capabilities: ["command-ack", "latest-state", "polar-remote-v1", "state-snapshot"],
    acceptedScopes: ["app.observe", "polar.control"],
    pendingCommands: 0,
  });
  assert.equal(controller.snapshot().revision, 0);
  assert.deepEqual(controller.snapshot().state, {});
  await controller.stop();
  assert.equal(controller.snapshot().revision, 0);
  assert.deepEqual(controller.snapshot().state, {});
});

test("an applied result advances confirmed state before the next command", async () => {
  const controller = new PolarRemoteController({ transportFactory: (options) => new FakeTransport(options) });
  await controller.connect({
    room: "polar_room_01", session: "polar.session-01",
    transportSecret: "transport-secret-with-adequate-length",
    pairingSecret: "pairing-secret-with-adequate-length",
  });
  controller.session.snapshot = () => ({
    phase: "ready",
    capabilities: ["command-ack", "latest-state", "polar-remote-v1", "state-snapshot"],
    acceptedScopes: ["app.observe", "polar.control"],
    pendingCommands: 0,
  });

  controller.session.dispatchEvent(detailEvent("commandapplied", {
    commandId: "cmd_appliedresult01",
    ok: true,
    revision: 17,
    result: {
      revision: 17,
      panelVisible: true,
      targetInteraction: "interactive",
      capabilityHash: EXPECTED_CAPABILITY_HASH,
      rawEcg: [1, 2, 3],
    },
    error: null,
  }));

  assert.equal(controller.snapshot().revision, 17);
  assert.deepEqual(controller.snapshot().state, {
    revision: 17,
    panelVisible: true,
    targetInteraction: "interactive",
    capabilityHash: EXPECTED_CAPABILITY_HASH,
  });

  controller.session.dispatchEvent(detailEvent("commandapplied", {
    commandId: "cmd_rejectedresult01",
    ok: false,
    revision: 18,
    result: {
      revision: 18,
      panelVisible: true,
      targetInteraction: "interactive",
      scan: "idle",
      sensor: "connected",
      ecg: "streaming",
      capabilityHash: "capability-hash-v1",
    },
    error: "revision_conflict",
  }));
  assert.equal(controller.snapshot().revision, 18, "a rejection can still report newer target state");

  controller.session.dispatchEvent(detailEvent("commandapplied", {
    commandId: "cmd_capabilities01",
    ok: true,
    revision: 18,
    result: { revision: 18, capabilityHash: EXPECTED_CAPABILITY_HASH, capabilityManifest: CAPABILITY_MANIFEST },
    error: null,
    pending: { action: "request-capabilities" },
  }));
  assert.equal(controller.snapshot().manifestVerified, true);

  let sent;
  controller.session.snapshot = () => ({
    phase: "ready",
    capabilities: ["command-ack"],
    acceptedScopes: ["polar.control"],
    pendingCommands: 0,
  });
  controller.session.sendCommand = (scope, action, args, options) => {
    sent = { scope, action, args, options };
    return "cmd_nextcommand01";
  };
  controller.send(commandForId("stop-scan"));
  assert.equal(sent.options.expectedRevision, 18);
  await controller.stop();
});

test("command acknowledgements produce bounded current-session latency percentiles", async () => {
  let now = 10_000;
  const controller = new PolarRemoteController({
    transportFactory: (options) => new FakeTransport(options),
    now: () => now,
  });
  await controller.connect({
    room: "polar_room_latency", session: "polar.session-latency",
    transportSecret: "transport-secret-with-adequate-length",
    pairingSecret: "pairing-secret-with-adequate-length",
  });

  const samples = [100, 50, 200, 75, 300];
  samples.forEach((sample, index) => {
    controller.session.dispatchEvent(detailEvent("commandapplied", {
      commandId: `cmd_latency${String(index).padStart(8, "0")}`,
      ok: true,
      revision: index,
      result: { revision: index },
      error: null,
      pending: { action: "request-status", sentAt: now - sample },
    }));
  });
  assert.deepEqual(controller.snapshot().commandLatency, {
    count: 5,
    p50Ms: 100,
    p95Ms: 300,
    p99Ms: 300,
  });

  for (let index = samples.length; index < MAX_LATENCY_SAMPLES + 4; index += 1) {
    controller.session.dispatchEvent(detailEvent("commandapplied", {
      commandId: `cmd_bounded${String(index).padStart(8, "0")}`,
      ok: true,
      revision: index,
      result: { revision: index },
      error: null,
      pending: { action: "request-status", sentAt: now - 10 },
    }));
  }
  assert.equal(controller.snapshot().commandLatency.count, MAX_LATENCY_SAMPLES);
  await controller.stop();
  assert.equal(controller.snapshot().commandLatency.count, 0);
});
