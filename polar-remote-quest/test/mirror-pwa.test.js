import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app-fixed-v4.js", import.meta.url), "utf8");

test("service-worker upgrades evict stale app shells without caching runtime URLs", () => {
  assert.match(worker, /STATIC_CACHE_PREFIX\s*=\s*"polar-remote-pages-static-"/u);
  assert.match(worker, /key\.startsWith\(STATIC_CACHE_PREFIX\)[\s\S]*caches\.delete\(key\)/u);
  assert.match(worker, /requestUrl\.search/u, "query-bearing requests must not enter the static cache");
  assert.match(worker, /caches\.open\(STATIC_CACHE\)[\s\S]*cache\.match\(event\.request\)/u);
  assert.match(worker, /\.\/src\/waveform\.js/u, "the offline app shell must include the waveform renderer");
  assert.match(worker, /\.\/src\/diagnostic\.js/u, "the offline app shell must include the diagnostic projector");
  assert.match(app, /\.\/profile\.js\?v=5/u, "versioned module imports must bypass an older controlling worker");
});

test("fixed pilot channel needs no stored ID and page load stays network-inert", () => {
  assert.doesNotMatch(app, /localStorage/u);
  assert.match(app, /requestButton\.addEventListener\("click"[\s\S]*deriveBeaconInvitation\(PILOT_BEACON_ID\)[\s\S]*controller\.connect/u);
  assert.doesNotMatch(app, /window\.location\.hash|invitationFromHash/u);
});

test("the companion explicitly checks for a fresh app-shell worker", () => {
  assert.match(app, /register\("\.\/sw\.js",\s*\{\s*updateViaCache:\s*"none"\s*\}\)/u);
  assert.match(app, /registration\.update\(\)/u);
});
