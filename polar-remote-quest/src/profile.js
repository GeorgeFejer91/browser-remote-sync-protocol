export const PROFILE_VERSION = 2;
export const EXPECTED_CAPABILITY_HASH = "57a1c7aaf41abbcbb355c41c459e8b3d12bd62041296f3b1283021a246913f2a";

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

export const CAPABILITIES = Object.freeze([
  "command-ack",
  "state-snapshot",
  "latest-state",
  "polar-remote-v1",
]);

export const REQUESTED_SCOPES = Object.freeze([
  "app.observe",
  "polar.ecg.observe",
  "polar.control",
  "panel.presentation.write",
  "session.safety",
]);

const manifestEntries = [
  ["request-status", "app.observe", "normal", "always", true],
  ["request-capabilities", "app.observe", "normal", "always", true],
  ["start-scan", "polar.control", "normal", "interactive", true],
  ["stop-scan", "polar.control", "normal", "always", true],
  ["retry-connect", "polar.control", "normal", "interactive", true],
  ["disconnect", "polar.control", "normal", "always", true],
  ["start-ecg", "polar.control", "normal", "interactive-and-connected", true],
  ["stop-ecg", "polar.control", "normal", "always", true],
  ["set-panel-visible", "panel.presentation.write", "normal", "interactive", true],
  ["revoke", "session.safety", "normal", "always", true],
  ["enable-pairing", null, "headset_only", "headset-local", false],
  ["approve-pairing", null, "headset_only", "headset-local", false],
  ["approve-permissions", null, "headset_only", "headset-local", false],
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
  stateProjections: Object.freeze([ECG_PREVIEW_PROFILE]),
});

/** Fixed, non-executable closed-world command catalog. */
export const COMMANDS = Object.freeze([
  { id: "request-status", scope: "app.observe", action: "request-status", label: "Request status" },
  { id: "request-capabilities", scope: "app.observe", action: "request-capabilities", label: "Verify capabilities" },
  { id: "start-scan", scope: "polar.control", action: "start-scan", label: "Start Polar scan" },
  { id: "stop-scan", scope: "polar.control", action: "stop-scan", label: "Stop Polar scan" },
  { id: "retry-connect", scope: "polar.control", action: "retry-connect", label: "Retry Polar connection" },
  { id: "disconnect", scope: "polar.control", action: "disconnect", label: "Disconnect Polar" },
  { id: "start-ecg", scope: "polar.control", action: "start-ecg", label: "Start ECG" },
  { id: "stop-ecg", scope: "polar.control", action: "stop-ecg", label: "Stop ECG" },
  {
    id: "set-panel-visible",
    scope: "panel.presentation.write",
    action: "set-panel-visible",
    label: "Show remote panel",
    args: Object.freeze({ visible: true }),
  },
  { id: "revoke", scope: "session.safety", action: "revoke", label: "Revoke remote session" },
]);

export function commandForId(id) {
  return COMMANDS.find((command) => command.id === id);
}

const SAFE_STATE_KEYS = new Set([
  "revision", "phase", "polarState", "scanState", "ecgState", "panelVisible",
  "interactionMode", "connectionRoute", "capabilityHash", "remoteActive",
  "targetInteraction", "scan", "sensor", "ecg", "rttMs",
]);

function sanitizeEcgPreview(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "format,sampleRateHz,values") return undefined;
  if (value.format !== ECG_PREVIEW_PROFILE.format
    || value.sampleRateHz !== ECG_PREVIEW_PROFILE.previewSampleRateHz
    || !Array.isArray(value.values)
    || value.values.length > ECG_PREVIEW_PROFILE.maxSamples
    || !value.values.every((sample) => Number.isInteger(sample)
      && sample >= ECG_PREVIEW_PROFILE.minimum
      && sample <= ECG_PREVIEW_PROFILE.maximum)) return undefined;
  return Object.freeze({
    format: value.format,
    sampleRateHz: value.sampleRateHz,
    values: Object.freeze([...value.values]),
  });
}

/** Reject participant, raw/full-rate ECG, pairing, and arbitrary target fields. */
export function sanitizeRemoteState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const key of Object.keys(value)) {
    if (key === ECG_PREVIEW_PROFILE.field) {
      const preview = sanitizeEcgPreview(value[key]);
      if (preview !== undefined) output[key] = preview;
      continue;
    }
    if (!SAFE_STATE_KEYS.has(key)) continue;
    const item = value[key];
    if (item === null || typeof item === "boolean" || typeof item === "string"
      || (typeof item === "number" && Number.isFinite(item))) output[key] = item;
  }
  return output;
}
