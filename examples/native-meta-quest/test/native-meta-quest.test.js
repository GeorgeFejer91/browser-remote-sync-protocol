import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CAPABILITY_MANIFEST,
  COMMAND_CATALOG,
  EXPECTED_CAPABILITY_HASH,
  canSendProfileCommand,
  commandFromProfile,
  matchesPinnedManifest,
  sanitizeRemoteState,
} from "../companion/profile.js";
import { QuestTargetTransportLifecycle } from "../webview/transport-lifecycle.js";
import { canonicalStringify } from "../../../src/brsp.js";

const exampleRoot = fileURLToPath(new URL("../", import.meta.url));

test("native Quest capability fixture and companion profile are byte-stable", async () => {
  const fixture = await jsonFixture("capability-manifest-v1.json");
  assert.deepEqual(CAPABILITY_MANIFEST, fixture);
  assert.equal(matchesPinnedManifest(fixture), true);
  assert.equal(matchesPinnedManifest({ ...fixture, schemaVersion: 2 }), false);

  const hash = createHash("sha256").update(canonicalStringify(fixture)).digest("hex");
  assert.equal(hash, EXPECTED_CAPABILITY_HASH);
  assert.equal(hash, "a6baeaa8727b13c316f733909fb30297183308ec3fe4eda3ef0c8a9c0376cc20");

  const actions = fixture.entries.map((entry) => entry.action);
  assert.equal(new Set(actions).size, actions.length);
  assert.deepEqual(
    COMMAND_CATALOG.map((entry) => entry.action),
    fixture.entries.filter((entry) => entry.remotelyEligible).map((entry) => entry.action),
  );
  assert.ok(fixture.entries.filter((entry) => !entry.remotelyEligible).every(
    (entry) => entry.sensitivity === "headset_only" && entry.requiredScope === null,
  ));
});

test("companion builds only exact fixed commands and never headset-only actions", async () => {
  const fixture = await jsonFixture("commands-v1.json");
  for (const candidate of fixture.valid) {
    assert.deepEqual(commandFromProfile(candidate.action, candidate.args), candidate);
  }
  for (const candidate of fixture.invalid) {
    assert.throws(() => commandFromProfile(candidate.action, candidate.args), /unsupported profile command/u);
  }
  assert.throws(() => commandFromProfile("set-panel-visible", { visible: 1 }), /unsupported/u);
  assert.throws(() => commandFromProfile("recenter-panel", Object.create({ inherited: true })), /unsupported/u);
});

test("mutations require current-session manifest/hash while observation bootstraps verification", () => {
  const status = commandFromProfile("request-status", {});
  const mutate = commandFromProfile("set-interaction-mode", { mode: "direct" });
  const base = {
    phase: "ready",
    negotiatedCapabilities: ["command-ack"],
    acceptedScopes: ["app.observe", "panel.presentation.write"],
    pendingCommands: 0,
  };
  assert.equal(canSendProfileCommand({ ...base, command: status }), true);
  assert.equal(canSendProfileCommand({ ...base, command: mutate }), false);
  assert.equal(canSendProfileCommand({
    ...base,
    command: mutate,
    manifestVerified: true,
    capabilityHash: EXPECTED_CAPABILITY_HASH,
  }), true);
  assert.equal(canSendProfileCommand({
    ...base,
    command: mutate,
    manifestVerified: true,
    capabilityHash: "0".repeat(64),
  }), false);
  assert.equal(canSendProfileCommand({
    ...base,
    command: { ...mutate, args: { mode: "gaze" } },
    manifestVerified: true,
    capabilityHash: EXPECTED_CAPABILITY_HASH,
  }), false);
});

test("remote-state projection drops secrets, participant data, raw sensors, and malformed values", async () => {
  const fixture = await jsonFixture("remote-state-v1.json");
  const projected = sanitizeRemoteState({
    ...fixture,
    participantId: "private",
    pairingSecret: "private",
    rawSensorSamples: [1, 2, 3],
    exportPath: "/private/file",
  });
  assert.deepEqual(projected, fixture);
  assert.deepEqual(sanitizeRemoteState({
    revision: -1,
    targetInteraction: "sleeping",
    interactionMode: "arbitrary",
    panelVisible: "yes",
    rttMs: 60_001,
    capabilityHash: "not-a-hash",
  }), {});
});

test("transport lifecycle is inert until explicit configure and fences old generations", async () => {
  const endpoint = createEndpoint();
  const transports = [];
  const lifecycle = new QuestTargetTransportLifecycle({
    endpoint,
    transportFactory: () => {
      const transport = new FakeTransport();
      transports.push(transport);
      return transport;
    },
  });
  assert.deepEqual(lifecycle.snapshot(), { generation: null, active: false, operation: 0 });
  assert.equal(transports.length, 0);

  assert.equal(await lifecycle.configure(configuration(1)), true);
  const first = transports[0];
  first.emit("peeropen", { peerKey: "peer-first" });
  assert.deepEqual(endpoint.opened, [[1, "peer-first"]]);

  assert.equal(await lifecycle.configure(configuration(2)), true);
  assert.equal(first.stopCalls, 1);
  first.emit("controlmessage", { peerKey: "peer-first", data: "{}" });
  first.emit("peerclose", { peerKey: "peer-first" });
  assert.equal(endpoint.inbound.length, 0);
  assert.equal(endpoint.closed.length, 0);
  assert.deepEqual(lifecycle.snapshot(), { generation: 2, active: true, operation: 2 });
});

test("rejected/oversized ingress explicitly closes native peer authority exactly once", async () => {
  const endpoint = createEndpoint({ inboundResult: "rejected" });
  const transport = new FakeTransport();
  const lifecycle = new QuestTargetTransportLifecycle({ endpoint, transportFactory: () => transport });
  await lifecycle.configure(configuration(8));

  transport.emit("controlmessage", { peerKey: "peer-controller", data: "{}" });
  transport.emit("peerclose", { peerKey: "peer-controller" });
  assert.deepEqual(endpoint.closed, [[8, "peer-controller"]]);
  assert.deepEqual(transport.closedPeers, ["peer-controller"]);

  transport.emit("peeropen", { peerKey: "peer-controller" });
  transport.emit("statemessage", { peerKey: "peer-controller", data: "x".repeat(8_193) });
  assert.deepEqual(endpoint.closed, [[8, "peer-controller"], [8, "peer-controller"]]);
  assert.deepEqual(transport.closedPeers, ["peer-controller", "peer-controller"]);
});

test("reliable outbound backpressure fails closed", async () => {
  const endpoint = createEndpoint();
  const transport = new FakeTransport();
  transport.controlAccepted = false;
  const lifecycle = new QuestTargetTransportLifecycle({ endpoint, transportFactory: () => transport });
  await lifecycle.configure(configuration(11));

  assert.equal(lifecycle.receive("control", "peer-controller", "{}"), false);
  assert.deepEqual(transport.closedPeers, ["peer-controller"]);
  assert.deepEqual(endpoint.closed, [[11, "peer-controller"]]);
  assert.deepEqual(endpoint.diagnostics, [[11, "error", "unknown", -1]]);
  assert.equal(lifecycle.receive("unknown", "peer-controller", "{}"), false);
});

test("Stop clears generation/ownership before delayed signaling cleanup completes", async () => {
  const endpoint = createEndpoint();
  let finishStop;
  const transport = new FakeTransport();
  transport.stopBarrier = new Promise((resolve) => { finishStop = resolve; });
  const lifecycle = new QuestTargetTransportLifecycle({ endpoint, transportFactory: () => transport });
  await lifecycle.configure(configuration(21));

  const stopping = lifecycle.stop();
  assert.deepEqual(lifecycle.snapshot(), { generation: null, active: false, operation: 2 });
  transport.emit("controlmessage", { peerKey: "late-peer", data: "{}" });
  assert.equal(endpoint.inbound.length, 0);
  finishStop();
  await stopping;
  assert.equal(transport.stopCalls, 1);
});

test("Android/Kotlin fragments preserve the declared native authority boundary", async () => {
  const [manifest, webView, service, contract, router, owner] = await Promise.all([
    source("android/AndroidManifest.xml"),
    source("android/BundledWebViewTransport.kt"),
    source("android/RemoteSessionService.kt"),
    source("kotlin/QuestActionContract.kt"),
    source("kotlin/QuestActionRouter.kt"),
    source("android/RemoteSessionOwner.kt"),
  ]);

  assert.match(manifest, /android:exported="false"/u);
  assert.match(manifest, /<receiver/u);
  assert.match(manifest, /android:usesCleartextTraffic="false"/u);
  assert.doesNotMatch(manifest, /CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|MANAGE_EXTERNAL_STORAGE|RECEIVE_BOOT_COMPLETED/u);
  assert.match(service, /class RemoteStopReceiver : BroadcastReceiver/u);
  assert.doesNotMatch(service, /startForeground|startActivity|BOOT_COMPLETED/u);

  for (const guard of [
    /settings\.allowFileAccess = false/u,
    /settings\.allowContentAccess = false/u,
    /MIXED_CONTENT_NEVER_ALLOW/u,
    /WebViewAssetLoader/u,
    /activeGeneration/u,
    /JSONObject\.quote\(payload\)/u,
  ]) assert.match(webView, guard);
  assert.match(webView, /addJavascriptInterface\(JsEndpoint\(\), JS_ENDPOINT_NAME\)/u);
  assert.doesNotMatch(webView, /pairingSecret|android\.content\.Intent/u);

  const kotlinEntries = [...contract.matchAll(/CapabilityManifestEntry\("([a-z-]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(kotlinEntries, CAPABILITY_MANIFEST.entries.map((entry) => entry.action));
  const decoder = contract.slice(contract.indexOf("object QuestActionCodec"));
  assert.doesNotMatch(decoder, /enable-browser-remote|approve-controller|approve-runtime-permissions/u);
  assert.match(router, /authority\.dispatch\(request\.action\)/u);
  assert.match(router, /target_not_interactive/u);
  assert.match(router, /deduplication_conflict/u);
  assert.match(owner, /onSpatialShutdown\(\) = release\(\)/u);
  assert.match(owner, /onActivityDestroyed\(\) = release\(\)/u);
  assert.match(owner, /activityResumed && vrReady/u);

  const privilegedPatterns = /Class\.forName|java\.lang\.reflect|Runtime\.getRuntime|ProcessBuilder|ACTION_VIEW|dispatchKeyEvent/u;
  assert.doesNotMatch(`${contract}\n${router}\n${owner}\n${webView}`, privilegedPatterns);
});

function configuration(generation) {
  return { room: `QuestRoom_${String(generation).padStart(3, "0")}`, transportSecret: "A".repeat(43), generation };
}

function createEndpoint({ inboundResult = "accepted" } = {}) {
  return {
    opened: [],
    closed: [],
    inbound: [],
    diagnostics: [],
    peerOpened(generation, peerKey) { this.opened.push([generation, peerKey]); return "accepted"; },
    peerClosed(generation, peerKey) { this.closed.push([generation, peerKey]); return "accepted"; },
    postInbound(generation, lane, peerKey, data) {
      this.inbound.push([generation, lane, peerKey, data]);
      return inboundResult;
    },
    transportDiagnostic(generation, kind, route, rttMs) {
      this.diagnostics.push([generation, kind, route, rttMs]);
    },
  };
}

class FakeTransport extends EventTarget {
  constructor() {
    super();
    this.startCalls = 0;
    this.stopCalls = 0;
    this.closedPeers = [];
    this.controlAccepted = true;
    this.stateAccepted = true;
    this.stopBarrier = undefined;
  }

  async start() { this.startCalls += 1; }
  async stop() { this.stopCalls += 1; await this.stopBarrier; }
  sendControl() { return this.controlAccepted; }
  sendState() { return this.stateAccepted; }
  closePeer(peerKey) { this.closedPeers.push(peerKey); }
  emit(type, detail) { this.dispatchEvent(detailEvent(type, detail)); }
}

function detailEvent(type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail, enumerable: true });
  return event;
}

async function jsonFixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
}

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}
