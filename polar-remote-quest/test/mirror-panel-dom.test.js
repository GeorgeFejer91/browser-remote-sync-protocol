import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("companion panel contains the Study 6 diagnostic sections in operator order", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const sections = [
    "REMOTE CONNECTION",
    "LIVE ECG PREVIEW",
    "LIVE STATUS",
    "CONNECTION CHECKLIST",
    "NEARBY POLAR H10 SENSORS",
    "TROUBLESHOOTING",
    "SENSOR CONTROLS",
    "RECORDING",
    "REMOTE SESSION",
    "REFERENCE LAUNCH",
  ];
  let cursor = -1;
  for (const section of sections) {
    const position = html.indexOf(`>${section}<`);
    assert.ok(position > cursor, `${section} must follow the preceding section`);
    cursor = position;
  }
  assert.match(html, /Study 6 · Sensor Bridge/u);
  assert.match(html, /Grant Nearby devices · headset only/u);
  assert.match(html, /Open Study 6 WebXR · headset only/u);
  assert.match(html, /Operator companion · already open/u);
  assert.match(html, /Real PMD samples only/u);
});

test("every semantic panel control is static, typed, and safe-rendered", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/app-fixed-v4.js", import.meta.url), "utf8"),
  ]);
  const controlIds = [
    "rescan", "stop-scan", "refresh-status", "reconnect", "disconnect", "connect-selected",
    "start-ecg", "stop-ecg", "restart-ecg", "recording-name", "start-recording",
    "stop-recording", "panel-visible", "revoke",
  ];
  controlIds.forEach((id) => assert.match(html, new RegExp(`id=["']${id}["']`, "u")));
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|eval\s*\(/u);
  assert.doesNotMatch(html, /id=["'](?:approve-permissions|launch-external|approve-pairing|reject-pairing)["']/u);
});
