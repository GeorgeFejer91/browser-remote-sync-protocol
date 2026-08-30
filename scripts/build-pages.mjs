import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = join(root, ".cache", "pages");

const PAGE_FILES = [
  "index.html",
  "icon.svg",
  "manifest.webmanifest",
  "sw.js",
  "src/app-fixed-v4.js",
  "src/beacon-fixed-v1.js",
  "src/controller.js",
  "src/diagnostic.js",
  "src/profile.js",
  "src/styles.css",
  "src/styles-v4.css",
  "src/waveform.js",
];

const SHARED_FILES = [
  "src/brsp.js",
  "src/vdo-ninja-transport.js",
  "vendor/vdoninja/1.5.5/LICENSE-MPL-2.0.txt",
  "vendor/vdoninja/1.5.5/NOTICE.md",
  "vendor/vdoninja/1.5.5/vdoninja-sdk.min.js",
];

async function copyFile(relativeSource, relativeTarget, outputRoot) {
  const target = join(outputRoot, relativeTarget);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, relativeSource), target, { force: true });
}

export async function buildPages(outputRoot = defaultOutput) {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const file of PAGE_FILES) {
    await copyFile(join("polar-remote-quest", file), join("polar-remote-quest", file), outputRoot);
  }
  for (const file of SHARED_FILES) await copyFile(file, file, outputRoot);

  await writeFile(join(outputRoot, ".nojekyll"), "", "utf8");
  await writeFile(join(outputRoot, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=./polar-remote-quest/"><title>BRSP companion</title></head>
<body><p><a href="./polar-remote-quest/">Open Polar Remote Quest companion</a></p></body></html>
`, "utf8");
  return outputRoot;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const output = await buildPages();
  console.log(`GitHub Pages artifact built at ${output}`);
}
