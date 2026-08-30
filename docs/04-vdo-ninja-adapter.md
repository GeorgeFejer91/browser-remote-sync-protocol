# 04 — Exact VDO.Ninja data-only adapter

## Decision

Use the VDO.Ninja SDK as a WebRTC connection adapter, not as a video pipeline. The reference path creates no media stream and calls no `getUserMedia()`:

```text
Target:     connect -> joinRoom -> announce(data-only)
Controller: connect -> joinRoom -> discover -> view(audio:false, video:false)
Both:       one duplex peer connection -> two custom RTCDataChannels
```

The current upstream SDK documentation says `announce()`/`view()` is the data-only pattern and that the URL-level `datamode` option is not used by SDK applications. It also documents a single publisher/viewer connection as bidirectional and the most efficient data-only pattern.

## Version used here

The runnable demonstration pins official VDO.Ninja SDK `v1.5.5` because that is the exact version previously vendored, tested, and qualified by Affect Tracker.

```text
vendor/vdoninja/1.5.5/
  LICENSE-MPL-2.0.txt
  NOTICE.md
  vdoninja-sdk.js
  vdoninja-sdk.min.js
```

Pinned upstream hashes:

| File | SHA-256 |
| --- | --- |
| `vdoninja-sdk.min.js` | `390ea6c8b1a4e57bf7fa18ff2b394f25cc79e637130f97e4a29ca958a90fac77` |
| `vdoninja-sdk.js` | `8097d5420d7ed2426623d7ff08f6abd45f03f89e6540a6cc4b86bcdc057d841e` |
| `LICENSE-MPL-2.0.txt` | `3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04` |

The repository check recalculates these hashes. Do not replace `latest` in a production page without a deliberate SDK update, source/license review, adapter tests, and real-browser qualification.

The upstream SDK has continued to evolve after 1.5.5. Read current documentation before updating, but distinguish current claims from evidence for the pinned build.

## Load locally

```html
<script src="/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js" defer></script>
<script type="module" src="/app.js"></script>
```

Local loading avoids a runtime CDN dependency and makes the reviewed bytes explicit. The SDK remains MPL-2.0; the independently written adapter can use this repository's MIT license.

An npm-based application can instead pin `@vdoninja/sdk` to an exact reviewed version. Keep the lockfile and license/source provenance.

## No page-load connection

Construct neither the SDK nor the adapter at module top level. The page may load the local SDK file, render privacy information, and generate no network session.

```js
startButton.addEventListener("click", async () => {
  const transport = new VdoNinjaTransport(options);
  const session = new BRSPConnection({ transport, ...protocolOptions });
  await transport.start();
});
```

Each page load requires a fresh current user action. A remembered preference or query parameter MUST NOT auto-connect. Stop and `pagehide` quiesce producers and close channels.

## IDs and secrets

VDO.Ninja room and stream IDs accept alphanumeric/underscore identifiers; the SDK sanitizes other characters. The reference adapter normalizes the room and uses:

```text
room:      brsp_<fresh random token>
stream ID: brsp_target_<fresh random token>
label:     BRSP demo target
```

The label is public display metadata and contains no secret or private identity.

The same high-entropy pairing secret is supplied to the SDK password option and BRSP proof layer:

```js
const sdk = new VDONinjaSDK({
  password: sharedSecret,
  salt: "browser-remote-sync-protocol-v1",
  forceTURN: false,
});

await sdk.connect();
await sdk.joinRoom({ room, password: sharedSecret });
```

The SDK password helps protect/hash signaling material, while BRSP's transcript proof performs explicit application authentication and scope negotiation. Keep both layers. Do not confuse the SDK's historical default password with a secret unique to your session; always supply a generated value.

All data-only peers that must interoperate use the same explicit salt. VDO.Ninja's public web UI requires its own documented salt compatibility; this repository connects SDK-to-SDK.

## Target flow

Register SDK listeners before connecting so early listing/channel events are not missed:

```js
sdk.addEventListener("dataChannelOpen", ({ detail }) => {
  void openBrspChannels(detail.uuid);
});
sdk.addEventListener("dataChannelClose", handleClose);
sdk.addEventListener("userLeft", handleDeparture);
sdk.addEventListener("connectionFailed", handleFailure);
sdk.addEventListener("error", handleError);

await sdk.connect();
await sdk.joinRoom({ room, password: sharedSecret });
await sdk.announce({
  streamID: streamId,
  label: "BRSP target",
});
```

`announce()` is data-only. Do not call `publish()` and do not create a `MediaStream`.

When the SDK's normal connection data channel opens, the target opens the two application lanes to that peer UUID:

```js
const [control, state] = await Promise.all([
  sdk.openChannel(uuid, "brsp_control_v1", { ordered: true }),
  sdk.openChannel(uuid, "brsp_state_v1", {
    ordered: false,
    maxRetransmits: 0,
  }),
]);
```

The SDK places custom labels in its reserved `x-` namespace on the wire, so the receiving SDK reports `x-brsp_control_v1` and `x-brsp_state_v1`. Do not manually use a label that collides with VDO.Ninja control, file, resource, or binary channels.

## Controller flow

Listen for room sources and incoming custom channels before joining:

```js
sdk.addEventListener("listing", ({ detail }) => addListing(detail));
sdk.addEventListener("videoaddedtoroom", ({ detail }) => addSource(detail));
sdk.addEventListener("channelOpen", ({ detail }) => acceptChannel(detail));
sdk.addEventListener("userLeft", handleDeparture);

await sdk.connect();
await sdk.joinRoom({ room, password: sharedSecret });
```

Listing/event shapes have varied across SDK/service paths. A bounded adapter may normalize:

```js
const streamId = item.streamID ?? item.streamId ?? "";
const peerKey = item.UUID ?? item.uuid ?? "";
const label = item.label ?? item.streamLabel ?? item.name ?? "";
```

Select only stream IDs with the application prefix. The adapter may select the sole matching initial target, but if multiple targets exist it enters `selection-required` and exposes the bounded list. The application must call `selectTarget(streamId)` from an explicit user choice; it must not silently guess or switch ownership.

Open the target without requesting media or optional resource/file capabilities:

```js
await sdk.view(streamId, {
  audio: false,
  video: false,
  downloads: false,
  allowresources: false,
  label: "BRSP controller",
});
```

On `channelOpen`, verify:

- the selected `streamID` if supplied;
- the selected SDK peer UUID if already known;
- exact custom label;
- channel object and open state.

Bind the first accepted selected-stream channel to its SDK peer UUID. Every later custom lane must match the selected stream when supplied and the bound UUID. Bind messages to the accepted channel instance as well. Late messages or close events from a previous stream, UUID, or channel MUST NOT affect the current selection.

## The connection is already duplex

Do not make the controller announce and the target view merely to obtain a return path. A custom `RTCDataChannel` is bidirectional. In this adapter:

- controller → target: hello/proof/ready, command, snapshot-request, bye;
- target → controller: hello/proof/ready, applied, snapshot, state, bye.

One connection avoids duplicate delivery, duplicate ICE state, extra signaling, extra CPU, and ambiguous channel preference. Dual announce/view is needed only for another independently justified media or topology requirement.

## Incoming channel handling

For each lane:

```js
channel.binaryType = "arraybuffer";
channel.addEventListener("message", handleMessage);
channel.addEventListener("close", handleClose, { once: true });
```

The reference protocol sends UTF-8 strings, but accepts string/ArrayBuffer/view inputs at the codec boundary. It validates UTF-8 fatally and rejects oversize messages before JSON dispatch.

The state lane sets `bufferedAmountLowThreshold = 0` and listens for `bufferedamountlow`. Browser implementations define `bufferedAmount` as bytes queued by the user agent; it does not include application data that was never passed to `send()`.

## Backpressure

### Reliable control

The reference adapter refuses a new control message if:

```text
channel.bufferedAmount + messageBytes > 262,144
```

An application should normally keep at most one unacknowledged coalescible UI command and wait for `applied`. Non-coalescible workflows need a bounded command queue, timeout, retry/idempotency policy, and visible failure state.

### Live state

The reference adapter does not send live state while `bufferedAmount > 0`. It saves one newest state. A later offer replaces it. On drain, only that newest state is handed to the channel.

This policy was important in real testing: injected nonzero send backlog produced counted discards while the receiver stayed live, and clearing pressure delivered current state rather than replaying obsolete movement.

## Liveness and channel close

SDK connection/channel events are edges, not the complete application liveness signal.

- Record a close/departure immediately.
- Continue to use last accepted state age for a short repair grace if the application supports repair.
- Hold last state when stale.
- Do not let an unrelated optional packet reset liveness.
- Ignore late events whose peer/channel identity no longer matches the selected source.
- Require a fresh BRSP handshake on a replacement connection.

The Affect Tracker receiver originally entered stale immediately on explicit channel close even though silent packet loss had a two-second grace. Real forced-TURN testing showed the mismatch could flash the UI during a brief repair. The fixed behavior used the same last-valid-state deadline for both cases.

## Route diagnostics and TURN

VDO.Ninja can use direct host/server-reflexive paths or a TURN relay. The SDK exposes normalized peer-quality information in reviewed builds:

```js
const quality = await sdk.getPeerQuality(uuid);
const route = quality.relayed === true
  ? "relay"
  : quality.relayed === false
    ? "direct"
    : "unknown";
```

Show route and RTT as diagnostics. Do not use route as application liveness.

`forceTURN: true` requests a relay path. Qualification still requires independent readback from both endpoints. A flag is intent, not evidence.

For production privacy/reliability, evaluate a privately operated or contracted TURN service, credential rotation, geographic routing, capacity, logs, abuse controls, and service levels. Public community infrastructure is not an availability guarantee.

## Why not direct signaling WebSocket access

VDO.Ninja's upstream SDK documentation warns that direct use of its signaling WebSocket protocol is not approved, may be blocked, and may change without notice. The signaling service is for WebRTC handshakes, not arbitrary application relay.

Use the SDK. If you need a protocol and infrastructure contract you completely control, implement raw WebRTC with your own signaling service or choose WebSocket/WebTransport. Do not freeze a reverse-engineered private VDO signaling protocol into BRSP.

## WebSocket data fallback

The SDK can expose fallback options for some data helpers. The BRSP reference adapter does not enable fallback. A fallback would change:

- peer-to-peer versus server-relayed routing;
- delivery and backpressure semantics;
- privacy and service data processing;
- failure/reconnect behavior;
- qualification evidence.

If a product needs it, build a separate negotiated adapter and expose the actual active route.

## Teardown order

Stop is synchronous in intent and asynchronous only for signaling cleanup:

1. enter `stopping` so new offers/commands are rejected;
2. cancel heartbeats, rate schedulers, quality polling, and retry callbacks;
3. remove SDK listeners;
4. close custom data channels and clear pending state/control queues;
5. clear selected/discovered source and authenticated session state;
6. only then await `sdk.disconnect()`;
7. enter `closed` even if the signaling service was already gone.

This ordering prevents packets from being emitted while a slow SDK disconnect promise is pending.

## Minimal adapter skeleton

The complete implementation is [`src/vdo-ninja-transport.js`](../src/vdo-ninja-transport.js). Its externally meaningful event interface is:

```js
transport.addEventListener("status", showStatus);
transport.addEventListener("quality", showRoute);
transport.addEventListener("peeropen", attachBrsp);
transport.addEventListener("controlmessage", passControlToBrsp);
transport.addEventListener("statemessage", passStateToBrsp);
transport.addEventListener("peerclose", markDisconnected);
```

Continue with [05 — Implementation guide](05-implementation-guide.md) to integrate a real application's reducer and view.
