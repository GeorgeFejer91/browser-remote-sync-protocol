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
  "examples/two-browser-demo/index.html",
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

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
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
