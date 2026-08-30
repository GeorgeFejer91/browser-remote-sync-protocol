# Application-integration starter

This directory is a copyable application seam for BRSP/1. It demonstrates how a real target app and a smartphone companion share semantic controls without exposing DOM selectors, raw browser events, arbitrary JavaScript, or a general remote desktop.

The starter has three deliberate layers:

- [`MarionetteSceneAuthority`](marionette-scene.js) owns exact validation, revisions, the command reducer, current authoritative state, and the pointer dead-man lease.
- `MarionetteTargetApplication` and `MarionetteControllerApplication` own explicit Start/Stop lifecycle around the transport-neutral [BRSP core](../../src/brsp.js).
- [`in-memory-transport.js`](in-memory-transport.js) is a deterministic test/example adapter. Replace only its factory with the [VDO.Ninja adapter](../../src/vdo-ninja-transport.js), an authenticated WebSocket adapter, or another adapter that meets BRSP's two-lane contract.

Construction is inert: it stores application configuration but does not invoke `transportFactory`, instantiate an SDK, or open a connection. A current user gesture must call `start()`.

## Target app

```js
import { VdoNinjaTransport } from "../../src/vdo-ninja-transport.js";
import { MarionetteTargetApplication } from "./marionette-scene.js";

const target = new MarionetteTargetApplication({
  sessionId: room,
  sharedSecret,
  peerId: freshTargetPeerId,
  transportFactory: () => new VdoNinjaTransport({
    role: "target",
    room,
    sharedSecret,
  }),
});

enablePhoneRemoteButton.addEventListener("click", async () => {
  await target.start();
});

stopPhoneRemoteButton.addEventListener("click", async () => {
  await target.stop();
});
```

The target grants only `scene.command` and `scene.intent`. Its reducer recognizes exactly `reset`, `set-pulse`, and `stop-pointer`. Intent contains exactly one complete pointer plus persistent hue value. Invalid types, missing fields, unexpected fields, non-finite values, and values outside the profile range are rejected before authoritative state changes.

The pointer is momentary. Valid active intent renews a receiver-local 500 ms lease; missing release, phone suspension, Wi-Fi loss, or battery failure neutralizes the pointer at the target. Hue uses `expiry: "hold"` and survives pointer expiry. A best-effort phone release is useful, but it is not the safety boundary.

The target's normal local UI should update `target.authority` through its own typed application functions, then call `target.publishAuthoritativeState()`. Do not mutate the DOM from a network callback and read it back as state.

## Smartphone controller

```js
import { MarionetteControllerApplication } from "./marionette-scene.js";

const controller = new MarionetteControllerApplication({
  sessionId: room,
  sharedSecret,
  peerId: freshControllerPeerId,
  transportFactory: () => new VdoNinjaTransport({
    role: "controller",
    room,
    sharedSecret,
  }),
});

connectButton.addEventListener("click", () => controller.start());

controller.addEventListener("statechange", ({ detail }) => {
  renderConfirmedTargetState(detail.state);
});

function publishCurrentControls() {
  controller.sendControls({
    pointer: { x: pointerX, y: pointerY, active: pointerOwned },
    hue: selectedHue,
  });
}
```

Call `sendControls()` from a bounded UI scheduler, normally `requestAnimationFrame`, rather than once per raw pointer event. The wrapper repeats intent every 100 ms only while the momentary pointer is active. Releasing the pointer sends `{ x: 0, y: 0, active: false }` and stops the intent heartbeat. Persistent controls send on change and do not create revision churn while idle.

`authoritativeState` and `desiredControls` are separate. Returned target state renders the controller display but is never automatically copied into a new outbound intent. This prevents a host-authored scene from echoing back as controller input.

Reliable actions use `reset()`, `setPulse()`, or `stopPointer()`. The controller permits one pending command, waits for `commandapplied`, and defaults `expectedRevision` to the latest confirmed target revision.

## Desktop wrappers and Wi-Fi

A Tauri, Electron, or other desktop WebView can run this JavaScript layer inside its web frontend and call a narrowly typed native reducer when native state is authoritative. Do not bridge BRSP action names to arbitrary native command names, script evaluation, selectors, files, shell strings, or unrestricted URLs.

VDO.Ninja can select a direct WebRTC path between a desktop WebView and a phone browser on the same Wi-Fi, but it still uses Internet signaling and ICE infrastructure. It is not offline LAN discovery. An offline/private-LAN product needs its own authenticated local signaling plus raw WebRTC, or an authenticated local WebSocket service, and a secure browser origin. The repository's loopback HTTP server is for same-machine development, not a phone-facing production server.

## Deterministic qualification

Run the paired starter tests with:

```sh
node --test test/application-integration.test.js
```

They prove inert construction, mutual readiness, exact validation without partial mutation, live intent followed by target-returned state, acknowledged commands and revision conflict, no revision churn for an unchanged heartbeat, lease expiry after a simulated lost phone release, persistent hue hold, and synchronous producer cancellation on Stop. They do not claim a public VDO.Ninja route, physical phone lifecycle, or direct/TURN performance.

