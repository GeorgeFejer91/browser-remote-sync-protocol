# 00 — Overview and efficiency decision

## The short answer

Sending video is not an efficient way to exchange symbols, slider positions, commands, scene descriptions, or other small application state. A video path would repeatedly rasterize the interface, encode pixels, transmit a much larger stream, decode it, and then still require a separate input path to control the remote application.

The useful part of VDO.Ninja for this problem is not video encoding. It is the surrounding WebRTC connection machinery:

- room discovery and signaling;
- creation of the `RTCPeerConnection`;
- ICE candidate exchange and NAT traversal;
- STUN and optional TURN service selection;
- encrypted bidirectional WebRTC data channels;
- peer connection recovery and diagnostic information;
- a browser SDK that avoids coupling an application to VDO.Ninja's private signaling WebSocket protocol.

The official VDO.Ninja SDK explicitly recommends one data-only publisher/viewer connection for this pattern: one peer calls `announce()`, the other calls `view()`, and both can send on the same connection. The SDK documentation describes that as the most efficient data-only pattern. The reference adapter in this repository follows it and requests `audio: false` and `video: false`.

## What “remote browser control” means here

BRSP is application-semantic remote control. The two applications agree on a small vocabulary such as:

```json
{
  "scope": "scene.write",
  "action": "set-scene",
  "args": {
    "x": 0.42,
    "y": -0.17,
    "hue": 205
  }
}
```

The receiving application validates the request, decides whether it is authorized, applies it through normal application logic, and sends the resulting authoritative state back. This is safer, smaller, more testable, and more accessible than pretending to be a general remote desktop.

BRSP intentionally does not expose selectors, DOM mutation, `eval`, keystroke injection, browser credentials, cookies, arbitrary files, or operating-system input. If an application needs a new remote action, it adds a named, versioned, bounded command and tests its authorization and effect.

## The complete layer model

It helps to separate five layers that are often incorrectly called “the VDO protocol”:

| Layer | Responsibility | BRSP/VDO choice |
| --- | --- | --- |
| Application | Defines what `set-scene`, `pause`, or `next-slide` means and who may do it | Application-owned allow-list and state reducer |
| BRSP/1 | Mutual proof, capabilities, scopes, commands, acknowledgements, snapshots, state, revisions, sequencing | Transport-neutral JSON envelopes |
| Data channel | Delivery semantics, message boundaries, ordering, retransmission, backpressure | Reliable control channel plus unordered zero-retry live-state channel |
| WebRTC | Peer connection, DTLS/SCTP, ICE, direct or relayed routing | Browser implementation |
| VDO.Ninja | Signaling/discovery SDK, hosted handshake/STUN/TURN defaults, recovery helpers | First adapter; replaceable |

The distinction is the central transfer principle. VDO.Ninja establishes the path; BRSP defines what an application is allowed to say over it.

## Why two channels

A single reliable channel is attractive but mixes messages with incompatible goals.

For a command, every accepted transition matters. If a controller sends “start,” then “pause,” losing or reordering either command can produce the wrong application state. BRSP sends commands on a reliable ordered lane and requires an application-level `applied` response. Transport delivery alone does not prove that the target validated or applied the action.

For a cursor, phone joystick, live coordinate, volume scrubber, camera pose, or rapidly changing scene, an old value has little value after a newer value exists. Reliable retransmission can create head-of-line delay: the browser waits for obsolete data while the current value sits behind it. BRSP therefore sends target state—and, when negotiated, controller live intent—through a channel configured with:

```js
{ ordered: false, maxRetransmits: 0 }
```

The adapter checks `bufferedAmount`. When queued replaceable data exists, it retains only the newest pending frame. This is not a generic “UDP” socket, but WebRTC's standardized partial-reliability mode provides the relevant message semantics. Discrete phone buttons still use reliable acknowledged commands; joysticks and sliders use the optional `latest-intent` profile.

## Why an acknowledgement is still necessary

There are at least four different facts:

1. the controller called `send()`;
2. the transport delivered a message;
3. the target authenticated and validated it;
4. the target's application state changed.

Only the fourth fact means remote control succeeded. BRSP's `applied` response includes the command ID, success flag, target revision, bounded result, and machine-readable rejection code. The controller then waits for or receives the target's state. This prevents optimistic UI from silently diverging.

## When VDO.Ninja is a good fit

Use the VDO.Ninja adapter when:

- the application is a browser page and a static deployment is valuable;
- one or a few peers need a low-latency connection;
- you do not already have a real-time application backend;
- Internet NAT traversal and TURN fallback would otherwise require additional infrastructure;
- you accept the service, privacy, and availability boundaries in `02-threat-model-and-privacy.md`;
- a data-only peer connection is sufficient.

VDO.Ninja is not automatically the most efficient operational choice when your product already has authenticated accounts, a WebSocket service, centralized authorization, audit requirements, or many concurrent viewers. In that environment, BRSP over the existing backend can eliminate separate peer discovery and make fan-out and revocation simpler.

## Data-size intuition

The comparison below is qualitative; exact network overhead depends on browser, path, encryption, packetization, and content.

| Payload | Typical application content | Useful behavior |
| --- | --- | --- |
| BRSP command | Hundreds of UTF-8 bytes | One validated action plus acknowledgement |
| BRSP live state | Hundreds to a few thousand UTF-8 bytes | Current state; obsolete frames may be dropped |
| Compact binary state | Tens of bytes | High-rate numeric controls with a fixed codec |
| Video | Thousands to millions of encoded bits per second | Pixels, including unchanged decoration and text |

For a truly tiny fixed signal—two normalized floating-point values, for example—the Affect Tracker transport used a 12-byte little-endian packet: unsigned sequence, float X, float Y. BRSP uses readable JSON for the general reference protocol and documents a binary extension pattern for applications that prove they need it. Optimization starts after the message vocabulary, authority, bounds, backpressure, and failure behavior are correct.

## Design goals

BRSP/1 aims to be:

- **explicit**: no connection on page load; each endpoint starts from a current user action;
- **mutually authenticated**: both endpoints prove possession of a separately shared high-entropy secret;
- **least-authority**: requested and granted scopes are intersected before commands are enabled;
- **authoritative**: the target applies commands and publishes the resulting state;
- **duplex**: control travels controller→target and acknowledgements/state travel target→controller on one peer connection;
- **bounded**: message bytes, array sizes, field counts, token lengths, nesting, numeric validity, and queues have limits;
- **freshness-aware**: sequence numbers, revisions, heartbeats, staleness, and recovery are visible;
- **transport-neutral**: the same application envelopes can be adapted to VDO.Ninja, raw WebRTC, WebSocket, or WebTransport;
- **observable**: phases, route, RTT, stale state, rejection, backpressure, and teardown are inspectable without logging secrets or every high-rate frame;
- **transferable**: lessons from continuous coordinates, reciprocal control, settings snapshots, and shared scenes are separated into reusable patterns.

## Non-goals and hard boundaries

BRSP/1 does not solve account identity, invitations, durable presence, offline messaging, server-side persistence, global ordering, conflict-free replicated data types, audit retention, or abuse response. It provides a session handshake and bounded live application synchronization between one controller and one target.

The multi-peer Party pattern in `07-patterns-and-use-cases.md` is deliberately host-authoritative and bounded. It is not a claim that full mesh, arbitrary fan-out, or peer consensus scales without additional infrastructure.

The protocol also cannot make a hidden or suspended browser real-time. Browser task scheduling and operating-system focus remain part of the system. Freshness thresholds are receiver-local observations, not proof of end-to-end wall-clock latency.

## Next

Read [01 — Architecture and authority](01-architecture.md) before implementing an adapter. The most expensive synchronization bugs usually come from unclear ownership and feedback loops, not from the WebRTC API itself.
