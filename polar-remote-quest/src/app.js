import { PolarRemoteController } from "./controller.js";
import { COMMANDS } from "./profile.js";
import {
  clearRememberedBeacon,
  deriveBeaconInvitation,
  formatBeaconId,
  loadRememberedBeacon,
  normalizeBeaconId,
  storeRememberedBeacon,
} from "./beacon.js";
import { drawEcgPreview } from "./waveform.js";

const beaconForm = document.querySelector("#beacon-form");
const beaconInput = document.querySelector("#beacon-id");
const rememberBeacon = document.querySelector("#remember-beacon");
const findButton = document.querySelector("#find-headset");
const requestButton = document.querySelector("#request-control");
const stopButton = document.querySelector("#stop");
const connectionStatus = document.querySelector("#connection-status");
const commandStatus = document.querySelector("#command-status");
const commands = document.querySelector("#commands");
const authentication = document.querySelector("#authentication");
const scopes = document.querySelector("#scopes");
const route = document.querySelector("#route");
const latency = document.querySelector("#latency");
const freshness = document.querySelector("#freshness");
const targetState = document.querySelector("#target-state");
const ecgCanvas = document.querySelector("#ecg-chart");
const ecgStatus = document.querySelector("#ecg-status");
const controller = new PolarRemoteController();

let preparedInvitation;
let routeValue = "Unknown";
let commandButtons = [];

function render(snapshot = controller.snapshot()) {
  const ready = snapshot.phase === "ready";
  authentication.textContent = ready
    ? (snapshot.profileCompatible ? "Mutual proof verified · profile matched" : "Authenticated · profile mismatch (mutations locked)")
    : snapshot.phase;
  scopes.textContent = snapshot.acceptedScopes.length ? snapshot.acceptedScopes.join(", ") : "None";
  route.textContent = routeValue;
  const commandLatency = snapshot.commandLatency;
  latency.textContent = commandLatency?.count
    ? `n=${commandLatency.count} · p50 ${Math.round(commandLatency.p50Ms)} ms · p95 ${Math.round(commandLatency.p95Ms)} ms · p99 ${Math.round(commandLatency.p99Ms)} ms`
    : "Not measured";
  freshness.textContent = snapshot.stale ? "Stale — holding last confirmed state" : (ready ? "Current" : "No target state");
  targetState.textContent = JSON.stringify({ revision: snapshot.revision, ...snapshot.state }, null, 2);
  findButton.disabled = Boolean(controller.session);
  requestButton.disabled = !preparedInvitation || Boolean(controller.session);
  stopButton.disabled = !controller.session;
  commandButtons.forEach(({ command, button }) => {
    button.disabled = !controller.canSend(command);
    if (command.action === "set-panel-visible") {
      button.textContent = snapshot.state.panelVisible === false ? "Show Polar controls" : "Hide Polar controls";
    }
  });
  const preview = snapshot.state.ecgPreview;
  drawEcgPreview(ecgCanvas, preview);
  ecgStatus.textContent = preview?.values?.length
    ? `${preview.values.length} newest normalized points · ${preview.sampleRateHz} Hz preview`
    : (ready && snapshot.acceptedScopes.includes("polar.ecg.observe")
      ? "Waiting for a real 130 Hz headset ECG stream."
      : "Not available until the headset locally grants polar.ecg.observe.");
  ecgCanvas.setAttribute("aria-label", preview?.values?.length
    ? `Live ECG activity preview with ${preview.values.length} normalized points`
    : "No ECG activity preview received");
  if (ready) connectionStatus.textContent = "Connected and accepted by the headset.";
}

for (const command of COMMANDS) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = command.label;
  button.disabled = true;
  button.addEventListener("click", () => {
    try {
      const effectiveCommand = command.action === "set-panel-visible"
        ? { ...command, args: { visible: controller.snapshot().state.panelVisible === false } }
        : command;
      const commandId = controller.send(effectiveCommand);
      commandStatus.textContent = `Waiting for target acknowledgement (${commandId.slice(0, 12)}…).`;
    } catch (error) {
      commandStatus.textContent = error instanceof Error ? error.message : "Command was not sent.";
    }
  });
  commands.append(button);
  commandButtons.push({ command, button });
}

controller.addEventListener("change", (event) => render(event.detail));
controller.addEventListener("state", (event) => render(event.detail));
controller.addEventListener("transport", (event) => {
  const message = event.detail.message ?? "Transport status changed.";
  connectionStatus.textContent = controller.snapshot().phase === "ready"
    ? message
    : `${message} If a request appears in the headset, choose Accept or Reject.`;
  render();
});
controller.addEventListener("quality", (event) => {
  const { route: nextRoute = "unknown", rttMs } = event.detail;
  routeValue = rttMs === undefined ? nextRoute : `${nextRoute} (${rttMs} ms RTT)`;
  render();
});
controller.addEventListener("applied", (event) => {
  const { ok, revision, error, commandId, latencyMs } = event.detail;
  const latencySuffix = Number.isFinite(latencyMs) ? ` in ${Math.round(latencyMs)} ms` : "";
  commandStatus.textContent = ok
    ? `Applied by target at revision ${revision}${latencySuffix} (${commandId.slice(0, 12)}…).`
    : `Rejected by target: ${error ?? "command_rejected"} (revision ${revision}).`;
  render();
});
controller.addEventListener("error", (event) => {
  connectionStatus.textContent = `${event.detail.message} The headset may have rejected or closed the request.`;
  render();
});

beaconForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const normalized = normalizeBeaconId(beaconInput.value);
    preparedInvitation = await deriveBeaconInvitation(normalized);
    beaconInput.value = formatBeaconId(normalized);
    if (rememberBeacon.checked) storeRememberedBeacon(normalized);
    else clearRememberedBeacon();
    connectionStatus.textContent = "Beacon address resolved. Press Request control to contact the headset.";
  } catch (error) {
    preparedInvitation = undefined;
    connectionStatus.textContent = error instanceof Error ? error.message : "Beacon ID is invalid.";
  }
  render();
});

requestButton.addEventListener("click", async () => {
  if (!preparedInvitation) return;
  const invitation = preparedInvitation;
  preparedInvitation = undefined;
  connectionStatus.textContent = "Requesting control. Put on the headset and choose Accept or Reject.";
  render();
  try {
    await controller.connect(invitation);
  } catch (error) {
    connectionStatus.textContent = error instanceof Error ? error.message : "Unable to contact the headset.";
    render();
  }
});

stopButton.addEventListener("click", async () => {
  await controller.stop();
  preparedInvitation = undefined;
  connectionStatus.textContent = "Stopped locally. Find the headset again to create a new request.";
  commandStatus.textContent = "No command pending.";
  routeValue = "Unknown";
  render();
});

window.addEventListener("pagehide", () => { void controller.stop(); }, { once: true });
window.addEventListener("resize", () => drawEcgPreview(ecgCanvas, controller.snapshot().state.ecgPreview));

const rememberedBeacon = loadRememberedBeacon();
if (rememberedBeacon) {
  beaconInput.value = formatBeaconId(rememberedBeacon);
  rememberBeacon.checked = true;
  connectionStatus.textContent = "Public Beacon ID restored. Press Find headset; no connection has started.";
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => {});
}
render();
