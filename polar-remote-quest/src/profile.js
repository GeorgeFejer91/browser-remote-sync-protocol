export const PROFILE_VERSION = 3;
export const EXPECTED_CAPABILITY_HASH = "c893cc1d6959598d4a3d1cb882d938331c18416d75bfcb8417ff186de81eb074";

export const ECG_PREVIEW_PROFILE = Object.freeze({
  field: "ecgPreview",
  schemaVersion: 1,
  requiredScope: "polar.ecg.observe",
  sensitivity: "sensitive",
  lane: "latest-state",
  format: "normalized-int-v1",
  sourceSampleRateHz: 130,
  previewSampleRateHz: 65,
  maxSamples: 65,
  minimum: -1000,
  maximum: 1000,
  maxPublishRateHz: 10,
});

export const RECORDING_NAME_PROFILE = Object.freeze({
  field: "recorder.recordingName",
  schemaVersion: 1,
  requiredScope: "recording.control",
  sensitivity: "sensitive",
  lane: "latest-state",
  format: "safe-recording-name-v1",
  pattern: "[A-Za-z0-9._-]{1,64}",
});

export const CAPABILITIES = Object.freeze([
  "command-ack",
  "state-snapshot",
  "latest-state",
  "polar-remote-v1",
  "marionette-controls-v1",
]);

export const REQUESTED_SCOPES = Object.freeze([
  "app.observe",
  "polar.ecg.observe",
  "polar.control",
  "recording.control",
  "panel.presentation.write",
  "session.safety",
]);

const manifestEntries = [
  ["request-status", "app.observe", "normal", "always", true],
  ["request-capabilities", "app.observe", "normal", "always", true],
  ["start-scan", "polar.control", "normal", "interactive", true],
  ["stop-scan", "polar.control", "normal", "always", true],
  ["retry-connect", "polar.control", "normal", "interactive", true],
  ["connect-candidate", "polar.control", "normal", "interactive-and-candidate-available", true],
  ["disconnect", "polar.control", "normal", "always", true],
  ["start-ecg", "polar.control", "normal", "interactive-and-connected", true],
  ["stop-ecg", "polar.control", "normal", "always", true],
  ["restart-ecg", "polar.control", "normal", "interactive-and-connected", true],
  ["start-recording", "recording.control", "sensitive", "interactive-and-live-130hz-ecg", true],
  ["stop-recording", "recording.control", "sensitive", "always", true],
  ["set-panel-visible", "panel.presentation.write", "normal", "interactive", true],
  ["revoke", "session.safety", "normal", "always", true],
  ["enable-pairing", null, "headset_only", "headset-local", false],
  ["approve-pairing", null, "headset_only", "headset-local", false],
  ["reject-pairing", null, "headset_only", "headset-local", false],
  ["approve-permissions", null, "headset_only", "headset-local", false],
  ["launch-external", null, "headset_only", "headset-local", false],
];

export const CAPABILITY_MANIFEST = Object.freeze({
  schemaVersion: PROFILE_VERSION,
  entries: Object.freeze(manifestEntries.map(
    ([action, requiredScope, sensitivity, availabilityGuard, remotelyEligible]) => Object.freeze({
      action,
      schemaVersion: 1,
      requiredScope,
      sensitivity,
      availabilityGuard,
      remotelyEligible,
    }),
  )),
  stateProjections: Object.freeze([ECG_PREVIEW_PROFILE, RECORDING_NAME_PROFILE]),
});

/** Fixed, non-executable closed-world command catalog. */
export const COMMANDS = Object.freeze([
  { id: "request-status", scope: "app.observe", action: "request-status", label: "Refresh" },
  { id: "request-capabilities", scope: "app.observe", action: "request-capabilities", label: "Verify controls" },
  { id: "rescan", scope: "polar.control", action: "start-scan", label: "Rescan" },
  { id: "stop-scan", scope: "polar.control", action: "stop-scan", label: "Stop scan" },
  { id: "reconnect", scope: "polar.control", action: "retry-connect", label: "Reconnect" },
  { id: "connect-candidate", scope: "polar.control", action: "connect-candidate", label: "Connect selected" },
  { id: "disconnect", scope: "polar.control", action: "disconnect", label: "Disconnect" },
  { id: "start-ecg", scope: "polar.control", action: "start-ecg", label: "Start ECG" },
  { id: "stop-ecg", scope: "polar.control", action: "stop-ecg", label: "Stop ECG" },
  { id: "restart-ecg", scope: "polar.control", action: "restart-ecg", label: "Restart" },
  { id: "start-recording", scope: "recording.control", action: "start-recording", label: "Start named recording" },
  { id: "stop-recording", scope: "recording.control", action: "stop-recording", label: "Stop recording" },
  { id: "set-panel-visible", scope: "panel.presentation.write", action: "set-panel-visible", label: "Show headset panel" },
  { id: "revoke", scope: "session.safety", action: "revoke", label: "Revoke remote session" },
].map(Object.freeze));

const COMMAND_BY_ID = new Map(COMMANDS.map((command) => [command.id, command]));
const CANDIDATE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,95}$/u;
const RECORDING_NAME = /^[A-Za-z0-9._-]{1,64}$/u;
const STATUS_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;
const HASH = /^[a-f0-9]{64}$/u;
const TRANSPORT_STATES = new Set(["idle", "permission-required", "bluetooth-off", "scanning", "connecting", "connected", "ecg-starting", "ecg-streaming", "error"]);
const READINESS_REASONS = new Set(["permissions-required", "bluetooth-off", "sensor-not-found", "scanning", "connecting", "sensor-disconnected", "ecg-stopped", "waiting-for-samples", "ready", "error"]);
const SCAN_STATES = new Set(["idle", "scanning"]);
const SENSOR_STATES = new Set(["disconnected", "connected"]);
const ECG_STATES = new Set(["stopped", "streaming"]);
const RECORDER_STATES = new Set(["idle", "recording", "fault"]);
const TARGET_INTERACTIONS = new Set(["interactive", "background"]);
const COMMAND_STATUSES = new Set(["none", "applied", "rejected"]);
const CONNECTION_ROUTES = new Set(["unknown", "direct", "relay"]);

export function commandForId(id) {
  return COMMAND_BY_ID.get(id);
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

/** Materialize only the argument shapes declared by the native closed-world profile. */
export function materializeCommand(id, values = {}) {
  const command = commandForId(id);
  if (!command) throw new Error("Unknown companion control.");
  let args = {};
  if (id === "connect-candidate") {
    if (!exactKeys(values, ["candidateKey"]) || !CANDIDATE_KEY.test(values.candidateKey)) {
      throw new Error("Select a current Polar candidate before connecting.");
    }
    args = { candidateKey: values.candidateKey };
  } else if (id === "start-recording") {
    if (!exactKeys(values, ["recordingName"]) || !RECORDING_NAME.test(values.recordingName)) {
      throw new Error("Recording name must be 1–64 letters, numbers, dots, underscores, or hyphens.");
    }
    args = { recordingName: values.recordingName };
  } else if (id === "set-panel-visible") {
    if (!exactKeys(values, ["visible"]) || typeof values.visible !== "boolean") {
      throw new Error("Panel visibility must be true or false.");
    }
    args = { visible: values.visible };
  } else if (!exactKeys(values, [])) {
    throw new Error("This control accepts no arguments.");
  }
  return Object.freeze({ ...command, args: Object.freeze(args) });
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function nullableInteger(value, minimum, maximum) {
  return value === null || integer(value, minimum, maximum);
}

function statusCode(value, maximum) {
  return typeof value === "string" && value.length <= maximum && STATUS_CODE.test(value);
}

function sanitizeCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (!CANDIDATE_KEY.test(value.candidateKey)
    || typeof value.label !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$/u.test(value.label)
    || !nullableInteger(value.rssiDbm, -127, 20)
    || typeof value.connectable !== "boolean") return undefined;
  return Object.freeze({ candidateKey: value.candidateKey, label: value.label, rssiDbm: value.rssiDbm, connectable: value.connectable });
}

function sanitizePolar(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidates = Array.isArray(value.candidates)
    ? value.candidates.slice(0, 8).map(sanitizeCandidate).filter(Boolean)
    : [];
  const selectedCandidateKey = value.selectedCandidateKey;
  if (typeof value.permissionsGranted !== "boolean"
    || typeof value.bluetoothPowered !== "boolean"
    || !TRANSPORT_STATES.has(value.transportState)
    || !(value.transportDetail === null || statusCode(value.transportDetail, 64))
    || !READINESS_REASONS.has(value.readinessReason)
    || !(value.readinessDetail === null || statusCode(value.readinessDetail, 64))
    || !SCAN_STATES.has(value.scan)
    || !SENSOR_STATES.has(value.sensor)
    || !ECG_STATES.has(value.ecg)
    || !nullableInteger(value.heartRateBpm, 0, 255)
    || !nullableInteger(value.rrIntervalMs, 0, 60_000)
    || !integer(value.rrIntervalCount)
    || !nullableInteger(value.sampleRateHz, 1, 1_000)
    || !nullableInteger(value.resolutionBits, 1, 32)
    || !integer(value.sampleCount)
    || !nullableInteger(value.lastSampleAgeMs, 0, 600_000)
    || typeof value.ready !== "boolean"
    || !(value.lastDiagnosticStage === null || statusCode(value.lastDiagnosticStage, 48))
    || !(value.lastDiagnosticError === null || statusCode(value.lastDiagnosticError, 96))
    || !Array.isArray(value.candidates)
    || value.candidates.length > 8
    || candidates.length !== value.candidates.length
    || !(selectedCandidateKey === null || CANDIDATE_KEY.test(selectedCandidateKey))) return undefined;
  return Object.freeze({
    permissionsGranted: value.permissionsGranted,
    bluetoothPowered: value.bluetoothPowered,
    transportState: value.transportState,
    transportDetail: value.transportDetail,
    readinessReason: value.readinessReason,
    readinessDetail: value.readinessDetail,
    scan: value.scan,
    sensor: value.sensor,
    ecg: value.ecg,
    heartRateBpm: value.heartRateBpm,
    rrIntervalMs: value.rrIntervalMs,
    rrIntervalCount: value.rrIntervalCount,
    sampleRateHz: value.sampleRateHz,
    resolutionBits: value.resolutionBits,
    sampleCount: value.sampleCount,
    lastSampleAgeMs: value.lastSampleAgeMs,
    ready: value.ready,
    lastDiagnosticStage: value.lastDiagnosticStage,
    lastDiagnosticError: value.lastDiagnosticError,
    candidates: Object.freeze(candidates),
    selectedCandidateKey,
  });
}

function sanitizeRecorder(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const includesRecordingName = Object.hasOwn(value, "recordingName");
  if (!RECORDER_STATES.has(value.state)
    || typeof value.active !== "boolean"
    || (includesRecordingName && !(value.recordingName === null || RECORDING_NAME.test(value.recordingName)))
    || typeof value.durable !== "boolean"
    || !integer(value.samplesWritten)
    || !integer(value.queuedBatches, 0, 4_096)
    || !integer(value.droppedBatches)
    || !(value.fault === null || statusCode(value.fault, 96))) return undefined;
  const output = { state: value.state, active: value.active, samplesWritten: value.samplesWritten, queuedBatches: value.queuedBatches, droppedBatches: value.droppedBatches, durable: value.durable, fault: value.fault };
  if (includesRecordingName) output.recordingName = value.recordingName;
  return Object.freeze(output);
}

function sanitizeBridge(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (typeof value.listenerReady !== "boolean"
    || typeof value.controllerConnected !== "boolean"
    || !COMMAND_STATUSES.has(value.lastCommandStatus)
    || !CONNECTION_ROUTES.has(value.connectionRoute)
    || !nullableInteger(value.rttMs, 0, 60_000)) return undefined;
  return Object.freeze({ listenerReady: value.listenerReady, controllerConnected: value.controllerConnected, lastCommandStatus: value.lastCommandStatus, connectionRoute: value.connectionRoute, rttMs: value.rttMs });
}

function sanitizeEcgPreview(value) {
  if (value === null) return null;
  if (!exactKeys(value, ["format", "sampleRateHz", "values"])) return undefined;
  if (value.format !== ECG_PREVIEW_PROFILE.format
    || value.sampleRateHz !== ECG_PREVIEW_PROFILE.previewSampleRateHz
    || !Array.isArray(value.values)
    || value.values.length > ECG_PREVIEW_PROFILE.maxSamples
    || !value.values.every((sample) => Number.isInteger(sample)
      && sample >= ECG_PREVIEW_PROFILE.minimum
      && sample <= ECG_PREVIEW_PROFILE.maximum)) return undefined;
  return Object.freeze({ format: value.format, sampleRateHz: value.sampleRateHz, values: Object.freeze([...value.values]) });
}

/** Do not render participant, full-rate ECG, pairing, or arbitrary target fields. */
export function sanitizeRemoteState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  if (integer(value.revision)) output.revision = value.revision;
  if (typeof value.panelVisible === "boolean") output.panelVisible = value.panelVisible;
  if (TARGET_INTERACTIONS.has(value.targetInteraction)) output.targetInteraction = value.targetInteraction;
  if (typeof value.capabilityHash === "string" && HASH.test(value.capabilityHash)) output.capabilityHash = value.capabilityHash;
  const polar = sanitizePolar(value.polar);
  if (polar) output.polar = polar;
  const recorder = sanitizeRecorder(value.recorder);
  if (recorder) output.recorder = recorder;
  const bridge = sanitizeBridge(value.bridge);
  if (bridge) output.bridge = bridge;
  const preview = sanitizeEcgPreview(value.ecgPreview);
  if (preview !== undefined) output.ecgPreview = preview;
  return output;
}

/** Scope-aware defense in depth for browser rendering. */
export function redactStateForScopes(value, acceptedScopes = []) {
  const output = { ...value };
  if (!acceptedScopes.includes("app.observe")) {
    delete output.revision;
    delete output.panelVisible;
    delete output.targetInteraction;
    delete output.capabilityHash;
    delete output.polar;
    delete output.recorder;
    delete output.bridge;
  }
  if (!acceptedScopes.includes(RECORDING_NAME_PROFILE.requiredScope) && output.recorder) {
    const { recordingName: omitted, ...recorder } = output.recorder;
    output.recorder = recorder;
  }
  if (!acceptedScopes.includes(ECG_PREVIEW_PROFILE.requiredScope)) delete output.ecgPreview;
  return output;
}
