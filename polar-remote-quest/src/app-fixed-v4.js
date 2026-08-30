import { PolarRemoteController } from "./controller.js";
import { humanState, projectDiagnosticPanel } from "./diagnostic.js";
import { deriveBeaconInvitation, PILOT_BEACON_ID } from "./beacon-fixed-v1.js";
import { commandForId, materializeCommand } from "./profile.js";
import { drawEcgPreview } from "./waveform.js";

const requestButton = document.querySelector("#request-control");
const stopButton = document.querySelector("#stop");
const connectionStatus = document.querySelector("#connection-status");
const authentication = document.querySelector("#authentication");
const scopes = document.querySelector("#scopes");
const route = document.querySelector("#route");
const latency = document.querySelector("#latency");
const freshness = document.querySelector("#freshness");
const profileGate = document.querySelector("#profile-gate");
const readinessCard = document.querySelector("#readiness-card");
const readinessTitle = document.querySelector("#readiness-title");
const readinessSummary = document.querySelector("#readiness-summary");
const transportStatus = document.querySelector("#transport-status");
const ecgPreview = document.querySelector("#ecg-preview");
const ecgPreviewStatus = document.querySelector("#ecg-preview-status");
const metrics = document.querySelector("#metrics");
const checklist = document.querySelector("#checklist");
const candidateStatus = document.querySelector("#candidate-status");
const candidates = document.querySelector("#candidates");
const connectSelectedButton = document.querySelector("#connect-selected");
const troubleshootingList = document.querySelector("#troubleshooting-list");
const grantPermissionButton = document.querySelector("#grant-permission");
const rescanButton = document.querySelector("#rescan");
const stopScanButton = document.querySelector("#stop-scan");
const refreshButton = document.querySelector("#refresh-status");
const reconnectButton = document.querySelector("#reconnect");
const disconnectButton = document.querySelector("#disconnect");
const startEcgButton = document.querySelector("#start-ecg");
const stopEcgButton = document.querySelector("#stop-ecg");
const restartEcgButton = document.querySelector("#restart-ecg");
const controlStatus = document.querySelector("#control-status");
const recordingName = document.querySelector("#recording-name");
const startRecordingButton = document.querySelector("#start-recording");
const stopRecordingButton = document.querySelector("#stop-recording");
const recorderStatus = document.querySelector("#recorder-status");
const panelVisibleButton = document.querySelector("#panel-visible");
const revokeButton = document.querySelector("#revoke");
const commandStatus = document.querySelector("#command-status");
const targetState = document.querySelector("#target-state");

function isTopLevelWindow() {
  try { return globalThis.top === globalThis.self; } catch { return false; }
}

const embeddedBlocked = !isTopLevelWindow();
const controller = new PolarRemoteController();
let requestInFlight = false;
let routeValue = "Unknown";
let selectedCandidateKey = null;
let targetCandidateKeySeen = null;
let capabilityRequestSent = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function canSend(id, values = {}) {
  try { return controller.canSend(materializeCommand(id, values)); } catch { return false; }
}

function enable(button, semanticAvailable, id, values = {}) {
  button.disabled = !(semanticAvailable && canSend(id, values));
}

function renderMetrics(items) {
  const nodes = items.map((item) => {
    const row = element("div", "metric");
    row.dataset.tone = item.tone;
    row.append(element("span", "metric-label", item.label), element("span", "metric-value", item.value));
    return row;
  });
  metrics.replaceChildren(...nodes);
}

function renderChecklist(items) {
  const markers = { complete: "[OK]", active: "[..]", attention: "[!!]", pending: "[  ]" };
  const nodes = items.map((item) => {
    const row = element("div", "check");
    row.dataset.state = item.state;
    row.append(
      element("span", "check-marker", markers[item.state]),
      element("span", "check-label", item.label),
      element("span", "check-detail", item.detail),
    );
    return row;
  });
  checklist.replaceChildren(...nodes);
}

function renderTroubleshooting(items) {
  troubleshootingList.replaceChildren(...items.map((item) => element("li", "", item)));
}

function renderCandidates(items, targetSelectedCandidateKey, selectionEnabled) {
  if (targetSelectedCandidateKey !== targetCandidateKeySeen) {
    targetCandidateKeySeen = targetSelectedCandidateKey;
    selectedCandidateKey = items.some((item) => item.candidateKey === targetSelectedCandidateKey && item.connectable)
      ? targetSelectedCandidateKey
      : null;
  }
  if (!items.some((item) => item.candidateKey === selectedCandidateKey && item.connectable)) {
    selectedCandidateKey = items.some((item) => item.candidateKey === targetSelectedCandidateKey && item.connectable)
      ? targetSelectedCandidateKey
      : null;
  }
  const legend = candidates.querySelector("legend") ?? element("legend", "visually-hidden", "Choose a sanitized Polar H10 candidate");
  const nodes = items.map((item) => {
    const option = element("label", "candidate-option");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "polar-candidate";
    input.value = item.candidateKey;
    input.checked = item.candidateKey === selectedCandidateKey;
    input.disabled = !selectionEnabled || !item.connectable;
    input.addEventListener("change", () => {
      if (input.checked) selectedCandidateKey = item.candidateKey;
      render();
    });
    const signal = item.rssiDbm == null ? "" : ` · signal ${item.rssiDbm} dBm`;
    const unavailable = item.connectable ? "" : " · unavailable";
    option.append(input, element("span", "candidate-label", `${item.label}${signal}${unavailable}`));
    return option;
  });
  candidates.replaceChildren(legend, ...nodes);
  const pendingSelection = selectedCandidateKey && selectedCandidateKey !== targetSelectedCandidateKey
    ? " Browser selection is pending; the headset changes only after Connect selected H10."
    : "";
  candidateStatus.textContent = items.length
    ? `${items.length} nearby H10 ${items.length === 1 ? "candidate" : "candidates"}. No device ID or address is shown.${pendingSelection}`
    : "No H10 candidates yet. Automatic scanning continues on the headset.";
}

function send(id, values = {}, output = controlStatus) {
  try {
    const command = materializeCommand(id, values);
    const commandId = controller.send(command);
    output.textContent = `Waiting for target acknowledgement (${commandId.slice(0, 12)}…).`;
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : "Command was not sent.";
  }
}

function maybeRequestCapabilityManifest(snapshot) {
  if (snapshot.phase !== "ready" || capabilityRequestSent || snapshot.manifestVerified) return;
  const command = commandForId("request-capabilities");
  if (!controller.canSend(command)) return;
  capabilityRequestSent = true;
  try {
    const commandId = controller.send(materializeCommand("request-capabilities"));
    connectionStatus.textContent = `Authenticated. Verifying the target control profile (${commandId.slice(0, 12)}…).`;
  } catch (error) {
    connectionStatus.textContent = error instanceof Error ? error.message : "Unable to verify the target profile.";
  }
}

function render(snapshot = controller.snapshot()) {
  const ready = snapshot.phase === "ready";
  const diagnostic = projectDiagnosticPanel(snapshot.state, { remoteReady: ready, stale: snapshot.stale });
  authentication.textContent = ready
    ? (snapshot.profileCompatible && snapshot.manifestVerified
      ? "Mutual proof verified · profile matched"
      : "Authenticated · mutations locked")
    : snapshot.phase;
  scopes.textContent = snapshot.acceptedScopes.length ? snapshot.acceptedScopes.join(", ") : "None";
  route.textContent = snapshot.state.bridge?.connectionRoute ?? routeValue;
  const commandLatency = snapshot.commandLatency;
  latency.textContent = commandLatency?.count
    ? `n=${commandLatency.count} · p50 ${Math.round(commandLatency.p50Ms)} ms · p95 ${Math.round(commandLatency.p95Ms)} ms · p99 ${Math.round(commandLatency.p99Ms)} ms`
    : (snapshot.state.bridge?.rttMs == null ? "Not measured" : `${Math.round(snapshot.state.bridge.rttMs)} ms RTT`);
  freshness.textContent = snapshot.stale ? "Stale — holding last confirmed state" : (ready ? "Current" : "No target state");
  profileGate.textContent = snapshot.manifestVerified && snapshot.profileCompatible
    ? "Current-session manifest and hash verified"
    : (ready ? "Verifying — mutations disabled" : "Not verified");

  readinessCard.dataset.tone = diagnostic.tone;
  readinessTitle.textContent = diagnostic.title;
  readinessSummary.textContent = diagnostic.summary;
  transportStatus.textContent = `Transport: ${diagnostic.transport}`;
  renderMetrics(diagnostic.metrics);
  renderChecklist(diagnostic.checks);
  renderTroubleshooting(diagnostic.troubleshooting);
  renderCandidates(diagnostic.candidates, diagnostic.selectedCandidateKey, diagnostic.controls.candidateSelection);

  const preview = snapshot.state.ecgPreview;
  const ecgStreaming = snapshot.state.polar?.ecg === "streaming";
  drawEcgPreview(ecgPreview, preview, { streaming: ecgStreaming, ready: snapshot.state.polar?.ready === true });
  ecgPreview.setAttribute("aria-label", preview?.values?.length
    ? `Live Polar ECG waveform, ${snapshot.state.polar?.ready ? "ready" : "stabilizing"}`
    : (ecgStreaming ? "Polar ECG stream active, waiting for preview samples" : "Waiting for real Polar ECG samples"));
  ecgPreviewStatus.textContent = preview?.values?.length
    ? `${preview.values.length} newest normalized points · ${preview.sampleRateHz} Hz preview`
    : (ready && snapshot.acceptedScopes.includes("polar.ecg.observe")
      ? "Waiting for a real 130 Hz headset ECG stream."
      : "Not available until the headset grants polar.ecg.observe.");

  grantPermissionButton.disabled = true;
  enable(rescanButton, diagnostic.controls.rescan, "rescan");
  enable(stopScanButton, diagnostic.controls.stopScan, "stop-scan");
  enable(refreshButton, diagnostic.controls.refresh, "request-status");
  enable(reconnectButton, diagnostic.controls.reconnect, "reconnect");
  enable(disconnectButton, diagnostic.controls.disconnect, "disconnect");
  enable(startEcgButton, diagnostic.controls.startEcg, "start-ecg");
  enable(stopEcgButton, diagnostic.controls.stopEcg, "stop-ecg");
  enable(restartEcgButton, diagnostic.controls.restartEcg, "restart-ecg");
  enable(connectSelectedButton, diagnostic.controls.candidateSelection && diagnostic.candidates.some((item) => item.candidateKey === selectedCandidateKey && item.connectable), "connect-candidate", { candidateKey: selectedCandidateKey });
  enable(startRecordingButton, diagnostic.controls.startRecording, "start-recording", { recordingName: recordingName.value });
  enable(stopRecordingButton, diagnostic.controls.stopRecording, "stop-recording");
  recordingName.disabled = diagnostic.recorder?.active === true;
  enable(panelVisibleButton, true, "set-panel-visible", { visible: snapshot.state.panelVisible === false });
  enable(revokeButton, true, "revoke");
  panelVisibleButton.textContent = snapshot.state.panelVisible === false ? "Show headset panel" : "Hide headset panel";

  const recorder = diagnostic.recorder;
  recorderStatus.textContent = recorder == null
    ? "Recorder status unavailable."
    : `${recorder.fault ? `Recording stopped · ${humanState(recorder.fault).replace(/^./u, (letter) => letter.toLowerCase())}` : (recorder.active ? `Recording ${recorder.recordingName ?? "unnamed"}` : "Not recording")} · ${recorder.samplesWritten} samples · queue ${recorder.queuedBatches} · dropped ${recorder.droppedBatches} · ${recorder.durable ? "durable" : "not durable"}`;
  targetState.textContent = JSON.stringify({ revision: snapshot.revision, ...snapshot.state }, null, 2);
  requestButton.disabled = embeddedBlocked || requestInFlight || Boolean(controller.session);
  stopButton.disabled = !controller.session;
  maybeRequestCapabilityManifest(snapshot);
}

rescanButton.addEventListener("click", () => send("rescan"));
stopScanButton.addEventListener("click", () => send("stop-scan"));
refreshButton.addEventListener("click", () => send("request-status"));
reconnectButton.addEventListener("click", () => send("reconnect"));
disconnectButton.addEventListener("click", () => send("disconnect"));
connectSelectedButton.addEventListener("click", () => send("connect-candidate", { candidateKey: selectedCandidateKey }));
startEcgButton.addEventListener("click", () => send("start-ecg"));
stopEcgButton.addEventListener("click", () => send("stop-ecg"));
restartEcgButton.addEventListener("click", () => send("restart-ecg"));
startRecordingButton.addEventListener("click", () => send("start-recording", { recordingName: recordingName.value }, recorderStatus));
stopRecordingButton.addEventListener("click", () => send("stop-recording", {}, recorderStatus));
panelVisibleButton.addEventListener("click", () => send("set-panel-visible", { visible: controller.snapshot().state.panelVisible === false }, commandStatus));
revokeButton.addEventListener("click", () => send("revoke", {}, commandStatus));
recordingName.addEventListener("input", () => render());

controller.addEventListener("change", (event) => render(event.detail));
controller.addEventListener("state", (event) => render(event.detail));
controller.addEventListener("transport", (event) => {
  const message = event.detail.message ?? "Transport status changed.";
  connectionStatus.textContent = controller.snapshot().phase === "ready"
    ? message
    : `${message} If the request appears in the headset, choose Accept or Reject.`;
  render();
});
controller.addEventListener("quality", (event) => {
  const { route: nextRoute = "unknown", rttMs } = event.detail;
  routeValue = rttMs === undefined ? nextRoute : `${nextRoute} (${rttMs} ms RTT)`;
  render();
});
controller.addEventListener("applied", (event) => {
  const { ok, revision, error, commandId, latencyMs, pending } = event.detail;
  const latencySuffix = Number.isFinite(latencyMs) ? ` in ${Math.round(latencyMs)} ms` : "";
  const message = ok
    ? `Applied by target at revision ${revision}${latencySuffix} (${commandId.slice(0, 12)}…).`
    : `Rejected by target: ${error ?? "command_rejected"} (revision ${revision}).`;
  if (["start-recording", "stop-recording"].includes(pending?.action)) recorderStatus.textContent = message;
  else if (["set-panel-visible", "revoke"].includes(pending?.action)) commandStatus.textContent = message;
  else if (pending?.action !== "request-capabilities") controlStatus.textContent = message;
  render();
});
controller.addEventListener("error", (event) => { connectionStatus.textContent = event.detail.message; render(); });

requestButton.addEventListener("click", async () => {
  if (embeddedBlocked || requestInFlight || controller.session) return;
  requestInFlight = true;
  capabilityRequestSent = false;
  selectedCandidateKey = null;
  targetCandidateKeySeen = null;
  connectionStatus.textContent = "Requesting every remotely eligible app scope. Put on the headset and choose Accept or Reject.";
  render();
  try {
    const invitation = await deriveBeaconInvitation(PILOT_BEACON_ID);
    await controller.connect(invitation);
  } catch (error) {
    connectionStatus.textContent = error instanceof Error ? error.message : "Unable to contact the headset.";
  } finally {
    requestInFlight = false;
    render();
  }
});

stopButton.addEventListener("click", async () => {
  await controller.stop();
  requestInFlight = false;
  capabilityRequestSent = false;
  selectedCandidateKey = null;
  targetCandidateKeySeen = null;
  connectionStatus.textContent = "Stopped locally. Request full app control to create a new attended request.";
  controlStatus.textContent = "No sensor command pending.";
  commandStatus.textContent = "No remote-session command pending.";
  routeValue = "Unknown";
  render();
});

window.addEventListener("pagehide", () => { void controller.stop(); }, { once: true });
window.addEventListener("resize", () => {
  const snapshot = controller.snapshot();
  drawEcgPreview(ecgPreview, snapshot.state.ecgPreview, {
    streaming: snapshot.state.polar?.ecg === "streaming",
    ready: snapshot.state.polar?.ready === true,
  });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => {});
}
render();
if (embeddedBlocked) {
  connectionStatus.textContent = "Blocked: open this controller as a top-level page, not inside another website.";
  controlStatus.textContent = "Embedded control is disabled to prevent clickjacking.";
}
