import {
  BRSPConnection,
  BRSP_RECOVERY_FRAMES,
  BRSP_STALE_MS,
  randomToken,
} from "../../src/brsp.js";
import {
  VdoNinjaTransport,
  generateVdoRoomId,
} from "../../src/vdo-ninja-transport.js";
import {
  clearSessionMaterial,
  resolveSessionMaterial,
  showSessionMaterial,
} from "./session-material.js";

const $ = (selector) => document.querySelector(selector);
const controls = ["x", "y", "hue", "scale", "pulse"].map((id) => $(`#${id}`));
const elements = {
  sdkState: $("#sdk-state"),
  room: $("#room"),
  secret: $("#secret"),
  forceTurn: $("#force-turn"),
  start: $("#start"),
  stop: $("#stop"),
  setupHelp: $("#setup-help"),
  setupError: $("#setup-error"),
  transportBadge: $("#transport-badge"),
  authBadge: $("#auth-badge"),
  routeBadge: $("#route-badge"),
  status: $("#status-live"),
  sessionValues: $("#session-values"),
  roomReadback: $("#room-readback"),
  secretReadback: $("#secret-readback"),
  revision: $("#revision"),
  orb: $("#orb"),
  holdLabel: $("#hold-label"),
  controlMode: $("#control-mode"),
  reset: $("#reset"),
  log: $("#log"),
  clearLog: $("#clear-log"),
};

const DEFAULT_SCENE = Object.freeze({ x: 0, y: 0, hue: 205, scale: 1, pulse: true });
let role = "target";
let state = { revision: 0, scene: { ...DEFAULT_SCENE } };
let transport;
let connection;
let heartbeatTimer;
let staleTimer;
let pendingControllerScene;
let pendingCommandId;
let intentFrame;
let stale = false;
let recoveryFrames = 0;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function normalizeScene(value = {}) {
  return {
    x: clamp(value.x, -1, 1),
    y: clamp(value.y, -1, 1),
    hue: Math.round(clamp(value.hue, 0, 360)),
    scale: clamp(value.scale, 0.6, 1.5),
    pulse: value.pulse === true,
  };
}

function validateScene(value, label = "scene") {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const keys = Object.keys(value).sort();
  const expected = ["hue", "pulse", "scale", "x", "y"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly x, y, hue, scale, and pulse.`);
  }
  for (const key of ["x", "y", "hue", "scale"]) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
      throw new TypeError(`${label}.${key} must be a finite number.`);
    }
  }
  if (typeof value.pulse !== "boolean") throw new TypeError(`${label}.pulse must be boolean.`);
  if (value.x < -1 || value.x > 1 || value.y < -1 || value.y > 1
    || value.hue < 0 || value.hue > 360 || value.scale < 0.6 || value.scale > 1.5) {
    throw new RangeError(`${label} contains an out-of-range value.`);
  }
  return { x: value.x, y: value.y, hue: Math.round(value.hue), scale: value.scale, pulse: value.pulse };
}

function validateRemoteState(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join(",") !== "revision,scene"
    || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("Remote state must contain exactly a non-negative revision and scene.");
  }
  return { revision: value.revision, scene: validateScene(value.scene, "remote state.scene") };
}

function appendLog(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  elements.log.append(item);
  while (elements.log.children.length > 12) elements.log.firstElementChild.remove();
}

function badge(element, text, tone = "neutral") {
  element.textContent = text;
  element.className = `badge ${tone}`;
}

function renderScene(next = state) {
  state = {
    revision: Number.isSafeInteger(next.revision) ? next.revision : state.revision,
    scene: normalizeScene(next.scene),
  };
  const { scene } = state;
  elements.orb.style.setProperty("--x", scene.x);
  elements.orb.style.setProperty("--y", scene.y);
  elements.orb.style.setProperty("--hue", scene.hue);
  elements.orb.style.setProperty("--scale", scene.scale);
  elements.orb.classList.toggle("pulse", scene.pulse);
  elements.revision.textContent = `revision ${state.revision}`;
  $("#x-output").value = scene.x.toFixed(2);
  $("#y-output").value = scene.y.toFixed(2);
  $("#hue-output").value = `${scene.hue}°`;
  $("#scale-output").value = scene.scale.toFixed(2);
  for (const control of controls) {
    const value = scene[control.id];
    if (control.type === "checkbox") control.checked = value;
    else control.value = value;
  }
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  elements.setupError.textContent = message;
  elements.setupError.hidden = false;
  elements.status.textContent = message;
  badge(elements.transportBadge, "Transport error", "error");
  appendLog(`ERROR ${message}`);
}

function currentRole() {
  return document.querySelector('input[name="role"]:checked').value;
}

function updateRoleUi() {
  role = currentRole();
  elements.start.textContent = role === "target" ? "Start target" : "Start controller";
  elements.setupHelp.textContent = role === "target"
    ? "Starting a target generates a room and a 192-bit secret if either field is empty. Share both values through a separate trusted channel."
    : "Paste the exact room and secret shown by the target. The secret is used by VDO.Ninja and by the BRSP mutual-proof handshake.";
  elements.controlMode.textContent = role === "target"
    ? "Target changes are authoritative and are sent back to the controller."
    : "Controller sliders send scoped live intent; Reset is an acknowledged command. The target’s returned state remains authoritative.";
}

function localSceneFromControls() {
  return normalizeScene({
    x: $("#x").value,
    y: $("#y").value,
    hue: $("#hue").value,
    scale: $("#scale").value,
    pulse: $("#pulse").checked,
  });
}

function applyTargetScene(scene) {
  state = { revision: state.revision + 1, scene: normalizeScene(scene) };
  renderScene();
  connection?.publishState(state, { revision: state.revision });
}

function scheduleControllerScene(scene) {
  pendingControllerScene = normalizeScene(scene);
  if (intentFrame === undefined) intentFrame = requestAnimationFrame(flushControllerIntent);
}

function flushControllerIntent() {
  intentFrame = undefined;
  if (role !== "controller" || connection?.phase !== "ready" || pendingCommandId || !pendingControllerScene) return;
  const scene = pendingControllerScene;
  pendingControllerScene = undefined;
  try {
    connection.publishIntent(
      "scene.write",
      { scene },
    );
  } catch (error) {
    showError(error);
  }
}

async function start() {
  if (connection) return;
  elements.setupError.hidden = true;
  role = currentRole();
  const { room, secret } = resolveSessionMaterial({
    role,
    room: elements.room.value,
    secret: elements.secret.value,
    generateRoom: generateVdoRoomId,
    generateSecret: () => randomToken(24),
  });
  if (room.length < 8 || new TextEncoder().encode(secret).byteLength < 16) {
    showError("Enter the target’s room and a pairing secret of at least 16 UTF-8 bytes.");
    return;
  }

  elements.start.disabled = true;
  elements.stop.disabled = false;
  document.querySelectorAll('input[name="role"]').forEach((input) => { input.disabled = true; });
  elements.room.disabled = true;
  elements.secret.disabled = true;
  elements.forceTurn.disabled = true;
  showSessionMaterial(elements, { room, secret });
  badge(elements.transportBadge, "Connecting", "wait");

  transport = new VdoNinjaTransport({
    role,
    room,
    sharedSecret: secret,
    label: "BRSP demo target",
    forceTurn: elements.forceTurn.checked,
  });
  connection = new BRSPConnection({
    transport,
    role,
    sessionId: room,
    sharedSecret: secret,
    peerId: `${role}_${randomToken(12)}`,
    capabilities: ["command-ack", "state-snapshot", "latest-state", "latest-intent"],
    requestedScopes: role === "controller" ? ["scene.write"] : [],
    grantedScopes: role === "target" ? ["scene.write"] : [],
    getState: () => ({ revision: state.revision, scene: { ...state.scene } }),
    applyCommand: ({ action, args, expectedRevision }) => {
      if (expectedRevision !== null && expectedRevision !== state.revision) {
        return { ok: false, revision: state.revision, error: "revision_conflict" };
      }
      if (action === "set-scene") {
        state = { revision: state.revision + 1, scene: validateScene(args.scene, "command args.scene") };
      } else if (action === "reset") {
        state = { revision: state.revision + 1, scene: { ...DEFAULT_SCENE } };
      } else {
        return { ok: false, revision: state.revision, error: "unsupported_command" };
      }
      renderScene();
      return { ok: true, revision: state.revision, result: { scene: state.scene } };
    },
    applyIntent: ({ controls: incoming }) => {
      if (incoming === null || typeof incoming !== "object" || Array.isArray(incoming)
        || Object.getPrototypeOf(incoming) !== Object.prototype
        || Object.keys(incoming).join(",") !== "scene") {
        throw new TypeError("Intent controls must contain exactly scene.");
      }
      state = { revision: state.revision + 1, scene: validateScene(incoming.scene, "intent controls.scene") };
      renderScene();
      return { revision: state.revision, state: { revision: state.revision, scene: { ...state.scene } } };
    },
  });

  transport.addEventListener("status", (event) => {
    elements.status.textContent = event.detail.message;
    if (event.detail.error) badge(elements.transportBadge, "Transport warning", "error");
    else if (["peer-open", "discoverable"].includes(event.detail.phase)) badge(elements.transportBadge, event.detail.phase, "live");
    else badge(elements.transportBadge, event.detail.phase, "wait");
    appendLog(`Transport: ${event.detail.message}`);
  });
  transport.addEventListener("quality", (event) => {
    const { route, rttMs } = event.detail;
    badge(elements.routeBadge, `${route}${Number.isFinite(rttMs) ? ` · ${rttMs} ms` : ""}`, route === "unknown" ? "neutral" : "live");
  });
  connection.addEventListener("phasechange", (event) => {
    elements.status.textContent = event.detail.message;
    const tone = event.detail.phase === "ready" ? "live" : event.detail.phase === "error" ? "error" : "wait";
    badge(elements.authBadge, event.detail.phase, tone);
    appendLog(`BRSP: ${event.detail.message}`);
  });
  connection.addEventListener("ready", () => {
    badge(elements.authBadge, "Mutually authenticated", "live");
    heartbeatTimer = role === "target"
      ? setInterval(() => connection?.publishState(state, { revision: state.revision }), 250)
      : undefined;
    if (role === "controller") {
      staleTimer = setInterval(checkStale, 250);
      flushControllerIntent();
    }
  });
  connection.addEventListener("snapshot", (event) => acceptRemoteState(event.detail));
  connection.addEventListener("state", (event) => acceptRemoteState(event.detail));
  connection.addEventListener("commandapplied", (event) => {
    if (event.detail.commandId === pendingCommandId) pendingCommandId = undefined;
    if (!event.detail.ok) {
      state.revision = event.detail.revision;
      appendLog(`Command rejected: ${event.detail.error}; target revision is ${event.detail.revision}.`);
    } else {
      appendLog(`Command applied at revision ${event.detail.revision}.`);
    }
    flushControllerIntent();
  });
  connection.addEventListener("backpressure", () => appendLog("Live state backpressured; obsolete state was replaced by the newest offer."));
  connection.addEventListener("protocolerror", (event) => showError(event.detail.message));

  try {
    await transport.start();
  } catch (error) {
    showError(error);
  }
}

function acceptRemoteState(remote) {
  if (role !== "controller") return;
  let accepted;
  try {
    accepted = validateRemoteState({ revision: remote.revision, scene: remote.state?.scene });
  } catch (error) {
    showError(error);
    return;
  }
  if (stale) {
    recoveryFrames += 1;
    if (recoveryFrames >= BRSP_RECOVERY_FRAMES) {
      stale = false;
      recoveryFrames = 0;
      elements.holdLabel.hidden = true;
      appendLog("Live state recovered after three consecutive accepted frames.");
    }
  }
  renderScene(accepted);
}

function checkStale() {
  if (!connection?.isStateStale(performance.now(), BRSP_STALE_MS) || stale) return;
  stale = true;
  recoveryFrames = 0;
  elements.holdLabel.hidden = false;
  appendLog("No valid state for two seconds; holding the last accepted scene.");
}

async function stop() {
  clearInterval(heartbeatTimer);
  clearInterval(staleTimer);
  heartbeatTimer = undefined;
  staleTimer = undefined;
  if (intentFrame !== undefined) cancelAnimationFrame(intentFrame);
  intentFrame = undefined;
  const active = connection;
  connection = undefined;
  transport = undefined;
  clearSessionMaterial(elements);
  try { await active?.close(); } catch { /* teardown remains local and final */ }
  elements.start.disabled = false;
  elements.stop.disabled = true;
  document.querySelectorAll('input[name="role"]').forEach((input) => { input.disabled = false; });
  elements.room.disabled = false;
  elements.secret.disabled = false;
  elements.forceTurn.disabled = false;
  badge(elements.transportBadge, "Transport idle", "neutral");
  badge(elements.authBadge, "Not authenticated", "neutral");
  badge(elements.routeBadge, "Route unknown", "neutral");
  elements.status.textContent = "Stopped. Reloading still never reconnects automatically.";
  elements.holdLabel.hidden = true;
  pendingCommandId = undefined;
  pendingControllerScene = undefined;
  stale = false;
}

for (const input of document.querySelectorAll('input[name="role"]')) input.addEventListener("change", updateRoleUi);
for (const control of controls) {
  control.addEventListener("input", () => {
    const scene = localSceneFromControls();
    if (role === "target") applyTargetScene(scene);
    else scheduleControllerScene(scene);
  });
}
elements.reset.addEventListener("click", () => {
  if (role === "target") applyTargetScene(DEFAULT_SCENE);
  else if (connection?.phase === "ready" && !pendingCommandId) {
    pendingControllerScene = { ...DEFAULT_SCENE };
    pendingCommandId = connection.sendCommand("scene.write", "reset", {}, { expectedRevision: null });
  } else {
    pendingControllerScene = { ...DEFAULT_SCENE };
  }
});
elements.start.addEventListener("click", () => { void start(); });
elements.stop.addEventListener("click", () => { void stop(); });
elements.clearLog.addEventListener("click", () => { elements.log.replaceChildren(); });
window.addEventListener("pagehide", () => { void stop(); }, { once: true });

renderScene();
updateRoleUi();
elements.sdkState.textContent = typeof globalThis.VDONinjaSDK === "function" ? "SDK ready" : "SDK loading";
