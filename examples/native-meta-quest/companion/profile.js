import { canonicalStringify } from "../../../src/brsp.js";

export const PROFILE_VERSION = 1;
export const PROFILE_CAPABILITIES = Object.freeze([
  "command-ack",
  "latest-state",
  "native-meta-quest-v1",
  "state-snapshot",
]);
export const REQUESTED_SCOPES = Object.freeze([
  "app.observe",
  "panel.presentation.write",
  "session.safety",
]);

const rows = [
  ["request-status", "app.observe", "normal", "always", true],
  ["request-capabilities", "app.observe", "normal", "always", true],
  ["set-interaction-mode", "panel.presentation.write", "normal", "interactive", true],
  ["set-panel-visible", "panel.presentation.write", "normal", "interactive", true],
  ["recenter-panel", "panel.presentation.write", "normal", "interactive", true],
  ["revoke", "session.safety", "normal", "always", true],
  ["enable-browser-remote", null, "headset_only", "headset-local", false],
  ["approve-controller", null, "headset_only", "headset-local", false],
  ["approve-runtime-permissions", null, "headset_only", "headset-local", false],
];

export const CAPABILITY_MANIFEST = deepFreeze({
  schemaVersion: PROFILE_VERSION,
  entries: rows.map(([action, requiredScope, sensitivity, availabilityGuard, remotelyEligible]) => ({
    action,
    schemaVersion: 1,
    requiredScope,
    sensitivity,
    availabilityGuard,
    remotelyEligible,
  })),
});

// SHA-256 of BRSP project-specific canonical JSON for CAPABILITY_MANIFEST.
export const EXPECTED_CAPABILITY_HASH = "a6baeaa8727b13c316f733909fb30297183308ec3fe4eda3ef0c8a9c0376cc20";

export const COMMAND_CATALOG = deepFreeze([
  { action: "request-status", scope: "app.observe", args: "none", label: "Refresh status" },
  { action: "request-capabilities", scope: "app.observe", args: "none", label: "Verify controls" },
  { action: "set-interaction-mode", scope: "panel.presentation.write", args: "interaction-mode", label: "Interaction mode" },
  { action: "set-panel-visible", scope: "panel.presentation.write", args: "panel-visible", label: "Panel visibility" },
  { action: "recenter-panel", scope: "panel.presentation.write", args: "none", label: "Recenter panel" },
  { action: "revoke", scope: "session.safety", args: "none", label: "Revoke remote" },
]);

/** Build only a command in the fixed profile. No manifest field becomes code or a native method name. */
export function commandFromProfile(action, args = {}) {
  const definition = COMMAND_CATALOG.find((candidate) => candidate.action === action);
  if (!definition || !exactArgs(definition.args, args)) throw new TypeError("unsupported profile command");
  return Object.freeze({ action: definition.action, scope: definition.scope, args: deepFreeze(cloneJson(args)) });
}

export function matchesPinnedManifest(value) {
  try {
    return canonicalStringify(value) === canonicalStringify(CAPABILITY_MANIFEST);
  } catch {
    return false;
  }
}

/**
 * Mutating UI stays disabled until ready, scope/capability negotiation succeeds,
 * and the exact native manifest/hash have been observed for this connection.
 */
export function canSendProfileCommand({
  command,
  phase,
  negotiatedCapabilities = [],
  acceptedScopes = [],
  manifestVerified = false,
  capabilityHash = "",
  pendingCommands = 0,
}) {
  const definition = COMMAND_CATALOG.find(
    (candidate) => candidate.action === command?.action
      && candidate.scope === command?.scope
      && exactArgs(candidate.args, command?.args),
  );
  if (!definition) return false;
  if (phase !== "ready" || !negotiatedCapabilities.includes("command-ack")) return false;
  if (!acceptedScopes.includes(command.scope) || pendingCommands >= 8) return false;
  if (["request-status", "request-capabilities"].includes(definition.action)) return true;
  return manifestVerified && capabilityHash === EXPECTED_CAPABILITY_HASH;
}

const stateRules = Object.freeze({
  revision: (value) => Number.isSafeInteger(value) && value >= 0,
  targetInteraction: (value) => ["interactive", "background"].includes(value),
  interactionMode: (value) => ["pointer", "direct"].includes(value),
  panelVisible: (value) => typeof value === "boolean",
  panelAnchorRevision: (value) => Number.isSafeInteger(value) && value >= 0,
  appPhase: (value) => typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/u.test(value),
  connectionRoute: (value) => ["unknown", "direct", "relay"].includes(value),
  rttMs: (value) => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 60_000),
  capabilityHash: (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value),
});

/** Project only reviewed coarse target state; unknown/private fields are dropped. */
export function sanitizeRemoteState(value) {
  if (!isPlainRecord(value)) return Object.freeze({});
  const output = {};
  for (const [name, validator] of Object.entries(stateRules)) {
    if (Object.hasOwn(value, name) && validator(value[name])) output[name] = value[name];
  }
  return Object.freeze(output);
}

function exactArgs(kind, value) {
  if (!isPlainRecord(value)) return false;
  if (kind === "none") return exactKeys(value, []);
  if (kind === "interaction-mode") {
    return exactKeys(value, ["mode"]) && ["pointer", "direct"].includes(value.mode);
  }
  if (kind === "panel-visible") {
    return exactKeys(value, ["visible"]) && typeof value.visible === "boolean";
  }
  return false;
}

function exactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
