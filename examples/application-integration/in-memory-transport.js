function detailEvent(type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail, enumerable: true });
  return event;
}

class InMemoryTransport extends EventTarget {
  constructor(name, peerKey) {
    super();
    this.name = name;
    this.peerKey = peerKey;
    this.phase = "idle";
    this.partner = undefined;
    this.open = false;
    this.stats = {
      controlSent: 0,
      stateSent: 0,
      starts: 0,
      stops: 0,
    };
  }

  connect(partner) {
    this.partner = partner;
  }

  start() {
    if (this.phase !== "idle") throw new Error(`${this.name} in-memory transport may be started only once.`);
    this.phase = "started";
    this.stats.starts += 1;
    this.openPairWhenReady();
    return Promise.resolve({ phase: this.phase });
  }

  openPairWhenReady() {
    if (this.phase !== "started" || this.partner?.phase !== "started" || this.open || this.partner.open) return;
    this.open = true;
    this.partner.open = true;
    queueMicrotask(() => {
      if (this.open) this.dispatchEvent(detailEvent("peeropen", { peerKey: this.peerKey }));
      if (this.partner.open) this.partner.dispatchEvent(detailEvent("peeropen", { peerKey: this.peerKey }));
    });
  }

  sendControl(peerKey, data) {
    if (!this.open || peerKey !== this.peerKey || !this.partner?.open) return false;
    this.stats.controlSent += 1;
    const receiver = this.partner;
    queueMicrotask(() => {
      if (receiver.open) receiver.dispatchEvent(detailEvent("controlmessage", { peerKey, data }));
    });
    return true;
  }

  sendState(peerKey, data) {
    if (!this.open || peerKey !== this.peerKey || !this.partner?.open) return false;
    this.stats.stateSent += 1;
    const receiver = this.partner;
    queueMicrotask(() => {
      if (receiver.open) receiver.dispatchEvent(detailEvent("statemessage", { peerKey, data }));
    });
    return true;
  }

  closePeer(peerKey) {
    if (peerKey !== this.peerKey) return;
    this.closePair("Peer closed the in-memory link.");
  }

  closePair(reason) {
    const localWasOpen = this.open;
    const remoteWasOpen = this.partner?.open === true;
    this.open = false;
    if (this.partner) this.partner.open = false;
    if (localWasOpen) queueMicrotask(() => this.dispatchEvent(detailEvent("peerclose", { peerKey: this.peerKey, reason })));
    if (remoteWasOpen) {
      const receiver = this.partner;
      queueMicrotask(() => receiver.dispatchEvent(detailEvent("peerclose", { peerKey: this.peerKey, reason })));
    }
  }

  async stop() {
    if (this.phase === "closed") return;
    this.stats.stops += 1;
    this.closePair(`${this.name} stopped the in-memory link.`);
    this.phase = "closed";
  }
}

export function createInMemoryTransportPair({ peerKey = "application-integration-link" } = {}) {
  const target = new InMemoryTransport("target", peerKey);
  const controller = new InMemoryTransport("controller", peerKey);
  target.connect(controller);
  controller.connect(target);
  return { target, controller };
}

