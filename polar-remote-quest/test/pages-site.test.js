import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildPages } from "../../scripts/build-pages.mjs";
import { canonicalStringify } from "../../src/brsp.js";
import {
  BEACON_STORAGE_KEY,
  clearRememberedBeacon,
  deriveBeaconInvitation,
  formatBeaconId,
  loadRememberedBeacon,
  normalizeBeaconId,
  PILOT_BEACON_ID,
  storeRememberedBeacon,
} from "../src/beacon-fixed-v1.js";
import { PolarRemoteController } from "../src/controller.js";
import {
  CAPABILITY_MANIFEST,
  ECG_PREVIEW_PROFILE,
  EXPECTED_CAPABILITY_HASH,
  RECORDING_NAME_PROFILE,
  REQUESTED_SCOPES,
  sanitizeRemoteState,
} from "../src/profile.js";

const root = resolve(import.meta.dirname, "../..");

test("public Beacon IDs normalize and derive the native profile fields exactly", async () => {
  const id = "0123456789abcdef01234567";
  assert.equal(normalizeBeaconId("0123-4567 89AB-CDEF 0123-4567"), id);
  assert.equal(formatBeaconId(id), "0123-4567-89AB-CDEF-0123-4567");
  assert.throws(() => normalizeBeaconId("001122"), /exactly 24 hexadecimal/u);
  assert.throws(() => normalizeBeaconId(`${id}cc`), /exactly 24 hexadecimal/u);
  assert.throws(() => normalizeBeaconId("z0112233445566778899aabb"), /exactly 24 hexadecimal/u);

  const invitation = await deriveBeaconInvitation(id);
  assert.deepEqual(invitation, {
    beaconId: id,
    room: `prq_${id}`,
    session: `prq.session.${id}`,
    transportSecret: "7Qb6iCFxQzN3zIdB-MUVTIxcKuS32W6bdiRnQTw6IlY",
    pairingSecret: "pAswMU3GCtYuydaEAvmtvx6a0qL4v3ZdhWaaI-5HLSY",
  });
  assert.ok(Object.isFrozen(invitation));
});

test("fixed pilot channel matches the native compiled fixture", async () => {
  assert.equal(PILOT_BEACON_ID, "504f4c415252454d4f544531");
  assert.deepEqual(await deriveBeaconInvitation(PILOT_BEACON_ID), {
    beaconId: PILOT_BEACON_ID,
    room: "prq_504f4c415252454d4f544531",
    session: "prq.session.504f4c415252454d4f544531",
    transportSecret: "_yTesUkZr8x1J78VZvL_U-ihTy8G0rY-MP2RpVH74mI",
    pairingSecret: "VWHMQ_55XaHcO9zxWz7unOCcDYS1vIrln8F4dTJeojs",
  });
});

test("persistence stores only the normalized public Beacon ID", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const id = "00112233445566778899aabb";
  storeRememberedBeacon("0011-2233-4455-6677-8899-AABB", storage);
  assert.deepEqual([...values.entries()], [[BEACON_STORAGE_KEY, id]]);
  assert.equal(loadRememberedBeacon(storage), id);
  clearRememberedBeacon(storage);
  assert.equal(values.size, 0);
});

test("Pages profile pins the exact native v3 manifest and sensitive projections", () => {
  assert.deepEqual(REQUESTED_SCOPES, [
    "app.observe", "polar.ecg.observe", "polar.control", "recording.control",
    "panel.presentation.write", "session.safety",
  ]);
  assert.equal(CAPABILITY_MANIFEST.schemaVersion, 3);
  assert.equal(CAPABILITY_MANIFEST.entries.length, 19);
  assert.equal(
    CAPABILITY_MANIFEST.entries.find(({ action }) => action === "start-recording").availabilityGuard,
    "interactive-and-live-130hz-ecg",
  );
  assert.deepEqual(CAPABILITY_MANIFEST.stateProjections, [ECG_PREVIEW_PROFILE, RECORDING_NAME_PROFILE]);
  assert.equal(
    createHash("sha256").update(canonicalStringify(CAPABILITY_MANIFEST)).digest("hex"),
    EXPECTED_CAPABILITY_HASH,
  );
  assert.equal(EXPECTED_CAPABILITY_HASH, "c893cc1d6959598d4a3d1cb882d938331c18416d75bfcb8417ff186de81eb074");

  const valid = { format: "normalized-int-v1", sampleRateHz: 65, values: [-1000, 0, 1000] };
  assert.deepEqual(sanitizeRemoteState({ ecgPreview: valid }), { ecgPreview: valid });
  assert.deepEqual(sanitizeRemoteState({ ecgPreview: null }), { ecgPreview: null });
  assert.deepEqual(sanitizeRemoteState({ ecgPreview: { ...valid, rawMicrovolts: [12] } }), {});
  assert.deepEqual(sanitizeRemoteState({ ecgPreview: { ...valid, sampleRateHz: 130 } }), {});
  assert.deepEqual(sanitizeRemoteState({ ecgPreview: { ...valid, values: [1001] } }), {});
  assert.deepEqual(sanitizeRemoteState({ ecgPreview: { ...valid, values: Array(66).fill(0) } }), {});
});

test("ECG preview requires its negotiated scope and survives reliable projections", () => {
  const sessionFor = (acceptedScopes) => ({
    snapshot: () => ({ phase: "ready", acceptedScopes, capabilities: [], pendingCommands: 0 }),
    isStateStale: () => false,
  });
  const preview = { format: "normalized-int-v1", sampleRateHz: 65, values: [-1000, 0, 1000] };
  const controller = new PolarRemoteController();
  controller.session = sessionFor(["polar.ecg.observe"]);
  controller.acceptConfirmed({ revision: 4, state: { revision: 4, ecg: "streaming", ecgPreview: preview } }, { replaceEcgPreview: true });
  assert.deepEqual(controller.snapshot().state.ecgPreview, preview);
  controller.acceptConfirmed({ revision: 5, state: { revision: 5, ecg: "streaming" } });
  assert.deepEqual(controller.snapshot().state.ecgPreview, preview);
  controller.acceptConfirmed({ revision: 5, state: { revision: 5, ecg: "stopped", ecgPreview: null } }, { replaceEcgPreview: true });
  assert.equal(controller.snapshot().state.ecgPreview, null);
  controller.session = sessionFor(["app.observe"]);
  controller.acceptConfirmed({ revision: 6, state: { revision: 6, ecgPreview: preview } }, { replaceEcgPreview: true });
  assert.equal(Object.hasOwn(controller.snapshot().state, "ecgPreview"), false);
});

test("GitHub Pages mirror keeps activation, approval, privacy, and shared-asset boundaries", async () => {
  const [html, app, beacon, worker, workflow, styles, versionedStyles, diagnostic] = await Promise.all([
    readFile(join(root, "polar-remote-quest/index.html"), "utf8"),
    readFile(join(root, "polar-remote-quest/src/app-fixed-v4.js"), "utf8"),
    readFile(join(root, "polar-remote-quest/src/beacon-fixed-v1.js"), "utf8"),
    readFile(join(root, "polar-remote-quest/sw.js"), "utf8"),
    readFile(join(root, ".github/workflows/pages.yml"), "utf8"),
    readFile(join(root, "polar-remote-quest/src/styles.css"), "utf8"),
    readFile(join(root, "polar-remote-quest/src/styles-v4.css"), "utf8"),
    readFile(join(root, "polar-remote-quest/src/diagnostic.js"), "utf8"),
  ]);

  assert.doesNotMatch(html, /id="beacon-id"|id="find-headset"|remember-beacon/u);
  assert.match(html, />Request full app control</u);
  assert.match(html, /headset wearer must still accept the request/u);
  assert.match(html, /Attended public pilot/u);
  assert.match(html, /id="ecg-preview"/u);
  for (const section of [
    "LIVE ECG PREVIEW", "LIVE STATUS", "CONNECTION CHECKLIST",
    "NEARBY POLAR H10 SENSORS", "TROUBLESHOOTING", "SENSOR CONTROLS",
    "RECORDING", "REMOTE SESSION", "REFERENCE LAUNCH",
  ]) assert.match(html, new RegExp(`>${section}<`, "u"));
  for (const id of [
    "rescan", "stop-scan", "refresh-status", "reconnect", "disconnect",
    "connect-selected", "start-ecg", "stop-ecg", "restart-ecg",
    "recording-name", "start-recording", "stop-recording", "panel-visible", "revoke",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`, "u"));
  assert.doesNotMatch(html, /id="qr"|transport-secret|pairing-secret|name="room"|name="session"/iu);
  assert.doesNotMatch(html, /unsafe-eval|unsafe-inline|connect-src[^;]*\*/u);
  assert.match(html, /frame-ancestors 'none'/u);
  assert.match(html, /wss:\/\/wss\.vdo\.ninja https:\/\/turnservers\.vdo\.ninja/u);
  assert.match(html, /src="\.\.\/vendor\/vdoninja\/1\.5\.5\/vdoninja-sdk\.min\.js"/u);
  assert.match(html, /src="\.\/src\/app-fixed-v4\.js\?v=5"/u);
  assert.match(html, /href="\.\/src\/styles-v4\.css"/u);
  assert.doesNotMatch(html, /app-fixed-v[23]|styles-v3/u);

  assert.doesNotMatch(app, /localStorage|beaconForm|rememberBeacon|findButton/u);
  assert.match(app, /globalThis\.top === globalThis\.self/u);
  assert.match(app, /embeddedBlocked \|\| requestInFlight/u);
  assert.match(app, /if \(embeddedBlocked \|\| requestInFlight \|\| controller\.session\) return/u);
  assert.match(app, /Embedded control is disabled to prevent clickjacking/u);
  assert.match(app, /requestButton\.addEventListener\("click", async \(\) => \{[\s\S]*deriveBeaconInvitation\(PILOT_BEACON_ID\)[\s\S]*await controller\.connect\(invitation\)/u);
  for (const moduleName of ["controller", "diagnostic", "profile", "waveform"]) {
    assert.match(app, new RegExp(`\\./${moduleName}\\.js\\?v=5`, "u"));
  }
  assert.match(app, /snapshot\.state\.ecgPreview/u, "the display must consume the bounded native preview field");
  assert.match(app, /projectDiagnosticPanel/u);
  assert.match(app, /renderCandidates\(diagnostic\.candidates, diagnostic\.selectedCandidateKey, diagnostic\.controls\.candidateSelection\)/u);
  assert.match(app, /recordingName\.disabled = diagnostic\.recorder\?\.active === true/u);
  assert.match(app, /targetSelectedCandidateKey !== targetCandidateKeySeen/u);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|eval\s*\(/u);
  assert.doesNotMatch(app, /ecgPreview\?\.samples/u);
  assert.doesNotMatch(app, /window\.location\.hash|URLSearchParams|sessionStorage/u);
  assert.doesNotMatch(beacon, /localStorage[\s\S]*(transportSecret|pairingSecret)/u);
  assert.match(worker, /fixed static allow-list/u);
  assert.match(worker, /v10-mirror-v5/u);
  assert.match(worker, /requestUrl\.search/u);
  assert.doesNotMatch(worker, /localStorage|IndexedDB|pairingSecret|transportSecret/u);
  assert.match(styles, /\.metric-grid/u);
  assert.match(styles, /\.candidate-option/u);
  assert.match(versionedStyles, /@import url\("\.\/styles\.css"\)/u);
  assert.match(versionedStyles, /overflow-wrap:\s*anywhere/u);
  assert.match(diagnostic, /metrics\.length|const metrics/u);

  assert.match(workflow, /branches: \[main\]/u);
  assert.match(workflow, /actions\/checkout@v6/u);
  assert.match(workflow, /actions\/setup-node@v6/u);
  assert.match(workflow, /actions\/configure-pages@v6/u);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/u);
  assert.match(workflow, /actions\/deploy-pages@v5/u);
  assert.match(workflow, /pages: write/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /path: \.cache\/pages/u);
});

test("Pages builder emits a coherent subpage without altering pinned source bytes", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "brsp-pages-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await buildPages(temporaryRoot);

  for (const path of [
    ".nojekyll",
    "index.html",
    "polar-remote-quest/index.html",
    "polar-remote-quest/src/app-fixed-v4.js",
    "polar-remote-quest/src/beacon-fixed-v1.js",
    "polar-remote-quest/src/controller.js",
    "polar-remote-quest/src/diagnostic.js",
    "polar-remote-quest/src/profile.js",
    "polar-remote-quest/src/styles-v4.css",
    "polar-remote-quest/src/waveform.js",
    "src/brsp.js",
    "src/vdo-ninja-transport.js",
    "vendor/vdoninja/1.5.5/vdoninja-sdk.min.js",
    "vendor/vdoninja/1.5.5/LICENSE-MPL-2.0.txt",
  ]) await readFile(join(temporaryRoot, path));

  assert.deepEqual(
    await readFile(join(temporaryRoot, "src/brsp.js")),
    await readFile(join(root, "src/brsp.js")),
  );
  assert.deepEqual(
    await readFile(join(temporaryRoot, "vendor/vdoninja/1.5.5/vdoninja-sdk.min.js")),
    await readFile(join(root, "vendor/vdoninja/1.5.5/vdoninja-sdk.min.js")),
  );
});
