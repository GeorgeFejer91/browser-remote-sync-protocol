# 12 — Copyable application integration recipes

This chapter is the shortest path from the BRSP reference implementation to a real application. It does not replace the normative [BRSP/1 specification](03-protocol-specification.md), [threat model](02-threat-model-and-privacy.md), or [Marionette profile](11-marionette-companion-profile.md). It shows where each responsibility belongs and gives a concrete assembly order.

The companion starter modules are in [`examples/application-integration/`](../examples/application-integration/README.md). They are deliberately application-semantic: no selector, DOM-operation, keystroke, shell, file, credential, or arbitrary-code command crosses the session.

## Choose the topology first

| Product shape | Target | Controller | Recommended first adapter |
| --- | --- | --- | --- |
| Browser app plus phone companion | Primary browser page | HTTPS phone page | VDO.Ninja data-only when no real-time backend exists |
| Tauri desktop app plus phone browser | Bundled local WebView, with typed native IPC behind it | HTTPS phone page | VDO.Ninja in the WebView; see [13](13-native-shell-webview-integration.md) |
| Existing authenticated web product | Browser connected to product backend | Browser/phone connected to same backend | WebSocket with server authorization and fan-out |
| Offline private LAN | Browser/native target on the LAN | LAN browser | Owned signaling plus raw WebRTC, or a deliberately deployed WSS service |
| Command-line or automation client | App reducer behind an authenticated endpoint | Native CLI/service | BRSP envelopes over an owned WebSocket/raw-WebRTC adapter; never a remote shell |

VDO.Ninja is not an offline-LAN protocol. It may select a direct path over local Wi-Fi, but the supplied adapter still uses Internet signaling and external ICE services. Read the exact boundary in [14 — Deployment, network, and CSP](14-deployment-network-and-csp.md).

## The application contract

Before importing the transport, write one profile that answers five questions:

1. What exact state is authoritative?
2. Which `(scope, action)` pairs exist?
3. What is the exact argument/result schema for each command?
4. Which current controls are replaceable intent, and which are discrete transactions?
5. What expires, holds, or returns to neutral after control is lost?

A compact profile can look like this:

```js
export const PROFILE = Object.freeze({
  id: "example-scene",
  version: 1,
  capabilities: [
    "command-ack",
    "latest-intent",
    "latest-state",
    "marionette-controls-v1",
    "state-snapshot",
  ],
  scopes: ["scene.write"],
});

export const MANIFEST = Object.freeze({
  profile: "brsp-marionette-controls",
  version: 1,
  title: "Scene remote",
  controls: [
    {
      id: "reset",
      kind: "command-button",
      scope: "scene.write",
      action: "reset",
      label: "Reset scene",
    },
    {
      id: "position",
      kind: "joystick-2d",
      scope: "scene.write",
      label: "Position",
      minimum: -1,
      maximum: 1,
      expiry: "neutral",
      leaseMs: 500,
    },
  ],
});
```

The manifest is data, not code. The phone renders only fixed known control kinds, uses labels as text, ignores unknown kinds visibly, and never turns manifest values into HTML, a function name, module, URL, selector, or native operation.

## Authoritative target reducer

Local target UI and remote commands must call the same reducer. Validate the exact object shape before mutating state:

```js
const COMMANDS = new Map([
  ["scene.write:reset", ({ state, expectedRevision }) => {
    if (expectedRevision !== null && expectedRevision !== state.revision) {
      return { ok: false, revision: state.revision, error: "revision_conflict" };
    }
    const next = {
      revision: state.revision + 1,
      scene: { x: 0, y: 0 },
    };
    return { ok: true, state: next, revision: next.revision, result: null };
  }],
]);

export function applyCommand(state, command) {
  const handler = COMMANDS.get(`${command.scope}:${command.action}`);
  if (!handler) {
    return { ok: false, revision: state.revision, error: "unsupported_command" };
  }
  return handler({ state, ...command });
}
```

Production validators must reject unexpected fields, unsafe keys, non-finite numbers, wrong types, excessive arrays/strings, and application values outside the declared profile. BRSP validates the common bounded JSON envelope; only the application knows whether `{ x: 0.4, y: -0.2 }` is a legal scene.

Keep these values separate:

```text
localIntent          local user's current request
authoritativeState   target/host-owned accepted state
presentationState    smoothing, animation, phone camera, accessibility
```

Rendering a returned state must not call the outbound intent path. That separation prevents a host-authored Party placement from echoing back as if the guest moved.

## Browser target recipe

The target announces one data-only source and grants the smallest scopes. Constructing the objects performs no network work; `transport.start()` belongs inside the current Start gesture:

```js
import { BRSPConnection, randomToken } from "/src/brsp.js";
import { VdoNinjaTransport, generateVdoRoomId } from "/src/vdo-ninja-transport.js";

let authoritativeState = {
  revision: 0,
  profile: { id: PROFILE.id, version: PROFILE.version },
  manifest: MANIFEST,
  scene: { x: 0, y: 0 },
};

export async function startTarget() {
  const room = generateVdoRoomId();
  const sharedSecret = randomToken(24); // 192 random bits before base64url encoding
  const transport = new VdoNinjaTransport({
    role: "target",
    room,
    sharedSecret,
    label: "Example scene target",
  });
  const session = new BRSPConnection({
    transport,
    role: "target",
    sessionId: room,
    sharedSecret,
    capabilities: PROFILE.capabilities,
    grantedScopes: PROFILE.scopes,
    getState: () => structuredClone(authoritativeState),
    applyCommand: async (command) => {
      const outcome = applyCommand(authoritativeState, command);
      if (outcome.ok) authoritativeState = outcome.state;
      renderTarget(authoritativeState);
      return outcome;
    },
    applyIntent: (intent) => applyLatestIntent(intent),
  });
  await transport.start();
  return { room, sharedSecret, session, transport };
}
```

The example uses `structuredClone` only for a small plain-data snapshot. Do not rely on cloning as validation, and do not include credentials, private records, native handles, or arbitrary application stores.

On each accepted target change, call `session.publishState()`. Repeat current authoritative state on the documented heartbeat even when unchanged. The generic profile uses 250 ms. A measured high-rate numeric profile may use another rate, but it must preserve the newest-only queue and publish evidence for the chosen values.

## Smartphone controller recipe

The phone requests rather than grants scopes. It connects to the target's advertised stream and renders only target-returned state:

```js
export async function startController({ room, sharedSecret }) {
  const transport = new VdoNinjaTransport({
    role: "controller",
    room,
    sharedSecret,
    label: "Example phone controller",
  });
  const session = new BRSPConnection({
    transport,
    role: "controller",
    sessionId: room,
    sharedSecret,
    capabilities: PROFILE.capabilities,
    requestedScopes: PROFILE.scopes,
  });

  session.addEventListener("snapshot", ({ detail }) => {
    const value = validateTargetSnapshot(detail);
    renderManifest(value.state.manifest);
    renderConfirmedState(value.state);
  });
  session.addEventListener("state", ({ detail }) => {
    renderConfirmedState(validateTargetState(detail));
  });
  session.addEventListener("commandapplied", showAppliedResult);
  await transport.start();
  return { session, transport };
}
```

Do not enable a control until all three conditions hold:

- BRSP phase is `ready`;
- the required capability was negotiated;
- the control scope appears in `acceptedScopes`.

For a button where every edge matters:

```js
const commandId = session.sendCommand(
  "scene.write",
  "reset",
  {},
  { expectedRevision: lastConfirmedRevision },
);
```

Show pending until the matching `commandapplied` event. A transport send does not mean the target applied the action.

For a joystick or absolute slider where a newer complete value replaces an older value:

```js
session.publishIntent("scene.write", {
  position: { x: normalizedX, y: normalizedY, active: true },
});
```

Coalesce changed intent to at most the display/application rate. Only a currently owned `expiry: "neutral"` control needs the 100 ms intent heartbeat. Do not keep re-sending a persistent idle slider merely because the controller remains connected.

The target, not the phone's final `pointerup`, enforces a receiver-local lease. When the lease expires, it neutralizes the relevant controls through the same reducer, increments revision when state changes, and publishes the result.

## Phone perspective is presentation state

When both screens show a shared spatial scene, synchronize world semantics—not raw pixels. The phone can apply a local camera after authoritative state is received:

```text
world scene from host -> phone-local camera projection -> phone pixels
phone pointer         -> inverse camera              -> world intent
```

One-finger empty-space pan, two-finger pinch, and Reset may be smartphone-only. Do not transmit, persist, record, or feed camera values into authoritative state. Everyone can receive the same roster, object positions, appearance parameters, and phase while unequal viewports project them differently.

## Marionette socket and semantic command line

Treat a controller API as a narrow semantic socket:

```text
connect(invitation)
command(scope, action, validatedArgs, expectedRevision) -> applied
offerIntent(scope, completeCurrentControls)              -> target state
observeState()                                            -> snapshots/state
stop()
```

A native CLI or automation client can expose commands such as:

```text
scene-remote reset --expected-revision 41
scene-remote set-position --x 0.25 --y -0.5
```

The CLI parser must map those fixed subcommands to the same allow-listed BRSP `(scope, action, args)` objects. It must not forward a shell line, JavaScript, selector, URL, file path, environment variable, or generic method name to the target. Store long-term identity and tokens in the product's normal secure credential system; BRSP's direct session secret is short-lived pairing material, not a durable CLI credential.

VDO.Ninja's reference adapter is browser-JavaScript-oriented. A native CLI will usually use an owned authenticated WebSocket adapter or a native WebRTC library. It still reproduces BRSP canonical JSON/HMAC fixtures exactly and preserves control/state separation, bounds, scopes, revisions, dedupe, freshness, and teardown.

## Transport substitution

The application profile above does not change when the transport changes, but adapter claims do:

| Adapter | Connection owner | Control lane | Replaceable lane | Main operational boundary |
| --- | --- | --- | --- | --- |
| VDO.Ninja data-only | Browser peers via managed signaling | Ordered reliable RTCDataChannel | Unordered zero-retry RTCDataChannel | Hosted signaling/STUN/TURN and peer network metadata |
| Product WebSocket | Each client to product backend | WebSocket messages | Coalesce before entering the reliable socket queue | Backend identity, authorization, routing, queue bounds, audit |
| Raw WebRTC | Browser/native peers via owned signaling | Ordered reliable RTCDataChannel | Unordered zero-retry RTCDataChannel | Signaling authentication, ICE/TURN credentials, recovery and operations |
| WebTransport | Each client to HTTP/3 server | Framed reliable stream | Datagram or app-coalesced stream | Server routing, browser/network support, certificates and fallback |

A WebSocket cannot withdraw bytes already handed to its reliable queue. Implement newest-only behavior before enqueue, bound the server's per-session queues, and send a fresh snapshot after reconnect.

## One lifecycle owner

Create one idempotent owner for the page or WebView session. It must know every producer and listener:

```js
async function stopSession() {
  if (phase === "idle" || phase === "stopping") return;
  phase = "stopping";
  inputAbortController.abort();
  cancelAnimationFrame(intentFrame);
  clearInterval(intentHeartbeat);
  clearInterval(stateHeartbeat);
  clearInterval(staleCheck);
  neutralizeLocalPresentation();
  const closing = session;
  session = undefined;
  transport = undefined;
  try { await closing?.close(); } finally { phase = "idle"; }
}
```

Use the same routine for Stop, `pagehide`, failed partial Start, component unmount, window destruction, and explicit application quit. Producers are cancelled before awaiting signaling cleanup. A final neutral packet is helpful but never replaces the target lease.

On a new peer connection, create a new epoch/nonce, repeat proof/ready, and request a fresh snapshot. Do not silently preserve authenticated readiness or switch ownership to a newly advertised target. The VDO adapter requires explicit selection if more than one matching target is discovered.

## Party/shared-scene extension

For one host and bounded guests, create one independently authenticated connection per guest. Each guest sends only its own intent. The host owns roster/order/shared visuals/layout, builds one bounded versioned aggregate, and fans the same encoded aggregate through every guest connection.

“Same scene” means the same semantic aggregate: participants, stable IDs/order, world positions, public appearance parameters, stale flags, and shared phase. It does not require identical pixels on different aspect ratios, accessibility settings, or phone cameras.

The Affect Tracker desktop/browser case study at commit [`9e45c4c`](https://github.com/GeorgeFejer91/affect-tracker-web/tree/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb) demonstrates desktop-host/phone-guest and phone-host/desktop-guest fan-out. Its return path is presentation-only in the desktop WebView and does not mutate Rust/LSL state. It uses an experimental public/passwordless discovery profile, so it is topology evidence—not BRSP authentication or conformance evidence. See [13](13-native-shell-webview-integration.md) and the [current qualification record](15-qualification-record.md).

## Integration completion checklist

- Exact application state, reducer, manifest, scopes, limits, expiry, and revisions are versioned.
- Target and controller use opposite roles on one duplex connection.
- No SDK/client is constructed or started before an explicit current gesture.
- Target validates every application field and owns authoritative state.
- Reliable commands wait for `applied`; replaceable controls use intent and returned state.
- Momentary controls have target-enforced leases; persistent controls have documented hold behavior.
- State heartbeat, stale threshold, hold behavior, and recovery hysteresis are implemented.
- Smartphone camera/accessibility projection remains local.
- All producers stop before asynchronous transport teardown.
- Deployment has exact CSP/network inventory and no runtime CDN.
- Deterministic tests, attended transport evidence, physical phone evidence, and native-shell evidence remain separate claims.

Continue with [13 — Native-shell WebView integration](13-native-shell-webview-integration.md) for a Tauri desktop target or [14 — Deployment, network, and CSP](14-deployment-network-and-csp.md) for browser hosting and network policy.
