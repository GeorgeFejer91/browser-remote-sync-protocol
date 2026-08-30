export const BEACON_HEX_LENGTH = 24;
export const BEACON_STORAGE_KEY = "polar-remote-quest.public-beacon-id.v1";

const BEACON_PATTERN = /^[0-9a-f]{24}$/u;
const encoder = new TextEncoder();

export function normalizeBeaconId(value) {
  const normalized = String(value ?? "").replace(/[\s-]+/gu, "").toLowerCase();
  if (!BEACON_PATTERN.test(normalized)) {
    throw new TypeError("Beacon ID must contain exactly 24 hexadecimal characters.");
  }
  return normalized;
}

export function formatBeaconId(value) {
  const normalized = normalizeBeaconId(value);
  return normalized.match(/.{4}/gu).join("-").toUpperCase();
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function derive(label, id, subtle) {
  const digest = await subtle.digest("SHA-256", encoder.encode(`${label}\n${id}`));
  return base64Url(new Uint8Array(digest));
}

/**
 * Resolves a stable public address into the existing data-only transport and
 * BRSP fields. These values are deterministic and therefore are not identity
 * or authorization. Headset-local Accept remains the authority boundary.
 */
export async function deriveBeaconInvitation(value, {
  subtle = globalThis.crypto?.subtle,
} = {}) {
  if (!subtle) throw new Error("This browser does not provide Web Crypto SHA-256.");
  const id = normalizeBeaconId(value);
  const [transportSecret, pairingSecret] = await Promise.all([
    derive("polar-remote-quest/v1/transport", id, subtle),
    derive("polar-remote-quest/v1/brsp", id, subtle),
  ]);
  return Object.freeze({
    beaconId: id,
    room: `prq_${id}`,
    session: `prq.session.${id}`,
    transportSecret,
    pairingSecret,
  });
}

export function loadRememberedBeacon(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(BEACON_STORAGE_KEY);
    return value ? normalizeBeaconId(value) : undefined;
  } catch {
    return undefined;
  }
}

export function storeRememberedBeacon(value, storage = globalThis.localStorage) {
  const normalized = normalizeBeaconId(value);
  try { storage?.setItem(BEACON_STORAGE_KEY, normalized); } catch { /* storage is optional */ }
  return normalized;
}

export function clearRememberedBeacon(storage = globalThis.localStorage) {
  try { storage?.removeItem(BEACON_STORAGE_KEY); } catch { /* storage is optional */ }
}
