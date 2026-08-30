import { forwardNativeFrame } from "./bridge-forwarding.js";

const MAX_BYTES = Object.freeze({ control: 16_384, state: 8_192 });
const PEER_KEY = /^[A-Za-z0-9_.:-]{1,96}$/u;

/**
 * One generation-fenced, data-only target transport. The factory is supplied
 * by bundled code and creates the reviewed VDO adapter with audio/video false.
 */
export class QuestTargetTransportLifecycle {
  constructor({ transportFactory, endpoint }) {
    this.transportFactory = transportFactory;
    this.endpoint = endpoint;
    this.operation = 0;
    this.configuration = null;
    this.transport = null;
    this.closedPeers = new Set();
  }

  snapshot() {
    return Object.freeze({
      generation: this.configuration?.generation ?? null,
      active: this.transport !== null,
      operation: this.operation,
    });
  }

  async configure(value) {
    const configuration = normalizeConfiguration(value);
    if (!configuration) return false;
    const operation = ++this.operation;
    this.configuration = configuration;
    this.closedPeers.clear();
    const previous = this.transport;
    this.transport = null;
    await this.safeStop(previous);
    if (!this.isCurrent(operation, configuration, null)) return false;

    const candidate = this.transportFactory(configuration);
    this.transport = candidate;
    this.install(candidate, configuration, operation);
    try {
      await candidate.start();
    } catch {
      if (this.isCurrent(operation, configuration, candidate)) {
        this.transport = null;
        this.configuration = null;
        this.operation += 1;
        this.endpoint.transportDiagnostic(configuration.generation, "error", "unknown", -1);
      }
      await this.safeStop(candidate);
      return false;
    }
    if (!this.isCurrent(operation, configuration, candidate)) {
      await this.safeStop(candidate);
      return false;
    }
    return true;
  }

  /** Clear ownership synchronously before awaiting signaling cleanup. */
  async stop() {
    this.operation += 1;
    this.configuration = null;
    this.closedPeers.clear();
    const closing = this.transport;
    this.transport = null;
    await this.safeStop(closing);
  }

  closePeer(peerKey) {
    if (!validPeerKey(peerKey)) return;
    this.reportPeerClosed(peerKey);
    this.transport?.closePeer(peerKey);
  }

  receive(lane, peerKey, payload) {
    if (!validPeerKey(peerKey) || typeof payload !== "string") return false;
    const sent = forwardNativeFrame(
      { transport: this.transport, configuration: this.configuration, endpoint: this.endpoint },
      lane,
      peerKey,
      payload,
    );
    if (lane === "control" && !sent) this.reportPeerClosed(peerKey);
    return sent;
  }

  install(candidate, configuration, operation) {
    const generation = configuration.generation;
    const current = () => this.isCurrent(operation, configuration, candidate);
    candidate.addEventListener("peeropen", (event) => {
      if (!current() || !validPeerKey(event.detail?.peerKey)) return;
      this.closedPeers.delete(event.detail.peerKey);
      this.endpoint.peerOpened(generation, event.detail.peerKey);
    });
    candidate.addEventListener("peerclose", (event) => {
      if (current()) this.reportPeerClosed(event.detail?.peerKey);
    });
    candidate.addEventListener("status", (event) => {
      if (current()) this.endpoint.transportDiagnostic(
        generation,
        event.detail?.error === true ? "error" : "status",
        "unknown",
        -1,
      );
    });
    candidate.addEventListener("quality", (event) => {
      if (!current()) return;
      const route = ["direct", "relay"].includes(event.detail?.route) ? event.detail.route : "unknown";
      const rttMs = Number.isFinite(event.detail?.rttMs)
        ? Math.max(0, Math.min(60_000, Math.round(event.detail.rttMs)))
        : -1;
      this.endpoint.transportDiagnostic(generation, "quality", route, rttMs);
    });
    for (const lane of ["control", "state"]) {
      candidate.addEventListener(`${lane}message`, (event) => {
        if (!current() || !validPeerKey(event.detail?.peerKey)) return;
        const data = event.detail.data;
        if (typeof data !== "string" || new TextEncoder().encode(data).byteLength > MAX_BYTES[lane]) {
          this.reportPeerClosed(event.detail.peerKey);
          candidate.closePeer(event.detail.peerKey);
          return;
        }
        const result = this.endpoint.postInbound(generation, lane, event.detail.peerKey, data);
        if (result !== "queued" && result !== "accepted") {
          this.reportPeerClosed(event.detail.peerKey);
          candidate.closePeer(event.detail.peerKey);
        }
      });
    }
  }

  reportPeerClosed(peerKey) {
    const generation = this.configuration?.generation;
    if (!Number.isSafeInteger(generation) || !validPeerKey(peerKey) || this.closedPeers.has(peerKey)) return;
    this.closedPeers.add(peerKey);
    this.endpoint.peerClosed(generation, peerKey);
  }

  isCurrent(operation, configuration, candidate) {
    return this.operation === operation
      && this.configuration === configuration
      && this.transport === candidate;
  }

  async safeStop(value) {
    try {
      await value?.stop();
    } catch {
      // Native generation fencing and revocation remain authoritative.
    }
  }
}

function normalizeConfiguration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const generation = Number(value.generation);
  if (!Number.isSafeInteger(generation) || generation < 1) return null;
  if (typeof value.room !== "string" || !/^[A-Za-z0-9_]{12,64}$/u.test(value.room)) return null;
  if (typeof value.transportSecret !== "string" || !/^[A-Za-z0-9_-]{43,128}$/u.test(value.transportSecret)) return null;
  return Object.freeze({ room: value.room, transportSecret: value.transportSecret, generation });
}

function validPeerKey(value) {
  return typeof value === "string" && PEER_KEY.test(value);
}
