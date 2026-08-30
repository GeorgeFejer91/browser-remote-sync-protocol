function requireString(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  return value;
}

export function resolveSessionMaterial({
  role,
  room,
  secret,
  generateRoom,
  generateSecret,
}) {
  if (role !== "target" && role !== "controller") {
    throw new TypeError("role must be target or controller.");
  }
  let resolvedRoom = requireString(room, "room").trim();
  let resolvedSecret = requireString(secret, "secret");
  if (role === "target") {
    if (typeof generateRoom !== "function" || typeof generateSecret !== "function") {
      throw new TypeError("Target session generators must be functions.");
    }
    if (!resolvedRoom) resolvedRoom = requireString(generateRoom(), "generated room");
    if (!resolvedSecret) resolvedSecret = requireString(generateSecret(), "generated secret");
  }
  return { room: resolvedRoom, secret: resolvedSecret };
}

export function showSessionMaterial(elements, { room, secret }) {
  elements.room.value = room;
  elements.secret.value = secret;
  elements.roomReadback.textContent = room;
  elements.secretReadback.textContent = secret;
  elements.sessionValues.hidden = false;
}

export function clearSessionMaterial(elements) {
  elements.room.value = "";
  elements.secret.value = "";
  elements.roomReadback.textContent = "";
  elements.secretReadback.textContent = "";
  elements.sessionValues.hidden = true;
}
