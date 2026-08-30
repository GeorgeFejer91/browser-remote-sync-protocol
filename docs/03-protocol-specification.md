# 03 — Browser Remote Sync Protocol version 1

## Status and conformance language

This document is the normative BRSP/1 wire contract for this repository. It is a pre-1.0 reference protocol. “MUST,” “MUST NOT,” “REQUIRED,” “SHOULD,” “SHOULD NOT,” and “MAY” are used as interoperability requirements.

A conforming BRSP/1 implementation MUST implement the envelope, validation, handshake, reliable control lane, replaceable state lane, sequencing, authority, and teardown rules below. Transport adapters MAY differ as long as they meet the two lane contracts.

## Protocol identity

- Protocol token: `brsp`
- Version: `1`
- Text encoding: UTF-8
- Message framing: one complete JSON value per transport message
- Control maximum: 16,384 UTF-8 bytes
- State maximum: 8,192 UTF-8 bytes
- Reference roles: exactly one `target` and one `controller`
- Authentication: mutual HMAC-SHA-256 proof with a pre-shared high-entropy secret
- Control delivery: reliable and ordered
- Replaceable delivery: unordered, zero transport retransmits, newest pending message only

An implementation MUST reject an unsupported protocol/version. It MUST NOT reinterpret a version-1 field with new semantics. An incompatible change requires a new protocol version; an optional compatible behavior requires a negotiated capability.

## Common envelope

Every message is an object with exactly these fields:

```json
{
  "protocol": "brsp",
  "version": 1,
  "type": "hello",
  "sessionId": "brsp_ybKxM4Hq7c8Vw2",
  "senderId": "target_q4Ny9Zs3Hh7P",
  "senderEpoch": 2748820191,
  "sequence": 0,
  "body": {}
}
```

| Field | Type | Requirement |
| --- | --- | --- |
| `protocol` | string | Exactly `brsp` |
| `version` | integer | Exactly `1` |
| `type` | string | One of the lane's registered message types |
| `sessionId` | token | 8–96 characters; same at both endpoints |
| `senderId` | token | 8–96 characters; fresh local peer identifier |
| `senderEpoch` | uint32 | Fresh local epoch; binds sequence space to this endpoint instance |
| `sequence` | uint32 | Per-lane sender sequence |
| `body` | object | Type-specific bounded JSON |

Protocol tokens begin with an ASCII letter or digit and contain only ASCII letters, digits, underscore, dot, colon, or hyphen. Capability, scope, action, error, and command tokens are at most 64 characters unless stated otherwise.

`senderId` is session-local routing identity, not a user/account identity.

## JSON value restrictions

Before application dispatch, every envelope and nested value MUST satisfy all of these limits:

- JSON only: null, boolean, string, finite number, array, or object;
- arrays MUST be ordinary same-realm arrays with dense own data-property indices from `0` through `length - 1`; sparse arrays, inherited or accessor-backed indices, and additional string or symbol properties are rejected at the local encode/application boundary;
- objects MUST be ordinary plain records with `Object.prototype` or null prototype; dates, maps, sets, typed/custom class instances, and enumerable accessor fields are rejected at the local encode/application boundary;
- no `NaN`, positive/negative infinity, bigint, binary object, function, symbol, or undefined;
- maximum nesting depth 8 below the validated value;
- at most 256 entries in an array;
- at most 128 fields in an object;
- object field names 1–96 characters;
- field names `__proto__`, `prototype`, and `constructor` are rejected by the reference implementation;
- type-specific numeric ranges and token limits still apply;
- the complete encoded message MUST fit its lane byte limit.

An application SHOULD decode to a typed, copied structure containing only expected fields. It MUST NOT treat parsed objects as executable configuration or merge untrusted objects into privileged prototypes. A JavaScript `Proxy` is not a JSON wire type and cannot arrive from `JSON.parse`; local callers MUST NOT treat the encoder as a sandbox for untrusted in-memory objects or proxies, and should construct validated plain-data DTOs before encoding.

## Canonical JSON for the proof transcript

BRSP canonicalization is defined for the bounded JSON subset above:

1. Object keys are sorted by JavaScript/Unicode code-unit lexicographic order.
2. Each object is encoded with sorted keys, colon separators, comma separators, and no whitespace.
3. Array order is retained after the dense own data-property array boundary above has been validated.
4. Primitive values use ECMAScript `JSON.stringify` representation.
5. Only finite numbers and the restricted values above are permitted.

This project-specific definition is implemented by `canonicalStringify()` in `src/brsp.js`. It is not advertised as general RFC 8785 JSON Canonicalization Scheme conformance. Cross-language adapters MUST reproduce the exact BRSP output and use the published test vectors before claiming interoperability.

## Lane registry

### Reliable control lane

Allowed `type` values:

```text
hello
proof
ready
command
applied
snapshot-request
snapshot
error
bye
```

The lane MUST deliver complete messages reliably and in sender order. The adapter MUST bound its queued bytes and expose/fail backpressure rather than permit unbounded growth.

### Replaceable state/intent lane

Version-1 types are `state` (target→controller authoritative state) and `intent` (controller→target fast controls, only when `latest-intent` was negotiated). The lane MAY lose or reorder messages. The sender/adapter MUST NOT build a delayed history. When transport bytes are already queued, it retains at most one newest pending message for that peer/lane and replaces an older pending offer.

The two lanes SHOULD be independent so a large/retransmitted message does not head-of-line block live state. A transport that cannot provide partial reliability MAY emulate the state semantics by coalescing before its reliable send queue, but MUST document that already handed-off bytes cannot be withdrawn.

## Sequence numbers

Control and the replaceable state/intent lane each have an independent unsigned 32-bit sequence space per sender epoch.

- The first `hello` control sequence MUST be `0`.
- Every later outgoing control message increments the local control sequence modulo 2³².
- The first outgoing state message uses `1` in the reference implementation; receivers MUST accept any first uint32.
- A new local endpoint instance MUST use a fresh epoch and reset its sequences.
- A receiver MUST bind later messages to the `senderId` and `senderEpoch` accepted in the peer's hello.

Given candidate `next` and accepted `previous`, `next` is newer exactly when:

```js
const distance = ((next >>> 0) - (previous >>> 0)) >>> 0;
const newer = distance > 0 && distance < 0x80000000;
```

Duplicates, older values, and the exactly-half-range ambiguous value are rejected. This permits natural wrap from `0xffffffff` to `0` without comparing wall clocks.

Control transport ordering means a non-newer control message normally indicates a duplicate, replay, or implementation fault. State reordering is expected and silently ignored.

## Handshake

### Preconditions

Before the handshake:

- the two endpoints share a session ID and high-entropy secret through a separate channel;
- the transport has opened both BRSP lanes;
- no application command, snapshot, or state is accepted;
- each endpoint has a fresh `senderId`, `senderEpoch`, and nonce.

The pairing secret SHOULD contain at least 192 random bits. Version 1's direct HMAC design MUST NOT be used with a short numeric code or guessable password in production.

### Step 1 — hello

Both endpoints send `hello` immediately after both lanes are open.

```json
{
  "role": "controller",
  "nonce": "Z2O9zxeKiq2yW1K9fQv4nA",
  "capabilities": ["command-ack", "latest-intent", "latest-state", "state-snapshot"],
  "requestedScopes": ["scene.write"],
  "grantedScopes": []
}
```

The body contains exactly:

| Field | Requirement |
| --- | --- |
| `role` | `controller` or `target`; peers MUST have opposite roles |
| `nonce` | base64url, at least 120 bits in reference validation; senders SHOULD use at least 128 random bits |
| `capabilities` | unique array, maximum 32 tokens |
| `requestedScopes` | controller request; empty for target in version 1 |
| `grantedScopes` | target grant; empty for controller in version 1 |

Arrays SHOULD be emitted sorted. Receivers accept any unique order because the entire received hello, including array order, is authenticated in the proof transcript.

A second bitwise/canonically identical hello MAY be ignored. A peer that changes its hello during the handshake MUST be rejected.

### Step 2 — form the transcript

After receiving both hellos, each endpoint determines them by role and creates this object:

```json
{
  "protocol": "brsp",
  "version": 1,
  "sessionId": "...",
  "targetHello": { "...complete target hello envelope...": "..." },
  "controllerHello": { "...complete controller hello envelope...": "..." }
}
```

The endpoint serializes the object with BRSP canonical JSON. The explicit target/controller order prevents network arrival order from changing the transcript.

### Step 3 — proof

Each endpoint computes:

```text
proofInput = UTF8(
  "BRSP/1 proof\n" +
  localRole + "\n" +
  canonicalTranscript
)

proof = base64url(HMAC-SHA-256(UTF8(pairingSecret), proofInput))
```

It sends:

```json
{
  "algorithm": "HMAC-SHA-256",
  "role": "controller",
  "value": "base64url-encoded-32-byte-MAC"
}
```

The receiver MUST verify the proof against the remote role and complete transcript using a comparison that does not exit on the first different byte. A failed proof MUST fail closed: no application message is processed, the peer is closed, and the secret/proof is not logged.

The role is included both in the body and the MAC input. A target proof cannot be reflected as a controller proof.

### Step 4 — negotiate

Both peers compute:

```text
capabilities = sort(target.capabilities ∩ controller.capabilities)
acceptedScopes = sort(controller.requestedScopes ∩ target.grantedScopes)
```

Unknown capabilities are ignored because they do not appear in the intersection. A scope is never granted solely because the controller requested it.

### Step 5 — ready

After the peer proof is valid and the local proof has been sent, each endpoint sends:

```json
{
  "capabilities": ["command-ack", "latest-intent", "latest-state", "state-snapshot"],
  "acceptedScopes": ["scene.write"]
}
```

The arrays MUST exactly equal the independently computed, sorted negotiation result. A mismatch fails the handshake. The connection enters application `ready` only after the local ready is sent and a matching remote ready is received.

On ready, the controller sends `snapshot-request`; the target SHOULD immediately send a reliable snapshot and current state.

## Command protocol

Only a ready controller sends `command`. Only a ready target accepts it.

```json
{
  "commandId": "cmd_4PRYwSqqra4gKX2h",
  "scope": "scene.write",
  "action": "set-scene",
  "args": {
    "scene": { "x": 0.25, "y": -0.5, "hue": 190 }
  },
  "expectedRevision": 41
}
```

| Field | Requirement |
| --- | --- |
| `commandId` | unique 8–96 character token; SHOULD contain at least 96 random bits or equivalent collision resistance |
| `scope` | MUST be in negotiated `acceptedScopes` |
| `action` | exact application allow-list token |
| `args` | bounded JSON; application validates exact shape/ranges |
| `expectedRevision` | non-negative safe integer or null |

The target MUST NOT derive a function, selector, URL, module, SQL, shell command, or code expression from `action`. It maps an exact allow-listed `(scope, action)` pair to normal application logic.

When `expectedRevision` is not null, the target SHOULD reject the command if its current revision differs. This is compare-and-set protection against overwriting state the controller has not observed.

The target MUST deduplicate `commandId` within its retry/reconnect window. The cache MUST bind the ID to the complete validated command body; reuse of an ID with a different body is a protocol error rather than a retry. If an identical duplicate is received, the target returns the cached logical `applied` body without applying the action again. It MUST wrap that body in a fresh `applied` envelope using the next current control sequence; replaying the old envelope would be rejected by an ordered receiver as a duplicate/non-newer sequence.

## Applied acknowledgement

For every validated command, the target sends exactly one logical `applied` result:

```json
{
  "commandId": "cmd_4PRYwSqqra4gKX2h",
  "ok": true,
  "revision": 42,
  "result": { "acceptedHue": 190 },
  "error": null
}
```

or:

```json
{
  "commandId": "cmd_4PRYwSqqra4gKX2h",
  "ok": false,
  "revision": 43,
  "result": null,
  "error": "revision_conflict"
}
```

`revision` is the target's current non-negative safe integer after success or rejection. `result` is bounded JSON. `error` is null on success and a machine-readable token on failure.

Recommended error tokens include:

- `scope_denied`
- `unsupported_command`
- `invalid_argument`
- `revision_conflict`
- `rate_limited`
- `command_rejected`
- `command_failed`

The controller MUST NOT equate transport send success with application success. It clears pending state only when the matching acknowledgement arrives or a separately defined timeout/cancel policy executes.

## Snapshot protocol

`snapshot-request` has an empty body:

```json
{}
```

Only the controller sends it. The target responds on the reliable lane:

```json
{
  "revision": 42,
  "state": {
    "scene": { "x": 0.25, "y": -0.5, "hue": 190 }
  }
}
```

Snapshots are for initial convergence, reconnect, explicit refresh, or static configuration. They MUST pass the same application schema validation as live state. Receiving a snapshot does not authorize commands.

For immutable settings transfer, the receiver SHOULD preview a validated snapshot and require a separate local Apply gesture. This is different from continuous target-authored state that the remote-control UI is expected to render immediately.

## State protocol

Only a ready target sends version-1 state:

```json
{
  "revision": 42,
  "state": {
    "scene": { "x": 0.25, "y": -0.5, "hue": 190 }
  }
}
```

The common envelope provides sender identity, epoch, and per-state sequence. The body revision identifies application state.

The controller:

1. validates lane, protocol, version, bytes, structure, session, sender, epoch, and finite/application ranges;
2. rejects non-newer sequences;
3. records receiver-local arrival time;
4. applies the accepted current state immediately unless its application explicitly documents another projection/filter;
5. updates freshness from accepted authoritative state only.

An optional placement, diagnostic, string, or unrelated packet MUST NOT extend state liveness unless the application contract explicitly makes that packet authoritative.

### Reference live-state profile

- Changed state: application-defined cap, no more than 60 Hz; demo coalesces controller input and target state.
- Unchanged heartbeat: 250 ms in the generic demo.
- Stale threshold: 2,000 receiver-local ms without accepted state.
- Ready-without-state behavior: the controller starts the freshness clock on entering `ready`; if no authoritative state arrives, it can become stale after the same threshold rather than remain indefinitely “not yet measured.”
- Stale behavior: hold last accepted state and show a visible warning.
- Disconnect behavior: record the edge immediately but continue evaluating freshness from the last accepted state (or ready baseline); channel close does not force a premature stale transition or make state age unknowable.
- Recovery presentation: apply valid returning state immediately; report recovered after 3 consecutive valid frames.
- Backpressure: if the state channel has queued bytes, retain only the newest pending state.

Applications MAY choose other values but MUST document and qualify them. The Affect Tracker high-rate coordinate profile used a 60 Hz cap and 100 ms heartbeat; its aggregate Party-scene profile used 30 Hz and 250 ms.

## Live-intent protocol for fast companion controls

When both hellos include `latest-intent`, a ready controller MAY send replaceable `intent` on the same partial-reliability lane:

```json
{
  "scope": "controls.write",
  "controls": {
    "joystick": { "x": 0.72, "y": -0.18 },
    "scrubber": 0.43,
    "pressed": ["boost"]
  }
}
```

The common envelope supplies the controller sender ID, epoch, and replaceable-lane sequence. The body contains exactly:

| Field | Requirement |
| --- | --- |
| `scope` | MUST be in negotiated `acceptedScopes` |
| `controls` | complete bounded current intent for the declared application profile |

Only a ready target accepts intent. It validates the exact application control manifest and ranges, rejects non-newer sequences, and treats the message as the controller's latest desired control state—not as a durable transaction. The target applies it through a dedicated allow-listed intent reducer and publishes the resulting authoritative `state` back. Returned state is the convergence/confirmation path.

Intent is appropriate for joysticks, absolute sliders, scrubbing, pointer-like normalized positions, and other controls where a newer complete value replaces an older one. It MUST NOT represent a payment, delete, recording edge, navigation step, or any action that must happen exactly once; those remain reliable `command` messages with `applied` acknowledgement.

The controller SHOULD send one aggregate current-control object rather than independent tiny messages for every widget. It SHOULD coalesce input to at most the display/application rate (normally no more than 60 Hz) and send a heartbeat while momentary control ownership remains active.

Momentary controls MUST have a target-enforced lease/dead-man rule. The Marionette profile in `11-marionette-companion-profile.md` uses a 100 ms intent heartbeat and recommends neutralizing leased momentary controls after 500 ms without accepted intent. Persistent controls such as a chosen hue MAY retain their last authoritative value; expiry behavior belongs to the target-declared control manifest.

Asynchronous intent reducers must not let an older asynchronous result overwrite a newer accepted sequence. Guard the commit with the latest sequence or serialize pure computation before a final sequence check. Synchronous bounded reducers are preferred for the fast path.

## Error and close

A ready peer MAY send a bounded control error:

```json
{
  "code": "rate_limited",
  "message": "Command rate exceeded the negotiated profile."
}
```

`code` is a token and `message` is display-safe text at most 256 characters. Errors are informational and MUST NOT expose secrets, stack traces, private identifiers, or raw invalid payloads.

`bye` has an empty body. It is best-effort graceful notification. Local Stop MUST NOT wait for `bye` delivery before quiescing application producers and closing channels.

Authentication/proof failures SHOULD close silently or show only a generic local message. They MUST NOT return details that materially improve online secret guessing.

## Backpressure requirements

### Control

The adapter MUST cap the reliable queued bytes. The reference VDO adapter refuses a new control send when the existing `bufferedAmount` plus message would exceed 262,144 bytes. A production session SHOULD additionally bound pending commands, define acknowledgement timeouts, and stop or degrade visibly when the reliable lane cannot drain.

Do not drop an arbitrary reliable command and continue as though synchronization is healthy.

### State

The state sender checks `bufferedAmount` before `send()`. When greater than zero, it does not append the new state. It replaces a single application/adapter pending slot. When `bufferedamountlow` fires (or an adapter-specific drain signal occurs), it sends that newest state if the channel is still open.

Backpressure counters are diagnostic. They MUST NOT be interpreted as network packet loss counts because the dropped state may never have entered the transport.

## Reconnect and epoch rules

Version 1 deliberately requires a fresh handshake after a new peer connection. An adapter MUST NOT retain authenticated application readiness merely because a stream ID or SDK peer UUID is the same.

On reconnect:

- generate a new local epoch and nonce;
- exchange and prove new hellos;
- recompute capabilities/scopes;
- request/return a fresh snapshot;
- reject late messages from the previous peer/channel identity;
- retain command dedupe long enough to handle controller retry policy;
- do not automatically select a new advertised target if user ownership would change.

Session resumption tokens are a future capability and are not part of BRSP/1.

## Multi-peer extension pattern

BRSP/1's handshake is one controller and one target. A host may maintain one independent authenticated BRSP connection per guest, assemble a bounded aggregate scene, and fan the identical versioned aggregate to all guests.

The aggregate MUST include a host/session ID, sequence, stable participant IDs/order, bounded participant count, and only approved public scene fields. A guest accepts a returned aggregate only if its own fresh ID appears in the roster and the authenticated host connection owns it. A guest does not become a host or gain other guests' direct connections merely by receiving the scene.

The protocol does not define group key agreement, consensus, or mesh routing.

## Optional binary state profile

Applications with measured need MAY negotiate a named binary capability and separate channel. Never send untyped binary on a channel whose receiver treats data as JSON.

An example fixed 24-byte little-endian numeric frame is:

| Offset | Size | Type | Meaning |
| ---: | ---: | --- | --- |
| 0 | 4 | ASCII | `BRS1` magic |
| 4 | 1 | uint8 | version `1` |
| 5 | 1 | uint8 | message type `1` (`vec2-state`) |
| 6 | 2 | uint16 LE | flags, zero in version 1 |
| 8 | 4 | uint32 LE | sender epoch |
| 12 | 4 | uint32 LE | state sequence |
| 16 | 4 | float32 LE | normalized X |
| 20 | 4 | float32 LE | normalized Y |

Receivers reject any wrong length, magic, version, type, unknown required flag, non-finite float, wrong epoch, duplicate, or non-newer sequence. Coordinates are clamped or rejected according to the negotiated application profile.

This table is an extension example, not automatically active in the reference demo.

## Conformance checklist

A conforming implementation proves at least:

- exact envelope and lane type validation;
- UTF-8 byte limits, finite numeric and structural bounds;
- deterministic canonical transcript test vectors;
- mutual proof success and wrong-secret/transcript/role failure;
- scope/capability intersection and ready mismatch rejection;
- application messages rejected before ready;
- command allow-list, expected revision, acknowledgement, and dedupe;
- snapshot, state, and negotiated live-intent schema validation;
- unsigned wraparound/newer ordering;
- stale hold and recovery presentation;
- bounded control queue and newest-only state backpressure;
- late old-channel messages ignored after replacement;
- explicit activation and complete teardown;
- no media capture or arbitrary code/DOM/input command.

## Reference implementation

- Core: [`src/brsp.js`](../src/brsp.js)
- VDO adapter: [`src/vdo-ninja-transport.js`](../src/vdo-ninja-transport.js)
- Tests: [`test/brsp.test.js`](../test/brsp.test.js) and [`test/vdo-ninja-transport.test.js`](../test/vdo-ninja-transport.test.js)
- Demo: [`examples/two-browser-demo/`](../examples/two-browser-demo/index.html)
- Native Meta Quest profile: [guide](16-native-meta-quest-integration.md) and
  [`examples/native-meta-quest/`](../examples/native-meta-quest/README.md)

Continue with [04 — VDO.Ninja adapter](04-vdo-ninja-adapter.md) for the exact SDK setup and event flow.
