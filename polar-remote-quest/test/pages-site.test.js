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
  storeRememberedBeacon,
} from "../src/beacon.js";
import { PolarRemoteController } from "../src/controller.js";
import {
  CAPABILITY_MANIFEST,
  ECG_PREVIEW_PROFILE,
  EXPECTED_CAPABILITY_HASH,
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

test("Pages profile pins the exact native ECG preview manifest and bounds", () => {
  assert.deepEqual(REQUESTED_SCOPES, [
    "app.observe", "polar.ecg.observe", "polar.control", "panel.presentation.write", "session.safety",
  ]);
  assert.equal(CAPABILITY_MANIFEST.schemaVersion, 2);
  assert.deepEqual(CAPABILITY_MANIFEST.stateProjections, [ECG_PREVIEW_PROFILE]);
  assert.equal(
    createHash("sha256").update(canonicalStringify(CAPABILITY_MANIFEST)).digest("hex"),
    EXPECTED_CAPABILITY_HASH,
  );
  assert.equal(EXPECTED_CAPABILITY_HASH, "57a1c7aaf41abbcbb355c41c459e8b3d12bd62041296f3b1283021a246913f2a");

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

test("GitHub Pages source keeps activation, approval, privacy, and path boundaries", async () => {
  const [html, app, beacon, worker, workflow, styles, versionedStyles] = await Promise.all([
    readFile(join(root, "polar-remote-quest/index.html"), "utf8"),
    readFile(join(root, "polar-remote-quest/src/app.js"), "utf8"),
    readFile(join(root, "polar-remote-quest/src/beacon.js"), "utf8"),
    readFile(join(root, "polar-remote-quest/sw.js"), "utf8"),
    readFile(join(root, ".github/workflows/pages.yml"), "utf8"),
    readFile(join(root, "polar-remote-quest/src/styles.css"), "utf8"),
    readFile(join(root, "polar-remote-quest/src/styles-v3.css"), "utf8"),
  ]);

  assert.match(html, /id="beacon-id"/u);
  assert.match(html, />Find headset</u);
  assert.match(html, />Request control</u);
  assert.match(html, /choose <strong>Accept<\/strong> or <strong>Reject<\/strong>/u);
  assert.match(html, /public address, not a password/u);
  assert.match(html, /id="ecg-chart"/u);
  assert.doesNotMatch(html, /QR|transport-secret|pairing-secret|name="room"|name="session"/iu);
  assert.doesNotMatch(html, /unsafe-eval|unsafe-inline|connect-src[^;]*\*/u);
  assert.match(html, /wss:\/\/wss\.vdo\.ninja https:\/\/turnservers\.vdo\.ninja/u);
  assert.match(html, /src="\.\.\/vendor\/vdoninja\/1\.5\.5\/vdoninja-sdk\.min\.js"/u);

  assert.match(app, /beaconForm\.addEventListener\("submit"/u);
  assert.match(app, /requestButton\.addEventListener\("click", async \(\) => \{[\s\S]*await controller\.connect\(invitation\)/u);
  assert.match(app, /preview\?\.values/u, "the display must consume the native values field");
  assert.doesNotMatch(app, /ecgPreview\?\.samples/u);
  assert.doesNotMatch(app, /window\.location\.hash|URLSearchParams|sessionStorage/u);
  assert.doesNotMatch(beacon, /localStorage[\s\S]*(transportSecret|pairingSecret)/u);
  assert.match(worker, /fixed static allow-list/u);
  assert.match(worker, /requestUrl\.search/u);
  assert.doesNotMatch(worker, /localStorage|IndexedDB|pairingSecret|transportSecret/u);
  assert.match(styles, /\.signal-badge\s*\{[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/su);
  assert.match(versionedStyles, /@import url\("\.\/styles\.css"\)/u);
  assert.match(versionedStyles, /\.signal-badge\s*\{[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/su);

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
    "polar-remote-quest/src/app.js",
    "polar-remote-quest/src/beacon.js",
    "polar-remote-quest/src/controller.js",
    "polar-remote-quest/src/styles-v3.css",
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
