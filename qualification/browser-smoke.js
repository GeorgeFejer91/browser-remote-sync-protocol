import { BRSPConnection } from "../src/brsp.js";

class LoopbackTransport extends EventTarget {
  constructor() {
    super();
    this.other = undefined;
    this.peerKey = "browser-smoke-peer";
    this.sent = 0;
    this.closed = false;
  }

  connect(other) {
    this.other = other;
    other.other = this;
  }

  emit(type, detail) {
    const event = new Event(type);
    Object.defineProperty(event, "detail", { value: detail });
    this.dispatchEvent(event);
  }

  open() {
    this.emit("peeropen", { peerKey: this.peerKey });
  }

  sendControl(peerKey, data) {
    return this.send("controlmessage", peerKey, data);
  }

  sendState(peerKey, data) {
    return this.send("statemessage", peerKey, data);
  }

  send(type, peerKey, data) {
    if (this.closed || peerKey !== this.peerKey) return false;
    this.sent += 1;
    queueMicrotask(() => this.other.emit(type, { peerKey, data }));
    return true;
  }

  closePeer(peerKey) {
    if (peerKey === this.peerKey) this.closed = true;
  }

  async stop() {
    this.closed = true;
  }
}

function eventOnce(target, type, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(type, handler);
      reject(new Error(`Timed out waiting for ${type}.`));
    }, 2_000);
    const handler = (event) => {
      if (!predicate(event.detail)) return;
      clearTimeout(timer);
      target.removeEventListener(type, handler);
      resolve(event.detail);
    };
    target.addEventListener(type, handler);
  });
}

function require(condition, message) {
  if (!condition) throw new Error(message);
}

async function qualify() {
  const targetTransport = new LoopbackTransport();
  const controllerTransport = new LoopbackTransport();
  targetTransport.connect(controllerTransport);
  const state = { revision: 0, value: 0 };

  const target = new BRSPConnection({
    transport: targetTransport,
    role: "target",
    sessionId: "browser_smoke_session",
    sharedSecret: "local-only-browser-smoke-secret",
    peerId: "browser_smoke_target",
    capabilities: ["command-ack", "state-snapshot", "latest-state", "latest-intent"],
    grantedScopes: ["value.write"],
    getState: () => ({ ...state }),
    applyCommand: ({ action, args, expectedRevision }) => {
      if (action !== "set-value" || typeof args.value !== "number" || !Number.isFinite(args.value)) {
        return { ok: false, revision: state.revision, error: "invalid_command" };
      }
      if (expectedRevision !== null && expectedRevision !== state.revision) {
        return { ok: false, revision: state.revision, error: "revision_conflict" };
      }
      state.value = Math.max(-1, Math.min(1, args.value));
      state.revision += 1;
      return { ok: true, revision: state.revision, result: { value: state.value } };
    },
    applyIntent: ({ controls }) => {
      if (typeof controls.value !== "number" || !Number.isFinite(controls.value)) {
        throw new TypeError("intent value must be finite");
      }
      state.value = Math.max(-1, Math.min(1, controls.value));
      state.revision += 1;
      return { revision: state.revision, state: { ...state } };
    },
  });
  const controller = new BRSPConnection({
    transport: controllerTransport,
    role: "controller",
    sessionId: "browser_smoke_session",
    sharedSecret: "local-only-browser-smoke-secret",
    peerId: "browser_smoke_controller",
    capabilities: ["command-ack", "state-snapshot", "latest-state", "latest-intent"],
    requestedScopes: ["value.write", "admin"],
  });

  require(targetTransport.sent === 0 && controllerTransport.sent === 0, "construction must be inert");
  const ready = Promise.all([eventOnce(target, "ready"), eventOnce(controller, "ready")]);
  targetTransport.open();
  controllerTransport.open();
  const [, controllerReady] = await ready;
  require(controllerReady.acceptedScopes.join() === "value.write", "least-authority scope negotiation failed");

  const appliedEvent = eventOnce(controller, "commandapplied");
  const commandStateEvent = eventOnce(controller, "state", ({ revision }) => revision === 1);
  const commandId = controller.sendCommand("value.write", "set-value", { value: 0.75 }, { expectedRevision: 0 });
  const [applied, commandState] = await Promise.all([appliedEvent, commandStateEvent]);
  require(applied.commandId === commandId && applied.ok && applied.revision === 1, "reliable command acknowledgement failed");
  require(commandState.state.value === 0.75, "authoritative command state did not return");

  const intentStateEvent = eventOnce(controller, "state", ({ revision }) => revision === 2);
  require(controller.publishIntent("value.write", { value: -0.4 }), "live intent was not offered");
  const intentState = await intentStateEvent;
  require(intentState.state.value === -0.4, "authoritative intent state did not return");

  state.value = 0.2;
  state.revision += 1;
  const localStateEvent = eventOnce(controller, "state", ({ revision }) => revision === 3);
  require(target.publishState(), "target local state was not offered");
  require((await localStateEvent).state.value === 0.2, "target-local change did not converge");

  await Promise.all([target.close(), controller.close()]);
  await Promise.all([target.close(), controller.close()]);
  return {
    authenticated: true,
    acceptedScopes: controllerReady.acceptedScopes,
    commandRevision: applied.revision,
    intentRevision: intentState.revision,
    targetLocalRevision: state.revision,
    finalValue: state.value,
    idempotentStop: true,
    transport: "in-process deterministic browser smoke",
  };
}

const result = document.querySelector("#result");
const evidence = document.querySelector("#evidence");
try {
  const record = await qualify();
  result.dataset.status = "pass";
  result.textContent = "PASS — handshake, command, live intent, authoritative return, and teardown converged.";
  evidence.textContent = JSON.stringify(record, null, 2);
} catch (error) {
  result.dataset.status = "fail";
  result.textContent = `FAIL — ${error instanceof Error ? error.message : String(error)}`;
  evidence.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
}
