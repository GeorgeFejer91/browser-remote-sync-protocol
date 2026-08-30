import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "README.md",
  "docs/00-overview.md",
  "docs/01-architecture.md",
  "docs/02-threat-model-and-privacy.md",
  "docs/03-protocol-specification.md",
  "docs/04-vdo-ninja-adapter.md",
  "docs/05-implementation-guide.md",
  "docs/06-problems-and-solutions.md",
  "docs/07-patterns-and-use-cases.md",
  "docs/08-testing-and-qualification.md",
  "docs/09-roadmap.md",
  "docs/10-sources-and-provenance.md",
  "docs/11-marionette-companion-profile.md",
  "docs/12-app-integration-recipes.md",
  "docs/13-native-shell-webview-integration.md",
  "docs/14-deployment-network-and-csp.md",
  "docs/15-qualification-record.md",
  "examples/application-integration/README.md",
  "examples/native-meta-quest/README.md",
  "examples/native-meta-quest/android/AndroidManifest.xml",
  "examples/native-meta-quest/android/BundledWebViewTransport.kt",
  "examples/native-meta-quest/android/RemoteSessionOwner.kt",
  "examples/native-meta-quest/android/RemoteSessionService.kt",
  "examples/native-meta-quest/companion/profile.js",
  "examples/native-meta-quest/fixtures/capability-manifest-v1.json",
  "examples/native-meta-quest/fixtures/commands-v1.json",
  "examples/native-meta-quest/fixtures/remote-state-v1.json",
  "examples/native-meta-quest/kotlin/QuestActionContract.kt",
  "examples/native-meta-quest/kotlin/QuestActionRouter.kt",
  "examples/native-meta-quest/test/native-meta-quest.test.js",
  "examples/native-meta-quest/webview/bridge-forwarding.js",
  "examples/native-meta-quest/webview/index.html",
  "examples/native-meta-quest/webview/index.js",
  "examples/native-meta-quest/webview/transport-lifecycle.js",
  "examples/two-browser-demo/index.html",
  ".github/workflows/pages.yml",
  "polar-remote-quest/icon.svg",
  "polar-remote-quest/index.html",
  "polar-remote-quest/manifest.webmanifest",
  "polar-remote-quest/sw.js",
  "polar-remote-quest/src/app-fixed-v1.js",
  "polar-remote-quest/src/beacon-fixed-v1.js",
  "polar-remote-quest/src/controller.js",
  "polar-remote-quest/src/profile.js",
  "polar-remote-quest/src/styles.css",
  "polar-remote-quest/src/styles-v3.css",
  "polar-remote-quest/src/waveform.js",
  "polar-remote-quest/test/pages-site.test.js",
  "polar-remote-quest/test/waveform.test.js",
  "scripts/build-pages.mjs",
  "qualification/README.md",
  "qualification/browser-smoke.html",
  "qualification/browser-smoke.js",
  "src/brsp.js",
  "src/vdo-ninja-transport.js",
];
for (const path of required) assert.ok(existsSync(join(root, path)), `Missing required repository file: ${path}`);

const expectedHashes = new Map([
  ["vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", "390ea6c8b1a4e57bf7fa18ff2b394f25cc79e637130f97e4a29ca958a90fac77"],
  ["vendor/vdoninja/1.5.5/vdoninja-sdk.js", "8097d5420d7ed2426623d7ff08f6abd45f03f89e6540a6cc4b86bcdc057d841e"],
  ["vendor/vdoninja/1.5.5/LICENSE-MPL-2.0.txt", "3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04"],
]);
for (const [path, expected] of expectedHashes) {
  const actual = createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
  assert.equal(actual, expected, `Vendored-file hash mismatch: ${path}`);
}

const source = readFileSync(join(root, "src/vdo-ninja-transport.js"), "utf8");
assert.match(source, /announce\(\{ streamID:/, "Target must use data-only announce().");
assert.match(source, /audio:\s*false[\s\S]*video:\s*false/, "Controller must request neither audio nor video.");
assert.match(source, /ordered:\s*false,\s*maxRetransmits:\s*0/, "State lane must be unordered with zero retransmits.");
assert.doesNotMatch(source, /getUserMedia|captureStream/, "Reference transport must not capture media.");
assert.doesNotMatch(source, /new\s+WebSocket/, "Reference adapter must not bypass the VDO.Ninja SDK signaling API.");

const pinnedSdk = readFileSync(join(root, "vendor/vdoninja/1.5.5/vdoninja-sdk.js"), "utf8");
assert.match(pinnedSdk, /wss:\/\/wss\.vdo\.ninja/, "Pinned SDK signaling host changed; update the deployment inventory deliberately.");
assert.match(pinnedSdk, /https:\/\/turnservers\.vdo\.ninja\//, "Pinned SDK TURN-list origin changed; update CSP and deployment inventory deliberately.");
assert.match(pinnedSdk, /stun:stun\.l\.google\.com:19302/, "Pinned SDK Google STUN default changed; update the network inventory.");
assert.match(pinnedSdk, /stun:stun\.cloudflare\.com:3478/, "Pinned SDK Cloudflare STUN default changed; update the network inventory.");
for (const relayHost of [
  "turn-cae1.vdo.ninja",
  "turn-usw2.vdo.ninja",
  "turn-eu4.vdo.ninja",
  "turn-eu1.vdo.ninja",
  "turn-use1.vdo.ninja",
  "www.turn.obs.ninja",
  "turn.obs.ninja",
]) {
  assert.match(pinnedSdk, new RegExp(relayHost.replaceAll(".", "\\.")), `Pinned SDK fallback ${relayHost} changed; update the network inventory.`);
}

const html = readFileSync(join(root, "examples/two-browser-demo/index.html"), "utf8");
assert.match(html, /vendor\/vdoninja\/1\.5\.5\/vdoninja-sdk\.min\.js/, "Demo must load the pinned local SDK.");
const app = readFileSync(join(root, "examples/two-browser-demo/app.js"), "utf8");
assert.match(app, /elements\.start\.addEventListener\("click"/, "Networking must be owned by an explicit Start click.");
assert.match(
  app,
  /async function start\(\)[\s\S]*await\s+transport\.start\(\)[\s\S]*elements\.start\.addEventListener\("click", \(\) => \{ void start\(\); \}\);/,
  "Transport activation must remain inside start() and be reached from the explicit Start click.",
);
assert.doesNotMatch(app, /^await\s+transport\.start\(\)/mu, "No unscoped top-level transport start is allowed.");

const questExampleRoot = join(root, "examples/native-meta-quest");
const questManifestFixture = JSON.parse(readFileSync(join(questExampleRoot, "fixtures/capability-manifest-v1.json"), "utf8"));
const questManifestHash = createHash("sha256").update(canonicalJson(questManifestFixture)).digest("hex");
const expectedQuestManifestHash = "a6baeaa8727b13c316f733909fb30297183308ec3fe4eda3ef0c8a9c0376cc20";
assert.equal(questManifestHash, expectedQuestManifestHash, "Native Quest capability fixture/hash changed; update both language profiles deliberately.");
assert.equal(
  new Set(questManifestFixture.entries.map((entry) => entry.action)).size,
  questManifestFixture.entries.length,
  "Every native Quest action must appear exactly once in the example manifest.",
);
assert.ok(
  questManifestFixture.entries.filter((entry) => !entry.remotelyEligible).every(
    (entry) => entry.sensitivity === "headset_only" && entry.requiredScope === null,
  ),
  "Non-remote native Quest actions must remain explicitly headset-only.",
);

const questProfile = readFileSync(join(questExampleRoot, "companion/profile.js"), "utf8");
const questContract = readFileSync(join(questExampleRoot, "kotlin/QuestActionContract.kt"), "utf8");
for (const profileSource of [questProfile, questContract]) {
  assert.match(profileSource, new RegExp(expectedQuestManifestHash), "Both native Quest language profiles must pin the fixture hash.");
}
for (const forbidden of ["invoke", "eval", "selector", "shell", "filename", "android-intent"]) {
  assert.ok(
    !questManifestFixture.entries.some((entry) => entry.action === forbidden),
    `Native Quest example must not expose generic ${forbidden} authority.`,
  );
}

const questAndroidManifest = readFileSync(join(questExampleRoot, "android/AndroidManifest.xml"), "utf8");
assert.match(questAndroidManifest, /<receiver[\s\S]*android:exported="false"/, "Native Quest notification Stop receiver must remain non-exported.");
assert.doesNotMatch(questAndroidManifest, /FOREGROUND_SERVICE|foregroundServiceType/, "A notification-only example must not claim foreground-service work.");
assert.match(questAndroidManifest, /android:usesCleartextTraffic="false"/, "Native Quest fragment must reject cleartext traffic.");
assert.doesNotMatch(
  questAndroidManifest,
  /CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|MANAGE_EXTERNAL_STORAGE|RECEIVE_BOOT_COMPLETED/,
  "Native Quest BRSP example must not add media/location/storage/boot authority.",
);

const questWebView = readFileSync(join(questExampleRoot, "android/BundledWebViewTransport.kt"), "utf8");
for (const invariant of [
  /settings\.allowFileAccess = false/,
  /settings\.allowContentAccess = false/,
  /MIXED_CONTENT_NEVER_ALLOW/,
  /WebViewAssetLoader/,
  /activeGeneration/,
  /JSONObject\.quote\(payload\)/,
]) assert.match(questWebView, invariant, "Native Quest WebView transport boundary weakened.");
assert.doesNotMatch(questWebView, /pairingSecret|android\.content\.Intent/, "Pairing/native intent authority must not enter the transport WebView.");

const questService = readFileSync(join(questExampleRoot, "android/RemoteSessionService.kt"), "utf8");
assert.match(questService, /class RemoteStopReceiver : BroadcastReceiver/, "Native Quest Stop notification must use the private receiver fragment.");
assert.doesNotMatch(questService, /startForeground|startActivity|BOOT_COMPLETED/, "Native Quest notification Stop path must not claim FGS work, cold-launch, or start at boot.");

const questLifecycle = readFileSync(join(questExampleRoot, "webview/transport-lifecycle.js"), "utf8");
assert.match(questLifecycle, /this\.configuration = null;[\s\S]*this\.transport = null;[\s\S]*await this\.safeStop\(closing\)/, "Native Quest Stop must clear ownership before awaited signaling cleanup.");
assert.match(questLifecycle, /if \(result !== "queued" && result !== "accepted"\)/, "Rejected native ingress must close the peer.");
assert.doesNotMatch(questLifecycle, /getUserMedia|captureStream/, "Native Quest transport fragment must remain data-only.");

const questBridgeHtml = readFileSync(join(questExampleRoot, "webview/index.html"), "utf8");
const questBridgeBootstrap = readFileSync(join(questExampleRoot, "webview/index.js"), "utf8");
assert.match(questBridgeHtml, /vendor\/vdoninja\/1\.5\.5\/vdoninja-sdk\.min\.js/, "Native Quest bridge must load the pinned local VDO SDK.");
assert.match(questBridgeHtml, /default-src 'none'/, "Native Quest bridge must retain a narrow bundled-page CSP.");
assert.match(questBridgeBootstrap, /transportFactory: \(configuration\) => new VdoNinjaTransport/, "VDO construction must remain behind explicit native configuration.");
assert.doesNotMatch(questBridgeBootstrap, /^await\s+.*\.start\(\)/mu, "Native Quest bridge must not start transport at module load.");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

const linkPattern = /\[[^\]]*\]\((?!https?:|mailto:|#)([^)#]+)(?:#[^)]+)?\)/gu;
for (const file of walk(root).filter((path) => extname(path) === ".md")) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(linkPattern)) {
    const target = resolve(dirname(file), decodeURIComponent(match[1]));
    assert.ok(existsSync(target), `Broken local Markdown link in ${file.slice(root.length + 1)}: ${match[1]}`);
  }
}

console.log("Repository contract, local links, activation boundary, and vendored hashes are valid.");
