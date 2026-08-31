/**
 * Thin application-authority adapter for BRSP targets.
 *
 * BRSPConnection owns authentication, negotiation, wire validation, lanes,
 * sequencing, acknowledgements, and snapshots. BRSPApplicationTarget owns the
 * exact application allow-list, authoritative revision, reducer dispatch, and
 * public state projection that should be shared by local and remote callers.
 */

import { canonicalStringify } from "./brsp.js";

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const BASE_CAPABILITIES = Object.freeze(["command-ack", "latest-state", "state-snapshot"]);

function fail(message) {
  throw new TypeError(message);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertToken(value, label) {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    fail(`${label} must be a 1-64 character protocol token.`);
  }
  return value;
}

function assertRevision(value, label = "revision") {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer.`);
  return value;
}

function cloneJson(value, label) {
  try {
    return JSON.parse(canonicalStringify(value));
  } catch (error) {
    fail(`${label} must be bounded JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function cloneObject(value, label) {
  const cloned = cloneJson(value, label);
  if (!plainObject(cloned)) fail(`${label} must be an object.`);
  return cloned;
}

function detailEvent(type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail, enumerable: true });
  return event;
}

function commandKey(scope, action) {
  return `${scope}\u0000${action}`;
}

function normalizeRejection(decision, fallback = "command_rejected") {
  const error = assertToken(decision?.error ?? fallback, "application rejection error");
  return {
    ok: false,
    error,
    result: cloneJson(decision?.result ?? null, "application rejection result"),
  };
}

function normalizeAcceptedDecision(decision, currentState) {
  if (!plainObject(decision)) fail("An application reducer must return a decision object.");
  if (decision.ok === false) return normalizeRejection(decision);
  const changed = decision.changed !== false;
  const state = changed
    ? cloneObject(decision.state, "application reducer state")
    : cloneObject(currentState, "current application state");
  return {
    ok: true,
    changed,
    state,
    result: cloneJson(decision.result ?? null, "application reducer result"),
  };
}

function validateDescriptorList(items, kind) {
  if (!Array.isArray(items) || items.length > 128) fail(`${kind} descriptors must be an array of at most 128 items.`);
  return items;
}

/** Return a bounded reducer rejection without throwing. */
export function rejectApplicationAction(error = "command_rejected", result = null) {
  return Object.freeze({
    ok: false,
    error: assertToken(error, "application rejection error"),
    result: cloneJson(result, "application rejection result"),
  });
}

/**
 * Target-owned application state and exact command/intent registry.
 *
 * Command descriptor:
 *   { scope, action, validate?, reduce }
 * Intent descriptor:
 *   { scope, validate, reduce }
 *
 * Validators and reducers receive copied state and payload values. A reducer
 * returns { state, result?, changed? } or rejectApplicationAction(...).
 */
export class BRSPApplicationTarget extends EventTarget {
  constructor({
    profile,
    initialState,
    initialRevision = 0,
    projectState = (state) => state,
    commands = [],
    intents = [],
  }) {
    super();
    this.profile = assertToken(profile, "application profile");
    this.revision = assertRevision(initialRevision, "initialRevision");
    this.state = cloneObject(initialState, "initialState");
    delete this.state.revision;
    if (typeof projectState !== "function") fail("projectState must be a function.");
    this.projectState = projectState;
    this.commandHandlers = new Map();
    this.intentHandlers = new Map();
    this.registeredScopes = new Set();
    this.commandChain = Promise.resolve();
    this.latestRemoteIntentSequence = undefined;

    for (const descriptor of validateDescriptorList(commands, "command")) this.registerCommand(descriptor);
    for (const descriptor of validateDescriptorList(intents, "intent")) this.registerIntent(descriptor);
    // Validate the initial public projection at construction time.
    this.getPublicState();
  }

  registerCommand(descriptor) {
    if (!plainObject(descriptor)) fail("A command descriptor must be an object.");
    const scope = assertToken(descriptor.scope, "command scope");
    const action = assertToken(descriptor.action, "command action");
    if (descriptor.validate !== undefined && typeof descriptor.validate !== "function") {
      fail(`Command ${scope}/${action} validate must be a function.`);
    }
    if (typeof descriptor.reduce !== "function") fail(`Command ${scope}/${action} reduce must be a function.`);
    const key = commandKey(scope, action);
    if (this.commandHandlers.has(key)) fail(`Duplicate command descriptor: ${scope}/${action}.`);
    this.commandHandlers.set(key, Object.freeze({
      scope,
      action,
      validate: descriptor.validate,
      reduce: descriptor.reduce,
    }));
    this.registeredScopes.add(scope);
  }

  registerIntent(descriptor) {
    if (!plainObject(descriptor)) fail("An intent descriptor must be an object.");
    const scope = assertToken(descriptor.scope, "intent scope");
    if (typeof descriptor.validate !== "function") fail(`Intent ${scope} validate must be a function.`);
    if (typeof descriptor.reduce !== "function") fail(`Intent ${scope} reduce must be a function.`);
    if (this.intentHandlers.has(scope)) fail(`Duplicate intent descriptor: ${scope}.`);
    this.intentHandlers.set(scope, Object.freeze({
      scope,
      validate: descriptor.validate,
      reduce: descriptor.reduce,
    }));
    this.registeredScopes.add(scope);
  }

  describe() {
    return {
      profile: this.profile,
      scopes: [...this.registeredScopes].sort(),
      commands: [...this.commandHandlers.values()]
        .map(({ scope, action }) => ({ scope, action }))
        .sort((left, right) => `${left.scope}/${left.action}`.localeCompare(`${right.scope}/${right.action}`)),
      intentScopes: [...this.intentHandlers.keys()].sort(),
    };
  }

  getAuthoritativeState() {
    return { ...cloneObject(this.state, "authoritative state"), revision: this.revision };
  }

  getPublicState() {
    const projected = cloneObject(
      this.projectState(this.getAuthoritativeState()),
      "public state projection",
    );
    projected.revision = this.revision;
    return cloneObject(projected, "public state projection");
  }

  connectionOptions({ grantedScopes, capabilities = [] } = {}) {
    if (!Array.isArray(grantedScopes)) fail("connectionOptions requires an explicit grantedScopes array.");
    const uniqueScopes = [...new Set(grantedScopes.map((scope) => assertToken(scope, "granted scope")))].sort();
    if (uniqueScopes.length !== grantedScopes.length) fail("grantedScopes must not contain duplicates.");
    for (const scope of uniqueScopes) {
      if (!this.registeredScopes.has(scope)) fail(`Cannot grant unregistered application scope: ${scope}.`);
    }
    if (!Array.isArray(capabilities)) fail("capabilities must be an array.");
    const negotiated = new Set(BASE_CAPABILITIES);
    for (const capability of capabilities) negotiated.add(assertToken(capability, "capability"));
    if (uniqueScopes.some((scope) => this.intentHandlers.has(scope))) negotiated.add("latest-intent");
    return {
      capabilities: [...negotiated].sort(),
      grantedScopes: uniqueScopes,
      getState: () => this.getPublicState(),
      applyCommand: (command) => this.applyCommand(command, { source: "remote" }),
      applyIntent: (intent) => this.applyIntent(intent, { source: "remote" }),
    };
  }

  applyCommand(command, { source = "remote" } = {}) {
    const pending = this.commandChain.then(() => this.applyCommandNow(command, { source }));
    this.commandChain = pending.catch(() => undefined);
    return pending;
  }

  dispatchLocalCommand(scope, action, args = {}, { expectedRevision = null } = {}) {
    return this.applyCommand({ scope, action, args, expectedRevision }, { source: "local" });
  }

  async applyCommandNow(command, { source }) {
    if (!plainObject(command)) fail("Application command must be an object.");
    const scope = assertToken(command.scope, "command scope");
    const action = assertToken(command.action, "command action");
    const args = cloneJson(command.args ?? {}, "command args");
    const expectedRevision = command.expectedRevision ?? null;
    if (expectedRevision !== null) assertRevision(expectedRevision, "expectedRevision");
    const descriptor = this.commandHandlers.get(commandKey(scope, action));
    if (!descriptor) return this.rejectedCommand({ scope, action, source }, "unsupported_command");
    if (expectedRevision !== null && expectedRevision !== this.revision) {
      return this.rejectedCommand({ scope, action, source }, "revision_conflict");
    }

    const baseRevision = this.revision;
    const baseState = this.getAuthoritativeState();
    let valid;
    try {
      valid = descriptor.validate === undefined
        ? plainObject(args) && Object.keys(args).length === 0
        : await descriptor.validate({ state: cloneObject(baseState, "validator state"), args: cloneJson(args, "validator args"), source });
    } catch {
      return this.rejectedCommand({ scope, action, source }, "invalid_argument");
    }
    if (valid !== true) return this.rejectedCommand({ scope, action, source }, "invalid_argument");
    try {
      const rawDecision = await descriptor.reduce({
        state: cloneObject(baseState, "reducer state"),
        args: cloneJson(args, "reducer args"),
        source,
      });
      const decision = normalizeAcceptedDecision(rawDecision, baseState);
      if (!decision.ok) return this.rejectedCommand({ scope, action, source }, decision.error, decision.result);
      if (this.revision !== baseRevision) {
        return this.rejectedCommand({ scope, action, source }, "revision_conflict");
      }
      if (decision.changed) this.commit(decision.state, { source, scope, action, lane: "command" });
      const outcome = { ok: true, revision: this.revision, result: decision.result };
      this.dispatchEvent(detailEvent("commandapplied", { profile: this.profile, scope, action, source, ...outcome }));
      return outcome;
    } catch (error) {
      this.dispatchEvent(detailEvent("applicationerror", {
        profile: this.profile,
        scope,
        action,
        source,
        revision: this.revision,
        message: error instanceof Error ? error.message.slice(0, 256) : "Application command failed.",
      }));
      return this.rejectedCommand({ scope, action, source }, "command_failed");
    }
  }

  rejectedCommand(context, error, result = null) {
    const outcome = {
      ok: false,
      revision: this.revision,
      result: cloneJson(result, "command rejection result"),
      error: assertToken(error, "command rejection error"),
    };
    this.dispatchEvent(detailEvent("commandrejected", { profile: this.profile, ...context, ...outcome }));
    return outcome;
  }

  async applyIntent(intent, { source = "remote" } = {}) {
    if (!plainObject(intent)) fail("Application intent must be an object.");
    const scope = assertToken(intent.scope, "intent scope");
    const descriptor = this.intentHandlers.get(scope);
    if (!descriptor) fail(`No intent reducer is registered for scope ${scope}.`);
    const controls = cloneJson(intent.controls, "intent controls");
    const sequence = intent.sequence;
    if (source === "remote") {
      if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffff_ffff) fail("Remote intent sequence must be uint32.");
      this.latestRemoteIntentSequence = sequence >>> 0;
    }
    const baseRevision = this.revision;
    const baseState = this.getAuthoritativeState();

    try {
      const valid = await descriptor.validate({
        state: cloneObject(baseState, "intent validator state"),
        controls: cloneJson(controls, "intent validator controls"),
        source,
      });
      if (valid !== true) fail("Intent controls failed application validation.");
      const rawDecision = await descriptor.reduce({
        state: cloneObject(baseState, "intent reducer state"),
        controls: cloneJson(controls, "intent reducer controls"),
        sequence,
        receivedAt: intent.receivedAt,
        source,
      });
      const decision = normalizeAcceptedDecision(rawDecision, baseState);
      if (!decision.ok) fail(`Intent reducer rejected the update: ${decision.error}.`);
      const superseded = (source === "remote" && this.latestRemoteIntentSequence !== (sequence >>> 0))
        || this.revision !== baseRevision;
      if (!superseded && decision.changed) this.commit(decision.state, { source, scope, lane: "intent" });
      const outcome = { revision: this.revision, state: this.getPublicState(), superseded };
      this.dispatchEvent(detailEvent(superseded ? "intentsuperseded" : "intentapplied", {
        profile: this.profile,
        scope,
        source,
        sequence,
        revision: this.revision,
      }));
      return outcome;
    } catch (error) {
      this.dispatchEvent(detailEvent("intentrejected", {
        profile: this.profile,
        scope,
        source,
        sequence,
        revision: this.revision,
        message: error instanceof Error ? error.message.slice(0, 256) : "Application intent failed.",
      }));
      throw error;
    }
  }

  dispatchLocalIntent(scope, controls) {
    return this.applyIntent({ scope, controls }, { source: "local" });
  }

  commit(nextState, context) {
    if (this.revision >= Number.MAX_SAFE_INTEGER) fail("Application revision is exhausted.");
    const normalized = cloneObject(nextState, "next authoritative state");
    delete normalized.revision;
    this.state = normalized;
    this.revision += 1;
    this.dispatchEvent(detailEvent("statechange", {
      profile: this.profile,
      revision: this.revision,
      ...context,
      state: this.getPublicState(),
    }));
  }
}
