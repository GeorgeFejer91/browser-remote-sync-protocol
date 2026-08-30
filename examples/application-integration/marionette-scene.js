import { BRSPConnection } from "../../src/brsp.js";

export const MARIONETTE_PROFILE = "brsp-marionette-scene";
export const MARIONETTE_VERSION = 1;
export const MARIONETTE_COMMAND_SCOPE = "scene.command";
export const MARIONETTE_INTENT_SCOPE = "scene.intent";
export const MARIONETTE_DEFAULT_LEASE_MS = 500;

export const MARIONETTE_CAPABILITIES = Object.freeze([
  "command-ack",
  "latest-intent",
  "latest-state",
  "marionette-scene-v1",
  "state-snapshot",
]);

export const MARIONETTE_SCOPES = Object.freeze([
  MARIONETTE_COMMAND_SCOPE,
  MARIONETTE_INTENT_SCOPE,
]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const MARIONETTE_SCENE_MANIFEST = deepFreeze({
  profile: MARIONETTE_PROFILE,
  version: MARIONETTE_VERSION,
  title: "Semantic scene companion",
  controls: [
    {
      id: "reset",
      kind: "command-button",
      scope: MARIONETTE_COMMAND_SCOPE,
      action: "reset",
      label: "Reset scene",
    },
    {
      id: "pulse",
      kind: "toggle-command",
      scope: MARIONETTE_COMMAND_SCOPE,
      action: "set-pulse",
      label: "Pulse animation",
    },
    {
      id: "pointer",
      kind: "joystick-2d",
      scope: MARIONETTE_INTENT_SCOPE,
      label: "Pointer",
      minimum: -1,
      maximum: 1,
      deadZone: 0.08,
      expiry: "neutral",
      leaseMs: MARIONETTE_DEFAULT_LEASE_MS,
    },
    {
      id: "hue",
      kind: "absolute-slider",
      scope: MARIONETTE_INTENT_SCOPE,
      label: "Hue",
      minimum: 0,
      maximum: 360,
      step: 1,
      expiry: "hold",
    },
    {
      id: "stop-pointer",
      kind: "command-button",
      scope: MARIONETTE_COMMAND_SCOPE,
      action: "stop-pointer",
      label: "Stop pointer",
    },
  ],
});

const DEFAULT_SCENE = Object.freeze({ hue: 205, pulse: true });
const NEUTRAL_POINTER = Object.freeze({ x: 0, y: 0, active: false });

export class ProfileValidationError extends TypeError {}

function invalid(message) {
  throw new ProfileValidationError(message);
}

function detailEvent(type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail, enumerable: true });
  return event;
}

function record(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!record(value)) invalid(`${label} must be a plain object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function finiteNumber(value, minimum, maximum, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${label} must be a finite number from ${minimum} through ${maximum}.`);
  }
  return value;
}

function safeRevision(value, label = "revision") {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative safe integer.`);
  return value;
}

function boundedInterval(value, label, { minimum, maximum }) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    invalid(`${label} must be an integer from ${minimum} through ${maximum} milliseconds.`);
  }
  return value;
}

function uint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    invalid(`${label} must be an unsigned 32-bit integer.`);
  }
  return value >>> 0;
}

function copyPointer(pointer) {
  return { x: pointer.x, y: pointer.y, active: pointer.active };
}

function copyState(state) {
  return {
    profile: state.profile,
    version: state.version,
    revision: state.revision,
    scene: { hue: state.scene.hue, pulse: state.scene.pulse },
    pointer: copyPointer(state.pointer),
  };
}

function samePointer(left, right) {
  return left.x === right.x && left.y === right.y && left.active === right.active;
}

function sameProfileState(left, right) {
  return left.profile === right.profile
    && left.version === right.version
    && left.revision === right.revision
    && left.scene.hue === right.scene.hue
    && left.scene.pulse === right.scene.pulse
    && samePointer(left.pointer, right.pointer);
}

export function validatePointer(value, { label = "pointer" } = {}) {
  exactKeys(value, ["x", "y", "active"], label);
  const pointer = {
    x: finiteNumber(value.x, -1, 1, `${label}.x`),
    y: finiteNumber(value.y, -1, 1, `${label}.y`),
    active: value.active,
  };
  if (typeof pointer.active !== "boolean") invalid(`${label}.active must be boolean.`);
  if (!pointer.active && (pointer.x !== 0 || pointer.y !== 0)) {
    invalid(`${label} must use x=0 and y=0 while inactive.`);
  }
  return pointer;
}

export function validateIntentControls(value) {
  exactKeys(value, ["pointer", "hue"], "intent controls");
  return {
    pointer: validatePointer(value.pointer, { label: "intent controls.pointer" }),
    hue: finiteNumber(value.hue, 0, 360, "intent controls.hue"),
  };
}

export function validateProfileState(value) {
  exactKeys(value, ["profile", "version", "revision", "scene", "pointer"], "profile state");
  if (value.profile !== MARIONETTE_PROFILE || value.version !== MARIONETTE_VERSION) {
    invalid("profile state uses an unsupported profile or version.");
  }
  exactKeys(value.scene, ["hue", "pulse"], "profile state.scene");
  if (typeof value.scene.pulse !== "boolean") invalid("profile state.scene.pulse must be boolean.");
  const state = {
    profile: MARIONETTE_PROFILE,
    version: MARIONETTE_VERSION,
    revision: safeRevision(value.revision),
    scene: {
      hue: finiteNumber(value.scene.hue, 0, 360, "profile state.scene.hue"),
      pulse: value.scene.pulse,
    },
    pointer: validatePointer(value.pointer, { label: "profile state.pointer" }),
  };
  return state;
}

function validateCommandEnvelope(command) {
  exactKeys(command, ["commandId", "scope", "action", "args", "expectedRevision"], "command");
  if (typeof command.commandId !== "string" || command.commandId.length < 8 || command.commandId.length > 96) {
    invalid("command.commandId must contain 8-96 characters.");
  }
  if (command.scope !== MARIONETTE_COMMAND_SCOPE) invalid("command.scope is not permitted by this profile.");
  if (typeof command.action !== "string") invalid("command.action must be a string.");
  if (command.expectedRevision !== null) safeRevision(command.expectedRevision, "command.expectedRevision");
  return command;
}

function validateCommandArguments(action, args) {
  if (action === "reset" || action === "stop-pointer") {
    exactKeys(args, [], `${action} args`);
    return {};
  }
  if (action === "set-pulse") {
    exactKeys(args, ["enabled"], "set-pulse args");
    if (typeof args.enabled !== "boolean") invalid("set-pulse args.enabled must be boolean.");
    return { enabled: args.enabled };
  }
  return undefined;
}

export class MarionetteSceneAuthority extends EventTarget {
  constructor({
    now = () => performance.now(),
    leaseMs = MARIONETTE_DEFAULT_LEASE_MS,
    initialState,
  } = {}) {
    super();
    if (typeof now !== "function") invalid("now must be a function.");
    if (!Number.isFinite(leaseMs) || leaseMs < 100 || leaseMs > 60_000) {
      invalid("leaseMs must be between 100 and 60000 milliseconds.");
    }
    this.now = now;
    this.leaseMs = leaseMs;
    if (initialState === undefined) {
      this.state = {
        profile: MARIONETTE_PROFILE,
        version: MARIONETTE_VERSION,
        revision: 0,
        scene: { ...DEFAULT_SCENE },
        pointer: { ...NEUTRAL_POINTER },
      };
    } else {
      const validatedInitialState = validateProfileState(initialState);
      if (validatedInitialState.pointer.active) {
        invalid("initialState.pointer.active must be false; active momentary state requires a live receiver-owned lease.");
      }
      this.state = validatedInitialState;
    }
    this.pointerLeaseAcceptedAt = undefined;
  }

  snapshot() {
    return copyState(this.state);
  }

  commit({ scene = this.state.scene, pointer = this.state.pointer, reason }) {
    const nextScene = { hue: scene.hue, pulse: scene.pulse };
    const nextPointer = copyPointer(pointer);
    const changed = nextScene.hue !== this.state.scene.hue
      || nextScene.pulse !== this.state.scene.pulse
      || !samePointer(nextPointer, this.state.pointer);
    if (!changed) return false;
    this.state = {
      profile: MARIONETTE_PROFILE,
      version: MARIONETTE_VERSION,
      revision: this.state.revision + 1,
      scene: nextScene,
      pointer: nextPointer,
    };
    this.dispatchEvent(detailEvent("statechange", { reason, state: this.snapshot() }));
    return true;
  }

  applyCommand(command) {
    try {
      validateCommandEnvelope(command);
    } catch (error) {
      return {
        ok: false,
        revision: this.state.revision,
        result: null,
        error: error instanceof ProfileValidationError ? "invalid_argument" : "command_failed",
      };
    }
    if (command.expectedRevision !== null && command.expectedRevision !== this.state.revision) {
      return { ok: false, revision: this.state.revision, result: null, error: "revision_conflict" };
    }
    let args;
    try {
      args = validateCommandArguments(command.action, command.args);
    } catch (error) {
      return {
        ok: false,
        revision: this.state.revision,
        result: null,
        error: error instanceof ProfileValidationError ? "invalid_argument" : "command_failed",
      };
    }
    if (args === undefined) {
      return { ok: false, revision: this.state.revision, result: null, error: "unsupported_command" };
    }

    let changed = false;
    if (command.action === "reset") {
      this.pointerLeaseAcceptedAt = undefined;
      changed = this.commit({ scene: DEFAULT_SCENE, pointer: NEUTRAL_POINTER, reason: "command:reset" });
    } else if (command.action === "set-pulse") {
      changed = this.commit({
        scene: { ...this.state.scene, pulse: args.enabled },
        reason: "command:set-pulse",
      });
    } else if (command.action === "stop-pointer") {
      this.pointerLeaseAcceptedAt = undefined;
      changed = this.commit({ pointer: NEUTRAL_POINTER, reason: "command:stop-pointer" });
    }
    return {
      ok: true,
      revision: this.state.revision,
      result: { changed },
      error: null,
    };
  }

  applyIntent(detail) {
    exactKeys(detail, ["scope", "controls", "sequence", "receivedAt"], "intent");
    if (detail.scope !== MARIONETTE_INTENT_SCOPE) invalid("intent scope is not permitted by this profile.");
    uint32(detail.sequence, "intent.sequence");
    const receivedAt = finiteNumber(detail.receivedAt, 0, Number.MAX_SAFE_INTEGER, "intent.receivedAt");
    const controls = validateIntentControls(detail.controls);

    this.pointerLeaseAcceptedAt = controls.pointer.active ? receivedAt : undefined;
    this.commit({
      scene: { ...this.state.scene, hue: controls.hue },
      pointer: controls.pointer,
      reason: "intent",
    });
    return { revision: this.state.revision, state: this.snapshot() };
  }

  expirePointerLease(at = this.now()) {
    if (!this.state.pointer.active || !Number.isFinite(this.pointerLeaseAcceptedAt)) return false;
    finiteNumber(at, 0, Number.MAX_SAFE_INTEGER, "lease check time");
    if (at - this.pointerLeaseAcceptedAt < this.leaseMs) return false;
    this.pointerLeaseAcceptedAt = undefined;
    return this.commit({ pointer: NEUTRAL_POINTER, reason: "lease-expired" });
  }

  neutralizePointer(reason = "local-stop") {
    this.pointerLeaseAcceptedAt = undefined;
    return this.commit({ pointer: NEUTRAL_POINTER, reason });
  }
}

function defaultScheduler() {
  return {
    setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
    clearInterval: (timer) => globalThis.clearInterval(timer),
  };
}

class ApplicationEndpoint extends EventTarget {
  constructor({
    role,
    transportFactory,
    sessionId,
    sharedSecret,
    peerId,
    now = () => performance.now(),
    scheduler = defaultScheduler(),
  }) {
    super();
    if (role !== "target" && role !== "controller") invalid("role must be target or controller.");
    if (typeof transportFactory !== "function") invalid("transportFactory must be a function invoked only by start().");
    if (typeof sessionId !== "string" || sessionId.length < 8) invalid("sessionId must contain at least eight characters.");
    if (typeof sharedSecret !== "string" || new TextEncoder().encode(sharedSecret).byteLength < 16) {
      invalid("sharedSecret must contain at least 16 UTF-8 bytes; use 192 random bits in production.");
    }
    if (!scheduler || typeof scheduler.setInterval !== "function" || typeof scheduler.clearInterval !== "function") {
      invalid("scheduler must provide setInterval and clearInterval.");
    }
    this.role = role;
    this.transportFactory = transportFactory;
    this.sessionId = sessionId;
    this.sharedSecret = sharedSecret;
    this.peerId = peerId;
    this.now = now;
    this.scheduler = scheduler;
    this.phase = "idle";
    this.transport = undefined;
    this.connection = undefined;
    this.timers = new Set();
    this.connectionListeners = [];
  }

  snapshot() {
    return {
      role: this.role,
      phase: this.phase,
      acceptedScopes: this.connection ? [...this.connection.acceptedScopes] : [],
      capabilities: this.connection ? [...this.connection.negotiatedCapabilities] : [],
    };
  }

  emitPhase(message) {
    this.dispatchEvent(detailEvent("phasechange", { ...this.snapshot(), message }));
  }

  listenConnection(type, listener) {
    this.connection.addEventListener(type, listener);
    this.connectionListeners.push([type, listener]);
  }

  removeConnectionListeners(connection = this.connection) {
    if (connection) {
      for (const [type, listener] of this.connectionListeners) connection.removeEventListener(type, listener);
    }
    this.connectionListeners = [];
  }

  setRepeating(callback, milliseconds) {
    const timer = this.scheduler.setInterval(callback, milliseconds);
    this.timers.add(timer);
    return timer;
  }

  clearTimers() {
    for (const timer of this.timers) this.scheduler.clearInterval(timer);
    this.timers.clear();
  }

  connectionOptions() {
    return {};
  }

  installProfileListeners() {}

  removeProfileListeners() {}

  afterTransportStart() {}

  beforeStop() {}

  async start() {
    if (this.phase !== "idle") invalid("Each endpoint instance may be started exactly once; create a fresh session instance after Stop.");
    this.phase = "starting";
    this.emitPhase("Starting only after the explicit application gesture.");
    try {
      this.transport = this.transportFactory();
      this.connection = new BRSPConnection({
        transport: this.transport,
        role: this.role,
        sessionId: this.sessionId,
        sharedSecret: this.sharedSecret,
        peerId: this.peerId,
        now: this.now,
        capabilities: MARIONETTE_CAPABILITIES,
        requestedScopes: this.role === "controller" ? MARIONETTE_SCOPES : [],
        grantedScopes: this.role === "target" ? MARIONETTE_SCOPES : [],
        ...this.connectionOptions(),
      });
      this.listenConnection("phasechange", (event) => {
        if (event.detail.phase === "error") this.phase = "error";
        else if (event.detail.phase === "disconnected" && this.phase !== "stopping") this.phase = "disconnected";
        this.dispatchEvent(detailEvent("protocolphase", event.detail));
      });
      this.listenConnection("ready", (event) => {
        this.phase = "ready";
        this.emitPhase("Mutually authenticated application profile is ready.");
        this.dispatchEvent(detailEvent("ready", event.detail));
      });
      this.listenConnection("protocolerror", (event) => {
        this.phase = "error";
        this.dispatchEvent(detailEvent("profileerror", event.detail));
      });
      this.installProfileListeners();
      await this.transport.start();
      if (this.phase === "starting") this.phase = "connecting";
      this.afterTransportStart();
      return this.snapshot();
    } catch (error) {
      this.clearTimers();
      const connection = this.connection;
      const transport = this.transport;
      this.removeConnectionListeners(connection);
      this.removeProfileListeners();
      let connectionClosed = false;
      if (connection) {
        try {
          await connection.close();
          connectionClosed = true;
        } catch {
          // The transport fallback below still owns local teardown.
        }
      }
      if (!connectionClosed) {
        try { await transport?.stop?.(); } catch { /* local cleanup remains final */ }
      }
      this.connection = undefined;
      this.transport = undefined;
      this.phase = "error";
      this.emitPhase(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async stop() {
    if (this.phase === "stopped") return;
    this.phase = "stopping";
    this.clearTimers();
    this.beforeStop();
    const connection = this.connection;
    const transport = this.transport;
    this.removeConnectionListeners(connection);
    this.removeProfileListeners();
    this.connection = undefined;
    try {
      if (connection) await connection.close();
      else await transport?.stop?.();
    } catch (error) {
      try { await transport?.stop?.(); } catch { /* preserve the first teardown error */ }
      throw error;
    } finally {
      this.transport = undefined;
      this.phase = "stopped";
      this.emitPhase("Application endpoint stopped; no producer remains active.");
    }
  }
}

export class MarionetteTargetApplication extends ApplicationEndpoint {
  constructor({
    leaseMs = MARIONETTE_DEFAULT_LEASE_MS,
    leaseCheckMs = 50,
    stateHeartbeatMs = 250,
    initialState,
    ...options
  }) {
    super({ ...options, role: "target" });
    this.authority = new MarionetteSceneAuthority({ now: this.now, leaseMs, initialState });
    this.leaseCheckMs = boundedInterval(leaseCheckMs, "leaseCheckMs", {
      minimum: 10,
      maximum: leaseMs,
    });
    this.stateHeartbeatMs = boundedInterval(stateHeartbeatMs, "stateHeartbeatMs", {
      minimum: 50,
      maximum: 1_000,
    });
    this.authorityListeners = [];
  }

  connectionOptions() {
    return {
      getState: () => this.authority.snapshot(),
      applyCommand: (command) => this.authority.applyCommand(command),
      applyIntent: (intent) => this.authority.applyIntent(intent),
    };
  }

  installProfileListeners() {
    this.listenConnection("intenterror", (event) => this.dispatchEvent(detailEvent("profileerror", event.detail)));
    this.listenConnection("command", (event) => this.dispatchEvent(detailEvent("command", event.detail)));
    const listener = (event) => this.dispatchEvent(detailEvent("localstatechange", event.detail));
    this.authority.addEventListener("statechange", listener);
    this.authorityListeners.push(["statechange", listener]);
  }

  removeProfileListeners() {
    for (const [type, listener] of this.authorityListeners) this.authority.removeEventListener(type, listener);
    this.authorityListeners = [];
  }

  afterTransportStart() {
    this.setRepeating(() => { this.checkLease(); }, this.leaseCheckMs);
    this.setRepeating(() => {
      if (this.connection?.phase === "ready") this.connection.publishState(this.authority.snapshot());
    }, this.stateHeartbeatMs);
  }

  checkLease(at = this.now()) {
    const changed = this.authority.expirePointerLease(at);
    if (changed && this.connection?.phase === "ready") {
      this.connection.publishState(this.authority.snapshot());
      this.dispatchEvent(detailEvent("leaseexpired", { state: this.authority.snapshot() }));
    }
    return changed;
  }

  publishAuthoritativeState() {
    if (this.connection?.phase !== "ready") return false;
    return this.connection.publishState(this.authority.snapshot());
  }

  beforeStop() {
    const changed = this.authority.neutralizePointer("target-stop");
    if (changed && this.connection?.phase === "ready") this.connection.publishState(this.authority.snapshot());
  }
}

export class MarionetteControllerApplication extends ApplicationEndpoint {
  constructor({ intentHeartbeatMs = 100, ...options }) {
    super({ ...options, role: "controller" });
    this.intentHeartbeatMs = boundedInterval(intentHeartbeatMs, "intentHeartbeatMs", {
      minimum: 20,
      maximum: 250,
    });
    this.desiredControls = { pointer: { ...NEUTRAL_POINTER }, hue: DEFAULT_SCENE.hue };
    this.authoritativeState = undefined;
    this.pendingCommandId = undefined;
  }

  installProfileListeners() {
    const acceptState = (event) => {
      try {
        const state = validateProfileState(event.detail.state);
        if (event.detail.revision !== state.revision) invalid("BRSP body revision does not match profile state revision.");
        if (this.authoritativeState && state.revision < this.authoritativeState.revision) {
          invalid("Authoritative state revision moved backwards.");
        }
        if (this.authoritativeState
          && state.revision === this.authoritativeState.revision
          && !sameProfileState(state, this.authoritativeState)) {
          invalid("Authoritative state changed without advancing its revision.");
        }
        this.authoritativeState = copyState(state);
        this.dispatchEvent(detailEvent("statechange", { state: copyState(state), source: event.type }));
      } catch (error) {
        this.dispatchEvent(detailEvent("profileerror", {
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    };
    this.listenConnection("snapshot", acceptState);
    this.listenConnection("state", acceptState);
    this.listenConnection("commandapplied", (event) => {
      if (event.detail.commandId === this.pendingCommandId) this.pendingCommandId = undefined;
      this.dispatchEvent(detailEvent("commandapplied", event.detail));
    });
  }

  afterTransportStart() {
    this.setRepeating(() => {
      if (this.connection?.phase === "ready" && this.desiredControls.pointer.active) {
        this.connection.publishIntent(MARIONETTE_INTENT_SCOPE, this.desiredControls);
      }
    }, this.intentHeartbeatMs);
  }

  sendControls(controls) {
    if (this.connection?.phase !== "ready") invalid("Controls are disabled until mutual authentication and ready.");
    const normalized = validateIntentControls(controls);
    this.desiredControls = {
      pointer: copyPointer(normalized.pointer),
      hue: normalized.hue,
    };
    return this.connection.publishIntent(MARIONETTE_INTENT_SCOPE, this.desiredControls);
  }

  releasePointer() {
    return this.sendControls({
      pointer: { ...NEUTRAL_POINTER },
      hue: this.desiredControls.hue,
    });
  }

  sendProfileCommand(action, args, { expectedRevision } = {}) {
    if (this.connection?.phase !== "ready") invalid("Commands are disabled until mutual authentication and ready.");
    if (this.pendingCommandId) invalid("Wait for the current command acknowledgement before sending another command.");
    const normalizedArgs = validateCommandArguments(action, args);
    if (normalizedArgs === undefined) invalid(`Unsupported profile command: ${action}.`);
    const revision = expectedRevision === undefined
      ? (this.authoritativeState?.revision ?? null)
      : expectedRevision;
    if (revision !== null) safeRevision(revision, "expectedRevision");
    this.pendingCommandId = this.connection.sendCommand(
      MARIONETTE_COMMAND_SCOPE,
      action,
      normalizedArgs,
      { expectedRevision: revision },
    );
    return this.pendingCommandId;
  }

  reset(options) {
    return this.sendProfileCommand("reset", {}, options);
  }

  setPulse(enabled, options) {
    return this.sendProfileCommand("set-pulse", { enabled }, options);
  }

  stopPointer(options) {
    return this.sendProfileCommand("stop-pointer", {}, options);
  }

  beforeStop() {
    if (this.connection?.phase === "ready" && this.desiredControls.pointer.active) {
      try {
        this.desiredControls = { pointer: { ...NEUTRAL_POINTER }, hue: this.desiredControls.hue };
        this.connection.publishIntent(MARIONETTE_INTENT_SCOPE, this.desiredControls);
      } catch {
        // Best-effort release only; the target lease is the safety boundary.
      }
    }
    this.pendingCommandId = undefined;
  }
}
