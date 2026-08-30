import { VdoNinjaTransport } from "../../../src/vdo-ninja-transport.js";
import { QuestTargetTransportLifecycle } from "./transport-lifecycle.js";

// Construction is inert. The SDK/transport is instantiated only when native
// code invokes the fixed configure method after a headset-local Enable action.
const lifecycle = new QuestTargetTransportLifecycle({
  endpoint: window.QuestRemoteTransport,
  transportFactory: (configuration) => new VdoNinjaTransport({
    role: "target",
    room: configuration.room,
    sharedSecret: configuration.transportSecret,
    label: "Native Meta Quest BRSP target",
  }),
});

window.QuestRemoteTransportBridge = Object.freeze({
  configure: (json) => {
    try {
      void lifecycle.configure(JSON.parse(json));
    } catch {
      void lifecycle.stop();
    }
  },
  stop: () => { void lifecycle.stop(); },
  closePeer: (peerKey) => lifecycle.closePeer(peerKey),
  receive: (lane, peerKey, payload) => lifecycle.receive(lane, peerKey, payload),
});

window.addEventListener("pagehide", () => { void lifecycle.stop(); }, { once: true });
