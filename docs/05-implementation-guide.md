# 05 — Implementation guide

This guide turns an existing browser application into a narrowly remote-controllable application. Work from application authority outward; do not begin by sending arbitrary UI events over a data channel.

## Step 1 — Inventory remote actions

List the exact user outcomes that should be remotely controllable.

Good:

- `presentation.next`
- `presentation.goto-slide { index }`
- `study.pause { paused }`
- `scene.set-position { objectId, x, y }`
- `player.seek { seconds }`
- `settings.preview { portableSettings }`

Bad:

- `run { javascript }`
- `click { cssSelector }`
- `keypress { key }`
- `fetch { url, headers }`
- `set-any-state { path, value }`

For every good action, document:

- scope;
- exact argument schema and numeric/string bounds;
- target preconditions;
- idempotency;
- revision behavior;
- success result;
- machine-readable rejection codes;
- user-visible effect;
- whether the action is safe to retry.

## Step 2 — Extract an authoritative reducer

Remote actions and local target UI should call the same application function.

```js
function applySceneCommand(current, command) {
  if (command.scope !== "scene.write") return reject("scope_denied", current);
  if (command.expectedRevision !== null && command.expectedRevision !== current.revision) {
    return reject("revision_conflict", current);
  }

  if (command.action === "set-position") {
    const x = Number(command.args.x);
    const y = Number(command.args.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return reject("invalid_argument", current);
    return accept({
      ...current,
      revision: current.revision + 1,
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
    });
  }

  return reject("unsupported_command", current);
}
```

Do not make the network handler mutate DOM elements and then read the DOM back as state. Keep one typed application authority and render from it.

## Step 3 — Separate three state domains

Create different variables/types for:

```js
localIntent          // local input before remote acceptance
authoritativeState   // target-owned accepted state
presentationState    // smoothing, animation, local camera, accessibility
```

Never automatically feed `authoritativeState` received from the target back into `localIntent`. This is the feedback-loop guard.

If the view is animated, decide whether animation phase is shared state or local presentation. Affect Tracker ordinary remote coordinates did not promise identical random visual phase; Party mode explicitly transmitted shared visual settings/phase and derived geometry from stable IDs. Make that distinction explicit for your application.

## Step 4 — Normalize cross-device geometry

Raw CSS pixels do not mean the same thing on two screens. Use semantic or normalized coordinates:

```js
const normalizedX = movableWidth <= 0
  ? 0.5
  : (objectCenterX - objectHalfWidth) / movableWidth;
```

For relative placement across different viewports:

```js
const local = clamp(
  localAnchor + remoteCurrent - remoteAnchor,
  0,
  1,
);
```

On the first remote placement, set `remoteAnchor = remoteCurrent` and `localAnchor = currentLocal`. Connecting then causes no jump. A local drag updates both anchors rather than changing upstream remote intent.

For a phone-only view camera:

```js
screenPoint = camera.project(sharedWorldPoint);
worldPoint = camera.inverse(localPointerPoint);
```

The camera can pan with one empty-space pointer and pinch about a two-pointer centroid. Keep it local, resettable, and excluded from BRSP state unless synchronized perspective is an explicit requirement. Desktop need not expose the control.

## Step 5 — Choose scopes and capabilities

Define small scopes by authority, not by UI screen:

```js
const targetGrantedScopes = [
  "scene.write",
  "presentation.navigate",
];

const controllerRequestedScopes = [
  "presentation.navigate",
];
```

Capabilities identify compatible optional mechanics:

```js
[
  "command-ack",
  "state-snapshot",
  "latest-state"
]
```

An unknown capability is absent from the intersection. Do not enable a behavior merely because one peer announced it.

## Step 6 — Generate session material

On an explicit target Start gesture:

```js
const room = generateVdoRoomId();
const sharedSecret = randomToken(24); // 192 random bits before base64url
```

Display/share through a trusted channel. Clear on Stop. Do not use a participant name or stable account ID in the public stream label.

Production invitation UX should include:

- target origin/app identity;
- role and requested scopes;
- expiry;
- one-time or bounded-use behavior;
- explicit Accept/Start;
- visible connected peer state;
- Stop/revoke;
- route/privacy disclosure.

BRSP/1 does not supply this service layer.

## Step 7 — Instantiate transport and session only on Start

```js
const transport = new VdoNinjaTransport({
  role,
  room,
  sharedSecret,
  forceTurn,
});

const session = new BRSPConnection({
  transport,
  role,
  sessionId: room,
  sharedSecret,
  requestedScopes: role === "controller" ? ["scene.write"] : [],
  grantedScopes: role === "target" ? ["scene.write"] : [],
  getState: () => authoritativeState,
  applyCommand: applyRemoteCommand,
});

await transport.start();
```

Constructing `VdoNinjaTransport` itself does not instantiate the SDK. `start()` does.

For a separable reducer/session lifecycle rather than one demo page, use the [`application-integration` starter](../examples/application-integration/README.md) and [12 — Copyable application recipes](12-app-integration-recipes.md).

## Step 8 — Render protocol phases

At minimum expose:

- idle;
- signaling connect;
- discoverable/discovering;
- target selection if multiple;
- peer channels open;
- authenticating;
- ready and accepted scopes;
- direct/relay/unknown route and RTT when available;
- command pending/applied/rejected;
- state live/stale/recovering;
- foreground/background scheduling warning where relevant;
- stopping/closed/error.

Use a text status with `aria-live`, not color alone. Keep target choices large enough for touch and controller-ray input if used in XR.

## Step 9 — Send commands without a UI flood

Discrete buttons can send one reliable command and wait for `applied`.

Continuous controller joysticks/sliders use the negotiated `latest-intent` lane. Coalesce DOM input with `requestAnimationFrame` and publish one complete current-control object:

```js
latestDesired = readControls();
if (!intentFrame) intentFrame = requestAnimationFrame(() => {
  intentFrame = undefined;
  session.publishIntent("controls.write", {
    joystick: latestDesired.joystick,
    scrubber: latestDesired.scrubber,
  });
});
```

The target's `applyIntent` callback validates the declared control manifest, applies the latest intent, and returns/publishes authoritative state. The adapter uses the unordered zero-retry channel and one newest pending frame, so obsolete intent does not form a reliable history.

Momentary intent needs a heartbeat and target lease. A phone that is suspended cannot reliably send a final pointer-up. Repeat current intent approximately every 100 ms while control is active, and have the target neutralize leased controls after roughly 500 ms without an accepted intent. Persistent controls may use a documented hold policy.

Discrete buttons still use `sendCommand()` and wait for `commandapplied`. A controller can keep one unacknowledged coalescible command when a command represents a replaceable but reliable transaction.

Do not update the shared display optimistically unless divergence is clearly represented and reconciled.

## Step 10 — Publish target state

On each accepted target change:

```js
session.publishState(authoritativeState, {
  revision: authoritativeState.revision,
});
```

Also schedule an unchanged heartbeat:

```js
const heartbeat = setInterval(() => {
  session.publishState(authoritativeState, {
    revision: authoritativeState.revision,
  });
}, 250);
```

The state adapter retains only the newest pending frame under backpressure. Heartbeats make a lost final update recover without requiring another user movement.

For high-rate state, use an ideal-deadline limiter rather than “time since last send” alone. Browser frames can arrive slightly early; rejecting every slightly-early frame and resetting from each accepted frame can unintentionally reduce 60 Hz input toward 30 Hz. Advance a nominal deadline, allow a small bounded early tolerance, enforce a minimum separation, and repay any timing debt so the long-run cap remains correct.

## Step 11 — Handle stale and recovery

Use receiver-local accepted-state age:

```js
if (session.isStateStale(performance.now(), 2_000)) {
  showHoldingWarning();
  // keep the final authoritative value
}
```

Apply valid returning state immediately, but use recovery hysteresis for the status if intermittent isolated frames would cause distracting flapping.

Do not fall through to an unrelated controller, sensor, or local automation on network loss unless the product explicitly defines and displays that takeover. A silent authority switch is dangerous.

Remember that a hidden/suspended page can delay both messages and the stale timer. If latency matters, design a foreground workflow and measure the actual target browsers/OS. Wake Lock can reduce sleep but cannot override operating-system task scheduling.

## Step 12 — Handle reconnect deliberately

Distinguish:

- same selected target, replacement channel inside a grace period;
- target stopped and restarted with a fresh stream ID;
- a different target appeared;
- a late close/message from the old channel;
- signaling listing that still shows a departed source.

The safe default is to retain explicit user selection and never auto-switch to a new target during an active/stale session. Bind callbacks to both selected stream/peer ID and channel object. Ignore old callbacks after replacement.

A new connection performs a new BRSP handshake and snapshot. Do not preserve `ready` from an old channel.

## Step 13 — Multi-peer host fan-out

For a small Party-like scene:

1. authenticate one independent connection per guest;
2. each guest sends only its own bounded intent/state upstream;
3. host assigns stable roster order and owns layout/shared visual state;
4. host assembles one bounded versioned aggregate;
5. host sends the identical encoded aggregate through every guest's existing duplex connection;
6. guest accepts it only if its own fresh ID is in the roster;
7. guest never gains another guest's direct connection or invite authority;
8. cap guest count, aggregate bytes, fan-out frequency, and heartbeat;
9. keep per-device view camera local;
10. preserve stale participants visibly or remove them only through explicit host policy.

Do not assume a full WebRTC mesh will scale. A central backend/SFU-like data relay may be more appropriate for many participants.

## Step 14 — Static settings transfer

Static configuration is not live state. Use a reliable ordered channel, capture one immutable normalized snapshot at Start, bound bytes, validate exact schema/version, preview on receive, and require a local Apply gesture.

Do not continuously rebroadcast later UI changes under an unchanged snapshot identity. Stop/restart or define a versioned update transaction.

## Step 15 — Teardown

Stop producers before awaiting infrastructure:

```js
async function stop() {
  phase = "stopping";
  clearInterval(heartbeat);
  cancelAnimationFrame(senderFrame);
  detachLocalInputOffers();
  closeCustomChannels();
  clearPendingCommandsAndState();
  await session.close();
}
```

Page close/refresh is best-effort; local state must still reset to idle on the next load. Do not auto-resume from local storage.

Use one idempotent lifecycle owner for Stop, `pagehide`, failed Start, component unmount, and native window destruction. The complete pattern is in [12](12-app-integration-recipes.md); native-shell cleanup is in [13](13-native-shell-webview-integration.md).

## Step 16 — Content Security Policy and hosting

After identifying the exact VDO signaling and ICE configuration, deploy HTTPS with a restrictive CSP. A conceptual starting point is:

```text
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data:;
connect-src 'self' wss://<reviewed-signaling-host> https://<reviewed-turn-config-host>;
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
```

STUN/TURN traffic is not fully described by CSP `connect-src`; browser/WebRTC network policy and enterprise firewalls also matter. This snippet is conceptual. The exact pinned-SDK host/ICE inventory, copyable static header, and Tauri v2 CSP are in [14 — Deployment, network, and CSP](14-deployment-network-and-csp.md); do not deploy the placeholders above.

## Step 17 — Qualify claims

Pass automated codec/state-machine/adapter tests first. Then use two fresh browser instances on the actual deployment and record:

- exact commit/build and SDK hash;
- browser/OS/device versions;
- direct and forced-relay route readback at both endpoints;
- RTT, state gap percentiles/max, duration, stale/recovery results;
- high-change backpressure;
- stop during delayed signaling teardown;
- target restart and explicit reselection;
- hidden/foreground behavior;
- phone viewport and local camera if applicable;
- console errors and accessibility checks.

Do not relabel a same-PC result as physical phone/Quest evidence, a force-relay flag as relay evidence, synthetic input as physical sensor evidence, or an old commit's result as current-build evidence.

The full matrix is in [08 — Testing and qualification](08-testing-and-qualification.md), and the current bounded evidence/open gates are in [15 — Qualification record](15-qualification-record.md).

## Native Meta Quest variant

For an immersive Quest target, keep Steps 1–17 but place BRSP proof, scopes,
revisions, and dispatch in pure Kotlin. A packaged WebView may carry only the
pinned VDO byte transport. Pair with separate transport/proof secrets, require
headset-local scope approval, compute interactivity from Android plus
VR/OpenXR readiness/focus, reject unsafe mutations while that combined guard is
false, and revoke on Spatial shutdown. The complete module layout,
four-field QR, Kotlin snippets, Android 14 foreground-service boundary, and
physical qualification matrix are in
[16 — Native Meta Quest target and browser companion](16-native-meta-quest-integration.md).
