import { ECG_PREVIEW_PROFILE } from "./profile.js";

export function waveformPoints(preview, width, height, padding = 8) {
  const values = preview?.values;
  if (!Array.isArray(values) || values.length === 0
    || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= padding * 2 || height <= padding * 2) return [];
  const drawableWidth = width - padding * 2;
  const drawableHeight = height - padding * 2;
  const span = ECG_PREVIEW_PROFILE.maximum - ECG_PREVIEW_PROFILE.minimum;
  return values.map((value, index) => ({
    x: padding + (values.length === 1 ? drawableWidth / 2 : (index * drawableWidth) / (values.length - 1)),
    y: padding + ((ECG_PREVIEW_PROFILE.maximum - value) / span) * drawableHeight,
  }));
}

/** Browser-only rendering helper; it never stores, exports, or resamples target data. */
export function drawEcgPreview(canvas, preview) {
  const width = Math.max(1, canvas.clientWidth || Number(canvas.getAttribute("width")) || 640);
  const height = Math.max(1, canvas.clientHeight || Number(canvas.getAttribute("height")) || 180);
  const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#06110e";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(93, 143, 122, .3)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(8, height / 2);
  context.lineTo(width - 8, height / 2);
  context.stroke();

  const points = waveformPoints(preview, width, height);
  if (points.length < 2) return;
  context.strokeStyle = "#58e8a1";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach(({ x, y }) => context.lineTo(x, y));
  context.stroke();
}
