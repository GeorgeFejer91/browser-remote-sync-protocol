import assert from "node:assert/strict";
import test from "node:test";
import { formatFreshness, humanState, projectDiagnosticPanel } from "../src/diagnostic.js";

function readyState() {
  return {
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
      state: "recording", active: true, recordingName: "study6-run_01", samplesWritten: 520,
      queuedBatches: 0, droppedBatches: 0, durable: false, fault: null,
    },
    bridge: {
      listenerReady: true, controllerConnected: true, lastCommandStatus: "applied",
      connectionRoute: "direct", rttMs: 22,
    },
  };
}

test("diagnostic projection preserves Study 6 ready semantics and inventory", () => {
  const view = projectDiagnosticPanel(readyState(), { remoteReady: true });
  assert.equal(view.title, "Polar H10 ECG ready");
  assert.equal(view.tone, "good");
  assert.equal(view.metrics.length, 12);
  assert.equal(view.checks.length, 11);
  assert.deepEqual(view.metrics.map(({ label }) => label), [
    "Heart rate", "RR interval", "ECG stream", "Resolution", "Samples received", "Last sample",
    "Recording", "Recorded samples", "Writer queue", "Dropped batches", "Nearby H10s", "Latest BLE stage",
  ]);
  assert.equal(view.metrics.find(({ label }) => label === "Last sample").value, "120 ms ago");
  assert.equal(view.checks.find(({ key }) => key === "writer").state, "complete");
  assert.deepEqual(view.troubleshooting, ["No troubleshooting action is required. Keep the app open while controlling it."]);
  assert.equal(view.controls.connectCandidate, false);
  assert.equal(view.controls.candidateSelection, false);
  assert.equal(view.controls.startRecording, false);
  assert.equal(view.controls.stopRecording, true);
});

test("permission and stale states remain actionable without exposing a remote permission command", () => {
  const missing = readyState();
  missing.polar.permissionsGranted = false;
  missing.polar.ready = false;
  const permissionView = projectDiagnosticPanel(missing, { remoteReady: true });
  assert.equal(permissionView.title, "Nearby devices permission needed");
  assert.equal(permissionView.tone, "warning");
  assert.equal(permissionView.controls.rescan, false);
  assert.match(permissionView.troubleshooting[0], /headset/u);

  const staleView = projectDiagnosticPanel(readyState(), { remoteReady: true, stale: true });
  assert.equal(staleView.title, "Polar H10 ECG ready", "transport staleness must not rewrite the headset sensor verdict");
  assert.equal(staleView.tone, "good");
  assert.equal(staleView.checks.find(({ key }) => key === "fresh").state, "complete");
});

test("recording availability matches native live 130 Hz precondition without redefining sensor readiness", () => {
  const stopped = readyState();
  stopped.recorder = { state: "idle", active: false, recordingName: null, samplesWritten: 0, queuedBatches: 0, droppedBatches: 0, durable: false, fault: null };
  let view = projectDiagnosticPanel(stopped, { remoteReady: true });
  assert.equal(view.title, "Polar H10 ECG ready");
  assert.equal(view.checks.find(({ key }) => key === "writer").state, "active");
  assert.equal(view.controls.startRecording, true);

  stopped.polar.sampleRateHz = 100;
  view = projectDiagnosticPanel(stopped, { remoteReady: true });
  assert.equal(view.controls.startRecording, false);

  stopped.polar.transportState = "idle";
  stopped.polar.transportDetail = "h10-not-found-retrying";
  stopped.polar.readinessReason = "sensor-not-found";
  stopped.polar.readinessDetail = "sensor-not-found";
  stopped.polar.sensor = "disconnected";
  stopped.polar.ready = false;
  stopped.polar.candidates = [];
  assert.equal(projectDiagnosticPanel(stopped).title, "Searching for Polar H10");
  assert.equal(projectDiagnosticPanel(stopped).transport, "H10 Not Found Retrying");

  stopped.polar.transportDetail = "rescan-requested";
  stopped.polar.readinessReason = "scanning";
  stopped.polar.readinessDetail = "waiting-for-sensor";
  const rescan = projectDiagnosticPanel(stopped);
  assert.equal(rescan.title, "Rescan Requested");
  assert.equal(rescan.checks.find(({ key }) => key === "fresh").detail, "Waiting For Sensor");
});

test("human labels and freshness formatting are deterministic", () => {
  assert.equal(humanState("waiting-for_samples"), "Waiting For Samples");
  assert.equal(formatFreshness(null), "No samples");
  assert.equal(formatFreshness(999), "999 ms ago");
  assert.equal(formatFreshness(6_234), "6.2 s ago");
});

test("an active lossy recorder keeps Stop authority while surfacing the fault first", () => {
  const state = readyState();
  state.recorder.droppedBatches = 1;
  state.recorder.fault = "recording-data-loss";
  const view = projectDiagnosticPanel(state, { remoteReady: true });

  assert.equal(view.metrics.find(({ label }) => label === "Recording").value, "Recording Data Loss");
  assert.equal(view.controls.startRecording, false);
  assert.equal(view.controls.stopRecording, true);
  assert.equal(view.checks.find(({ key }) => key === "writer").state, "attention");
});

test("diagnostic recovery and initial tone exactly mirror the headset panel", () => {
  const state = readyState();
  state.polar.ready = false;
  state.polar.sensor = "disconnected";
  state.polar.ecg = "stopped";
  state.polar.candidates = [];
  state.polar.transportState = "idle";
  state.polar.transportDetail = "scan-stopped";
  state.polar.lastDiagnosticError = "scan-failed";
  let view = projectDiagnosticPanel(state, { remoteReady: true });
  assert.equal(view.controls.reconnect, true);

  state.polar.lastDiagnosticError = null;
  state.polar.transportDetail = "not-started";
  view = projectDiagnosticPanel(state, { remoteReady: true });
  assert.equal(view.tone, "muted");
});
