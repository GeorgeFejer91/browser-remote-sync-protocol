import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CAPABILITY_MANIFEST,
  COMMANDS,
  ECG_PREVIEW_PROFILE,
  EXPECTED_CAPABILITY_HASH,
  RECORDING_NAME_PROFILE,
  REQUESTED_SCOPES,
  materializeCommand,
  redactStateForScopes,
  sanitizeRemoteState,
} from "../src/profile.js";
import { canonicalStringify } from "../../src/brsp.js";

function remoteState(overrides = {}) {
  return {
    revision: 12,
    panelVisible: true,
    targetInteraction: "interactive",
    capabilityHash: EXPECTED_CAPABILITY_HASH,
    polar: {
      permissionsGranted: true,
      bluetoothPowered: true,
      transportState: "ecg-streaming",
      transportDetail: "ecg-streaming",
      readinessReason: "ready",
      readinessDetail: "ready",
      scan: "idle",
      sensor: "connected",
      ecg: "streaming",
      ready: true,
      heartRateBpm: 64,
      rrIntervalMs: 938,
      rrIntervalCount: 3,
      sampleRateHz: 130,
      resolutionBits: 14,
      sampleCount: 520,
      lastSampleAgeMs: 120,
      candidates: [{ candidateKey: "candidate:01", label: "Polar H10 1", rssiDbm: -51, connectable: true }],
      selectedCandidateKey: "candidate:01",
      lastDiagnosticStage: "samples",
      lastDiagnosticError: null,
    },
    recorder: {
      state: "recording",
      active: true,
      recordingName: "study6-run_01",
      samplesWritten: 520,
      queuedBatches: 0,
      droppedBatches: 0,
      durable: true,
      fault: null,
    },
    bridge: {
      listenerReady: true,
      controllerConnected: true,
      lastCommandStatus: "applied",
      connectionRoute: "direct",
      rttMs: 28,
    },
    ecgPreview: { format: "normalized-int-v1", sampleRateHz: 65, values: [-1000, 0, 1000] },
    ...overrides,
  };
}

test("closed command catalog contains each approved typed action once", () => {
  assert.deepEqual(REQUESTED_SCOPES, [
    "app.observe", "polar.ecg.observe", "polar.control", "recording.control",
    "panel.presentation.write", "session.safety",
  ]);
  assert.deepEqual(COMMANDS.map(({ action }) => action), [
    "request-status", "request-capabilities", "start-scan", "stop-scan", "retry-connect",
    "connect-candidate", "disconnect", "start-ecg", "stop-ecg", "restart-ecg",
    "start-recording", "stop-recording", "set-panel-visible", "revoke",
  ]);
  assert.equal(new Set(COMMANDS.map(({ action }) => action)).size, COMMANDS.length);
});

test("browser profile pins the exact native manifest and projections", () => {
  const hash = createHash("sha256").update(canonicalStringify(CAPABILITY_MANIFEST)).digest("hex");
  assert.equal(hash, EXPECTED_CAPABILITY_HASH);
  assert.equal(hash, "c893cc1d6959598d4a3d1cb882d938331c18416d75bfcb8417ff186de81eb074");
  assert.equal(CAPABILITY_MANIFEST.schemaVersion, 3);
  assert.equal(CAPABILITY_MANIFEST.entries.length, 19);
  assert.deepEqual(CAPABILITY_MANIFEST.stateProjections, [ECG_PREVIEW_PROFILE, RECORDING_NAME_PROFILE]);
  assert.deepEqual(
    CAPABILITY_MANIFEST.entries.filter(({ remotelyEligible }) => remotelyEligible).map(({ action }) => action),
    COMMANDS.map(({ action }) => action),
  );
  assert.deepEqual(
    CAPABILITY_MANIFEST.entries.filter(({ sensitivity }) => sensitivity === "headset_only").map(({ action }) => action),
    ["enable-pairing", "approve-pairing", "reject-pairing", "approve-permissions", "launch-external"],
  );
});

test("command materialization enforces exact native argument objects", () => {
  assert.deepEqual(materializeCommand("rescan").args, {});
  assert.deepEqual(materializeCommand("rescan").action, "start-scan");
  assert.deepEqual(materializeCommand("connect-candidate", { candidateKey: "candidate:01" }).args, { candidateKey: "candidate:01" });
  assert.deepEqual(materializeCommand("start-recording", { recordingName: "study6-run_01" }).args, { recordingName: "study6-run_01" });
  assert.deepEqual(materializeCommand("set-panel-visible", { visible: false }).args, { visible: false });
  assert.throws(() => materializeCommand("connect-candidate", { candidateKey: "short" }));
  assert.throws(() => materializeCommand("connect-candidate", { candidateKey: "candidate:01", extra: true }));
  assert.throws(() => materializeCommand("start-recording", { recordingName: "contains space" }));
  assert.throws(() => materializeCommand("start-recording", { recordingName: "x".repeat(65) }));
  assert.throws(() => materializeCommand("restart-ecg", { unexpected: true }));
  assert.throws(() => materializeCommand("launch-external"), /Unknown companion control/u);
});

test("state sanitizer admits the exact bounded nested native projection", () => {
  const valid = remoteState();
  assert.deepEqual(sanitizeRemoteState(valid), valid);
  assert.equal(Object.isFrozen(sanitizeRemoteState(valid).polar.candidates), true);
});

test("state sanitizer excludes private fields and malformed nested values", () => {
  const valid = remoteState({ rawEcg: [1, 2], participantId: "P-1", pairingSecret: "nope" });
  valid.polar.polarDeviceId = "not-for-browser";
  valid.recorder.privatePath = "/private/file.csv";
  valid.bridge.roomSecret = "nope";
  const sanitized = sanitizeRemoteState(valid);
  assert.equal(Object.hasOwn(sanitized, "rawEcg"), false);
  assert.equal(Object.hasOwn(sanitized.polar, "polarDeviceId"), false);
  assert.equal(Object.hasOwn(sanitized.recorder, "privatePath"), false);
  assert.equal(Object.hasOwn(sanitized.bridge, "roomSecret"), false);

  const tooMany = remoteState();
  tooMany.polar.candidates = Array.from({ length: 9 }, (_, index) => ({
    candidateKey: `candidate:${String(index).padStart(2, "0")}`,
    label: `Polar H10 ${index}`,
    rssiDbm: -50,
    connectable: true,
  }));
  assert.equal(Object.hasOwn(sanitizeRemoteState(tooMany), "polar"), false);
});

test("ECG and recording-name fields are independently scope-redacted", () => {
  const sanitized = sanitizeRemoteState(remoteState());
  const observeOnly = redactStateForScopes(sanitized, ["app.observe"]);
  assert.equal(Object.hasOwn(observeOnly, "ecgPreview"), false);
  assert.equal(Object.hasOwn(observeOnly.recorder, "recordingName"), false);
  const all = redactStateForScopes(sanitized, ["app.observe", "polar.ecg.observe", "recording.control"]);
  assert.deepEqual(all.ecgPreview.values, [-1000, 0, 1000]);
  assert.equal(all.recorder.recordingName, "study6-run_01");
  assert.deepEqual(redactStateForScopes(sanitized, []), {});
});

test("ECG renderer admits only the exact normalized latest-state field", () => {
  const valid = remoteState();
  assert.deepEqual(sanitizeRemoteState(valid).ecgPreview, valid.ecgPreview);
  assert.equal(Object.hasOwn(sanitizeRemoteState({ ecgPreview: { ...valid.ecgPreview, rawMicrovolts: [12] } }), "ecgPreview"), false);
  assert.equal(Object.hasOwn(sanitizeRemoteState({ ecgPreview: { ...valid.ecgPreview, sampleRateHz: 130 } }), "ecgPreview"), false);
  assert.equal(Object.hasOwn(sanitizeRemoteState({ ecgPreview: { ...valid.ecgPreview, values: [1001] } }), "ecgPreview"), false);
  assert.equal(Object.hasOwn(sanitizeRemoteState({ ecgPreview: { ...valid.ecgPreview, values: Array(66).fill(0) } }), "ecgPreview"), false);
});
