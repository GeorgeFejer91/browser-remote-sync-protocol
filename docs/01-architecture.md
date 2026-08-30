# 01 — Architecture and authority

## System components

A BRSP deployment has six logically separate components even when several live in one JavaScript bundle:

1. **Application reducer** — the target's normal code that validates and applies named actions.
2. **BRSP session** — the handshake, scopes, commands, acknowledgements, snapshots, state, revisions, sequence checks, and lifecycle.
3. **Transport adapter** — maps the reliable and replaceable lanes to a concrete network implementation.
4. **Discovery/signaling service** — lets peers find one another and negotiate a path. VDO.Ninja supplies this in the first adapter.
5. **Browser transport** — WebRTC DTLS/SCTP and ICE in the VDO adapter.
6. **View projection** — maps normalized/shared application state to the local viewport without changing the authoritative state.

Keeping these components separate makes the protocol portable and prevents UI details from becoming wire behavior by accident.

## Native target projection

For a native Android/Meta Quest target, the six logical components remain but
their placement changes. A pure Kotlin BRSP session validates the application
contract and calls one native reducer. A packaged WebView may own only the VDO
signaling and RTCDataChannel byte path. It must not own proof secrets, grants,
Android permissions, Spatial entities, Polar/device operations, or a generic
native dispatcher.

```text
browser controller -> WebRTC bytes -> transport WebView -> Kotlin BRSP
                   -> typed dispatcher -> native effect/reducer -> state
```

Every asynchronous transport event is fenced by the current generation, and
every local/remote action enters the same application dispatcher. The complete
placement, pairing, lifecycle, and APK contract is in
[16 — Native Meta Quest target and browser companion](16-native-meta-quest-integration.md).

## Reference one-controller/one-target topology

The target is the announcing peer. The controller is the viewing peer. This is a connection-establishment distinction, not a one-way transport: the created RTC data channels are duplex.

```text
Controller local intent
        |
        | scoped command + expected revision
        v
Target command validator -> application reducer -> target revision N+1
        |                                          |
        +------------ applied acknowledgement ----+
        |
        +------------ snapshot/live state --------> Controller view
```

The controller does not update shared state merely because it moved a local slider. It may show a clearly labeled pending affordance, but the synchronized scene is rendered from the target's reply.

## Five planes

### 1. Activation and discovery plane

An endpoint creates no VDO SDK client and opens no connection until a user presses Start. The target generates or accepts a session/room ID and pairing secret, joins the room, and announces a data-only stream. The controller joins the same room, discovers the target, and views it without audio or video.

Discovery answers “which advertised endpoint might I contact?” It does not answer “who is this?” A room ID, stream ID, label, and peer UUID are routing metadata, not application authentication.

### 2. Authentication and negotiation plane

Both endpoints send `hello` with:

- the fixed protocol and version in the envelope;
- a session ID;
- a fresh local peer ID and unsigned 32-bit epoch;
- a fresh random nonce;
- role (`target` or `controller`);
- capabilities;
- controller-requested scopes;
- target-granted scopes.

Each side computes an HMAC-SHA-256 proof over the complete canonical target/controller hello transcript and its own role. A successful proof binds the session, nonces, peer IDs, epochs, roles, capabilities, and scopes to possession of the same secret. Both independently compute capability and scope intersections, exchange `ready`, and enable application messages only after mutual proof and matching negotiation.

### 3. Reliable control plane

The reliable ordered control channel carries:

- handshake messages;
- commands and application acknowledgements;
- snapshot request and response;
- bounded protocol errors;
- graceful close.

The target deduplicates recent command IDs and binds each ID to its validated command body. An identical retry returns the cached logical `applied` result without reapplying it, using a fresh ordered envelope sequence so the controller can accept it; reuse with a different body is a protocol error. Production applications that reconnect must retain their dedupe window for as long as a controller can retry an old command, or make every command naturally idempotent.

### 4. Replaceable state and live-intent plane

The unordered zero-retry channel carries the target's current state and, when `latest-intent` is negotiated, the controller's fast current intent. Each direction has its own sender epoch and unsigned sequence.

The receiver rejects duplicates and older values using unsigned half-range ordering. The adapter does not queue a history of live state when `bufferedAmount` is nonzero. It retains one newest pending state and attempts it when the channel drains. A periodic heartbeat repeats current state so that a lost final change can recover.

This lane is appropriate only for replaceable information. A phone joystick or absolute slider sends a complete current intent; the target validates it and returns authoritative state. A payment, recording start, file delete, navigation step, or other nonreplaceable transition belongs on reliable control with an acknowledgement.

### 5. Local projection plane

Shared state often cannot map to identical pixels on unequal screens. The correct goal is identical semantic scene state plus deterministic local projection.

Examples:

- Normalize a position within the object's movable range, not raw pixels.
- On first remote placement, anchor the sender's current point to the receiver's current point so connecting does not jump the object.
- Apply subsequent remote displacement relative to that anchor.
- Let a local drag re-anchor the receiver without transmitting an unintended reverse movement.
- Derive decorative geometry from a stable participant/session ID when every screen should display the same variation.
- Keep a smartphone pinch/pan camera entirely local. Project the shared scene through it and invert that camera for local hit testing. Never transmit or persist it unless camera synchronization is an explicit product requirement.

That last rule came from Affect Tracker Party mode: every connected browser receives the same host-authored scene, while a phone user can zoom from `0.5` to `1.6` and pan to inspect a smaller viewport. The shared objects do not move merely because one user changed perspective.

## Authority models

### Target authority — BRSP/1 default

One target owns each mutable shared field. Controllers send requests. This is the easiest model to reason about, secure, test, and reconcile after reconnect.

Use for remote controls, presentation control, experiment operator panels, kiosks, dashboards, and second-screen input.

### Host aggregation and fan-out

Multiple guests send their own bounded intent/state to one host. The host assembles an ordered scene and sends the same versioned aggregate to every guest. Guests never connect directly to other guests.

Use for small shared scenes. Bound guest count, aggregate bytes, update frequency, CPU/render cost, and accessible roster size. Affect Tracker deliberately capped this at eight guests; it was a product/CPU/accessibility bound, not a VDO.Ninja room limit.

### Symmetric mathematical combination

Two peers can converge without a master only if the combination is deterministic and commutative. Affect Tracker Universe mode combined two independent normalized X/Y intentions by addition and saturation. Both endpoints compute the same result regardless of message order once they hold the same pair of latest inputs.

Use only for operations with a proven convergence rule. Ordinary object mutation is not automatically commutative.

### Multi-writer state

If two peers may write the same field, define conflict behavior before networking:

- single writer lease per field;
- compare-and-set with expected revision;
- last-writer-wins with a trustworthy ordering source;
- operation transformation;
- a CRDT appropriate to the data type;
- explicit user conflict resolution.

BRSP/1 provides expected revisions but no global clock or CRDT. “Whichever packet arrives last” is not a durable collaboration design.

## State versus intent versus presentation

These must not share one mutable variable:

- **Local intent**: what the local user is currently requesting.
- **Authoritative state**: what the target or host accepted.
- **Presented state**: a smoothed, animated, zoomed, or accessibility-adjusted projection.

The Party implementation exposed a feedback-loop hazard: when a guest received its host-authored display placement and reused that placement as the next upstream local offer, the host's own arrangement echoed back as if the guest had moved. The fix was separate storage and ownership for upstream intent and returned authoritative display placement.

Apply this rule to any remote app. A returned volume, camera position, timeline, or object transform must not automatically become a new outbound user command.

## Lifecycle state machine

The reference connection exposes these conceptual phases:

```text
idle
  -> connecting signaling
  -> discovering / discoverable
  -> peer channels open
  -> authenticating (hello + proof)
  -> negotiating (ready)
  -> ready
  -> disconnected or stale
  -> stopping
  -> closed

Any validation/proof error -> error -> close peer
```

Transport connection is not protocol readiness. A channel can be open while the application is still unauthenticated. UI, commands, and recording must use the BRSP phase, not merely WebRTC `readyState`.

## Freshness and disconnects

The reference profile repeats current state every 250 ms and marks state stale after two receiver-local seconds without an accepted frame. The controller begins that freshness clock when it enters `ready`, so a peer that never supplies initial state becomes stale rather than remaining indefinitely unmeasured. The receiver holds the last accepted state; it does not silently fall through to unrelated local input. After a stale period, the UI requires three consecutive valid state frames before reporting recovery, although each valid frame may be applied immediately.

The values are a profile, not a universal constant. Choose them from the application's update rate, browser scheduling, route, and consequence of false stale/live transitions. A disconnect event records the edge immediately but state age remains evaluable from the last accepted frame (or ready baseline) and may share the same freshness grace as silence, so a repaired channel does not flash lost/live unnecessarily.

No browser timer proves real network freshness while a page is suspended. A hidden tab can defer both message tasks and stale timers. The lowest-latency workflow requires a browser/OS state that continues scheduling the application.

## Transport interface

The transport-neutral `BRSPConnection` expects an adapter with:

```js
transport.addEventListener("peeropen", ({ detail: { peerKey } }) => {});
transport.addEventListener("peerclose", ({ detail: { peerKey, reason } }) => {});
transport.addEventListener("controlmessage", ({ detail: { peerKey, data } }) => {});
transport.addEventListener("statemessage", ({ detail: { peerKey, data } }) => {});

transport.sendControl(peerKey, utf8Message); // reliable, ordered, bounded
transport.sendState(peerKey, utf8Message);   // replaceable, latest-only
transport.closePeer(peerKey);
await transport.stop();
```

An adapter must document how it satisfies those semantics. A WebSocket adapter, for example, receives a reliable ordered byte stream for both lanes and must implement state coalescing above the socket rather than claiming transport-level partial reliability.

## Next

Read [02 — Threat model and privacy](02-threat-model-and-privacy.md). A functional peer connection is not evidence that the peer is authorized or that deployment privacy is acceptable. Native Quest targets also require the platform boundary in [16](16-native-meta-quest-integration.md).
