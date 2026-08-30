import { BRSPConnection, canonicalStringify } from "../../src/brsp.js";
import { VdoNinjaTransport } from "../../src/vdo-ninja-transport.js";
import {
  CAPABILITIES,
  CAPABILITY_MANIFEST,
  ECG_PREVIEW_PROFILE,
  EXPECTED_CAPABILITY_HASH,
  REQUESTED_SCOPES,
  redactStateForScopes,
  sanitizeRemoteState,
} from "./profile.js";

export const MAX_PENDING_COMMANDS = 8;
export const MAX_LATENCY_SAMPLES = 256;

function percentile(sorted, fraction) {
  if (!sorted.length) return undefined;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeLatency(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 0.50),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  };
}

function detailEvent(type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail, enumerable: true });
  return event;
}

/** One page-memory controller lifecycle. Constructing it is inert. */
export class PolarRemoteController extends EventTarget {
  constructor({
    transportFactory = (values) => new VdoNinjaTransport(values),
    now = () => performance.now(),
  } = {}) {
    super();
    this.transportFactory = transportFactory;
    this.now = now;
    this.transport = undefined;
    this.session = undefined;
    this.confirmed = { revision: 0, state: {} };
    this.manifestVerified = false;
    this.latencySamples = [];
    this.staleTimer = undefined;
  }

  snapshot() {
    return {
      phase: this.session?.snapshot().phase ?? "idle",
      acceptedScopes: this.session?.snapshot().acceptedScopes ?? [],
      capabilities: this.session?.snapshot().capabilities ?? [],
      stale: this.session?.isStateStale(undefined, 6_000) ?? false,
      revision: this.confirmed.revision,
      state: this.confirmed.state,
      profileCompatible: this.confirmed.state.capabilityHash === EXPECTED_CAPABILITY_HASH,
      manifestVerified: this.manifestVerified,
      commandLatency: summarizeLatency(this.latencySamples),
    };
  }

  emit(type = "change", extra = {}) {
    this.dispatchEvent(detailEvent(type, { ...this.snapshot(), ...extra }));
  }

  async connect(invitation) {
    if (this.session || this.transport) throw new Error("Stop the current session before connecting again.");
    this.confirmed = { revision: 0, state: {} };
    this.manifestVerified = false;
    this.latencySamples = [];
    const { room, session: sessionId, transportSecret, pairingSecret } = invitation;
    const transport = this.transportFactory({
      role: "controller",
      room,
      sharedSecret: transportSecret,
      label: "Polar Remote Quest browser controller",
    });
    const session = new BRSPConnection({
      transport,
      role: "controller",
      sessionId,
      // BRSPConnection generates this endpoint's fresh local epoch. The stable
      // public Beacon ID never selects controller replay state.
      sharedSecret: pairingSecret,
      capabilities: CAPABILITIES,
      requestedScopes: REQUESTED_SCOPES,
      now: this.now,
    });
    this.transport = transport;
    this.session = session;
    const update = () => this.emit();
    session.addEventListener("phasechange", update);
    session.addEventListener("ready", update);
    session.addEventListener("peerclose", update);
    session.addEventListener("protocolerror", (event) => this.emit("error", { message: event.detail.message }));
    session.addEventListener("snapshot", (event) => this.acceptConfirmed(event.detail));
    session.addEventListener("state", (event) => this.acceptConfirmed(event.detail, { replaceEcgPreview: true }));
    session.addEventListener("commandapplied", (event) => {
      const pendingSentAt = event.detail.pending?.sentAt;
      const latencyMs = Number.isFinite(pendingSentAt)
        ? Math.max(0, this.now() - pendingSentAt)
        : undefined;
      if (Number.isFinite(latencyMs)) {
        this.latencySamples.push(latencyMs);
        if (this.latencySamples.length > MAX_LATENCY_SAMPLES) this.latencySamples.shift();
      }
      const applied = { ...event.detail, latencyMs, commandLatency: summarizeLatency(this.latencySamples) };
      if (applied.pending?.action === "request-capabilities") {
        const received = applied.result?.capabilityManifest;
        try {
          this.manifestVerified = applied.ok === true
            && canonicalStringify(received) === canonicalStringify(CAPABILITY_MANIFEST);
        } catch {
          this.manifestVerified = false;
        }
        if (!this.manifestVerified) this.emit("error", { message: "Target capability manifest does not match this controller profile." });
      }
      // Applied responses carry the target-confirmed projection. Consuming it
      // immediately keeps expectedRevision correct even before the next
      // replaceable state update arrives.
      if (applied.result && typeof applied.result === "object") {
        this.acceptConfirmed({ revision: applied.revision, state: applied.result });
      }
      this.emit("applied", applied);
    });
    transport.addEventListener("status", (event) => this.emit("transport", event.detail));
    transport.addEventListener("quality", (event) => this.emit("quality", event.detail));
    this.staleTimer = setInterval(() => this.emit(), 1_000);
    try {
      await transport.start();
      this.emit();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  acceptConfirmed({ revision, state }, { replaceEcgPreview = false } = {}) {
    if (!Number.isSafeInteger(revision) || revision < this.confirmed.revision) return;
    const acceptedScopes = this.session?.snapshot().acceptedScopes ?? [];
    const sanitized = redactStateForScopes(sanitizeRemoteState(state), acceptedScopes);
    const previewScoped = acceptedScopes.includes(ECG_PREVIEW_PROFILE.requiredScope);
    if (!previewScoped) {
      delete sanitized.ecgPreview;
    } else if (!replaceEcgPreview
      && !Object.hasOwn(sanitized, "ecgPreview")
      && Object.hasOwn(this.confirmed.state, "ecgPreview")) {
      sanitized.ecgPreview = this.confirmed.state.ecgPreview;
    }
    this.confirmed = { revision, state: sanitized };
    this.emit("state");
  }

  canSend(command) {
    const session = this.session;
    if (!session) return false;
    const snapshot = session.snapshot();
    return Boolean(snapshot.phase === "ready"
      && snapshot.capabilities.includes("command-ack")
      && snapshot.pendingCommands < MAX_PENDING_COMMANDS
      && snapshot.acceptedScopes.includes(command.scope)
      && (command.action === "request-status"
        || command.action === "request-capabilities"
        || (this.manifestVerified
          && this.confirmed.state.capabilityHash === EXPECTED_CAPABILITY_HASH)));
  }

  send(command) {
    if (!this.canSend(command)) throw new Error("The target has not granted this command scope.");
    const commandId = this.session.sendCommand(command.scope, command.action, command.args ?? {}, {
      expectedRevision: this.confirmed.revision,
    });
    this.emit();
    return commandId;
  }

  async stop() {
    clearInterval(this.staleTimer);
    this.staleTimer = undefined;
    const session = this.session;
    this.session = undefined;
    this.transport = undefined;
    this.manifestVerified = false;
    this.confirmed = { revision: 0, state: {} };
    this.latencySamples = [];
    try { await session?.close(); } finally { this.emit(); }
  }
}
