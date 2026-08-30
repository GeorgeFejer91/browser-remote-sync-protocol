import { ECG_PREVIEW_PROFILE } from "./profile.js";

export function waveformPoints(preview, width, height, verticalFraction = 0.40) {
  const values = preview?.values;
  if (!Array.isArray(values) || values.length < 2
    || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0 || verticalFraction <= 0 || verticalFraction > 0.5) return [];
  const bounded = values.slice(-ECG_PREVIEW_PROFILE.maxSamples);
  const mean = bounded.reduce((sum, value) => sum + value, 0) / bounded.length;
  const amplitude = Math.max(1, ...bounded.map((value) => Math.abs(value - mean)));
  const verticalRange = height * verticalFraction;
  return bounded.map((value, index) => ({
    x: (index / (bounded.length - 1)) * width,
    y: (height / 2) - (((value - mean) / amplitude) * verticalRange),
  }));
}

export function waveformGrid(width, height, step = 36) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(step)
    || width <= 0 || height <= 0 || step <= 0) return { vertical: [], horizontal: [] };
  const vertical = [];
  const horizontal = [];
  for (let x = step; x < width; x += step) vertical.push(x);
  for (let y = step; y < height; y += step) horizontal.push(y);
  return { vertical, horizontal };
}

/** Browser-only renderer; it stores, exports, and synthesizes no samples. */
export function drawEcgPreview(canvas, preview, { streaming = false, ready = false } = {}) {
  const width = Math.max(1, canvas.clientWidth || Number(canvas.getAttribute("width")) || 720);
  const height = Math.max(1, canvas.clientHeight || Number(canvas.getAttribute("height")) || 210);
  const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = "#121c27";
  context.fillRect(0, 0, width, height);

  const grid = waveformGrid(width, height);
  context.strokeStyle = "rgba(151, 178, 197, 0.165)";
  context.lineWidth = 1;
  context.beginPath();
  grid.vertical.forEach((x) => { context.moveTo(x, 0); context.lineTo(x, height); });
  grid.horizontal.forEach((y) => { context.moveTo(0, y); context.lineTo(width, y); });
  context.stroke();

  context.strokeStyle = "rgba(109, 228, 209, 0.345)";
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();

  const points = waveformPoints(preview, width, height);
  if (points.length < 2) {
    context.fillStyle = "#97a9b8";
    context.font = "700 13px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(streaming ? "ECG STREAM STARTING" : "WAITING FOR REAL ECG", width / 2, height / 2);
    return;
  }

  context.strokeStyle = ready ? "#4fde8d" : "#6de4d1";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach(({ x, y }) => context.lineTo(x, y));
  context.stroke();
}
