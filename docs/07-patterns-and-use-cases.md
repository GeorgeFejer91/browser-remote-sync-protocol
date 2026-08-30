# 07 — Transferable patterns and use cases

## Start with message semantics

Every outbound item should fit one of these patterns:

| Pattern | Examples | Lane | Confirmation |
| --- | --- | --- | --- |
| Discrete command | next slide, reset, start recording, submit choice | Reliable control | `applied` with target revision |
| Live intent | phone joystick, absolute slider, scrubber, pointer position | Replaceable intent | Returned target state; lease for momentary controls |
| Authoritative live state | current scene, playback position, target status | Replaceable state | Sequence/freshness; periodic reliable snapshot |
| Transactional snapshot | settings bundle, current document metadata | Reliable control | Schema validation; often local Preview/Apply |
| Presence/diagnostic | route, RTT, stale, foreground state | Local/diagnostic; explicitly modeled if remote | Never silently owns application liveness |
| Local presentation | phone zoom/pan, reduced motion, thumb layout | Not transmitted by default | Local reset/accessibility |

If an item does not fit, define its loss, duplication, ordering, freshness, authority, and privacy behavior before adding a new message type.

## 1. Smartphone companion (“Marionette”)

**Scenario.** A desktop/tablet browser runs the primary application. A phone opens a responsive companion page with large fast controls.

**Topology.** Desktop is target/announcer; phone is controller/viewer; one duplex connection.

**Protocol.** Pair by room + high-entropy secret, mutual proof, manifest/scopes, reliable commands for discrete buttons, replaceable `intent` for joysticks/sliders, authoritative state returned to the phone, target-enforced control lease.

**Examples.** Presentation remote, creative-tool palette, experiment operator controls, media transport, kiosk maintenance, accessible alternate input, game-like control surface.

The complete profile is [11 — Marionette smartphone companion](11-marionette-companion-profile.md).

## 2. Presentation remote

Scopes:

```text
presentation.navigate
presentation.pointer
presentation.notes.read
```

Commands:

```text
next
previous
goto { slideIndex }
blank { enabled }
```

Live intent:

```json
{
  "scope": "presentation.pointer",
  "controls": {
    "pointer": { "x": 0.44, "y": 0.22, "active": true }
  }
}
```

Target state returns current slide, blank state, pointer projection, and whether navigation is enabled. The phone may show local speaker notes only if separately authorized; do not include them in public labels or general scene state.

## 3. Media controller

Reliable commands:

- play/pause;
- next item;
- select item;
- change subtitle/audio track;
- request fullscreen (subject to local browser gesture restrictions).

Live intent:

- seek preview scrubber;
- volume slider;
- crossfade position.

The target publishes actual playback state. A phone must not claim playback started until the target returns applied/state. Browser autoplay/fullscreen policies may require a local target gesture; return a specific rejection such as `local_gesture_required`.

## 4. Study/operator panel

Reliable commands:

- arm/pause/resume/stop a study phase;
- mark an event;
- choose a stimulus;
- apply a validated settings snapshot.

Authoritative state:

- current phase;
- remaining duration;
- readiness gates;
- recording/stream status.

Safety rule: network loss holds current state and exposes an operator warning; it never silently substitutes sensor/controller input or stops/starts recording unless the approved study protocol defines that fail-safe.

Keep participant identity, physiology, raw sensor data, and research rows out of a generic remote-control channel.

## 5. Kiosk or digital signage

Good controls are narrow: select playlist, advance, show/hide overlay, adjust approved presentation parameters, request health snapshot.

Production requirements exceed the demo:

- durable device identity and enrollment;
- signed/expiring controller authorization;
- backend audit/revocation;
- origin/device policy;
- offline/fallback state;
- service-level monitoring;
- no public room as the sole discovery method.

A centralized WebSocket backend is often operationally better than P2P for a fleet, while BRSP envelopes/reducers remain reusable.

## 6. Accessible alternate input

A phone/tablet can provide larger controls, switch scanning, voice-to-named-command, or a custom motor-access layout for a primary browser.

Keep the remote vocabulary semantic. “Activate primary action” is preferable to “click at pixel 612,403.” Preserve:

- visible labels and status;
- keyboard/switch equivalence;
- target confirmation;
- focus-independent command meaning;
- reduced motion and contrast;
- user-configurable layout stored locally on the companion;
- target-enforced leases for momentary motion.

Do not transmit raw voice audio when the phone can perform local recognition and send an approved named command.

## 7. Shared procedural scene

For one host plus a bounded guest set:

- guests send only their own normalized intent/state;
- host owns roster, order, shared visual settings, object sizes/layout, stale flags, and animation phase;
- host encodes one bounded aggregate and fans identical bytes to each guest;
- deterministic geometry derives from stable public session IDs;
- guest accepts only a host aggregate containing its own fresh ID;
- local phone view camera remains local;
- no guest-to-guest connections.

Use this for a small shared visualization, not general collaborative document editing.

## 8. Reciprocal co-control

Two peers may each advertise independent intent and combine it with a deterministic commutative rule. Example:

```js
sharedX = clamp(localX + remoteX, -1, 1);
sharedY = clamp(localY + remoteY, -1, 1);
```

Readiness must prove both directions are selected/live. Stale holds the last shared result. This works because the operation is defined and commutative; it does not generalize to arbitrary mutations.

## 9. Settings beacon

For portable settings:

1. explicit Broadcast captures one normalized immutable versioned object;
2. reliable ordered channel sends it once to each selected receiver;
3. bytes and exact schema are validated;
4. receiver shows source/shape/time and preview;
5. local user presses Apply;
6. later broadcaster UI edits do not mutate the running snapshot.

Treat author authenticity separately. Schema-valid public data can still be malicious or unwanted.

## 10. Raw WebRTC adapter

Use BRSP unchanged over your own WebRTC when you need control of identity and infrastructure.

You must supply:

- authenticated signaling transport;
- offer/answer and ICE candidate exchange;
- STUN/TURN configuration and credential rotation;
- glare/perfect-negotiation behavior;
- connection/recovery/ICE restart policy;
- two data channels with exact lane options;
- diagnostics, limits, abuse controls, and operations.

This is more work than the VDO adapter but removes dependence on a hosted signaling contract you do not control.

## 11. WebSocket adapter

A WebSocket is client→server, reliable, ordered, and TCP-based. Two browser instances usually do not connect directly; the backend authenticates/routs messages between sessions.

Adapter responsibilities:

- account/session authentication and target/controller authorization;
- room membership and routing;
- preserving BRSP message boundaries;
- separate logical control and intent/state streams;
- application-side latest-intent/state coalescing before enqueue;
- bounded per-client/server queues;
- reconnect/session epoch and snapshot;
- fan-out, revocation, auditing, and abuse limits.

WebSocket may be the best choice for an existing product backend or many controllers/targets. Do not pretend its reliable TCP queue provides zero-retry semantics; implement coalescing before data enters the queue.

## 12. WebTransport adapter

WebTransport provides browser↔server streams and datagrams over HTTP/3. It can map control to a reliable stream and replaceable intent/state to datagrams, but it is not browser-to-browser discovery or NAT traversal by itself. A server still authenticates and routes sessions.

Treat availability, certificate/origin constraints, proxies, enterprise networks, and fallback as distinct qualification items.

## 13. Native/mobile bridge

A native companion can implement BRSP envelopes over its WebRTC/WebSocket library. It must reproduce canonical JSON and HMAC test vectors exactly. The target should not weaken scopes merely because the controller is installed software.

If the native app exposes device sensors, send only necessary derived/normalized intent with explicit permission. Do not generalize motion/microphone/location access into a generic sensor pipe.

## 14. When to use remote desktop instead

Use an established remote-desktop/streaming system when the requirement truly is:

- arbitrary unmodified third-party web applications;
- pixel-perfect screen replication;
- unrestricted mouse/keyboard/touch control;
- browser chrome or operating-system interaction;
- compatibility without adding a command reducer to the target app.

That is a different and much larger security boundary. BRSP is most effective when you control both app instances and can expose a narrow semantic command/intent API.

## Design worksheet

For each transferred app, record:

```text
Target:
Controller(s):
Discovery method:
Authentication/identity:
Requested/granted scopes:
Reliable commands:
Live intent controls:
Target control manifest:
Authoritative state schema:
Revisions/dedupe:
Intent heartbeat and leases:
State heartbeat and stale threshold:
Queue/byte/rate limits:
Viewport/projection rules:
Local-only presentation state:
Reconnect/selection policy:
Privacy disclosure:
Qualification matrix:
Production infrastructure owner/SLA:
```

Continue with [08 — Testing and qualification](08-testing-and-qualification.md), or go directly to the [Marionette companion profile](11-marionette-companion-profile.md) for the phone-controller scenario.
