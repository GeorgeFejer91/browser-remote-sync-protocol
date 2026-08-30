# Native Meta Quest target fragments

This directory is a reusable, application-neutral integration sketch for making a native Meta Quest application a BRSP target for an external browser companion. It is intentionally **not** a complete APK, a Meta Spatial SDK template, or a qualification claim. Copy the fragments into an existing native Android/Meta project, replace the example actions with that application's semantic actions, compile them in the app's normal Gradle build, and qualify the resulting APK on named hardware.

The authority split is deliberate:

```text
phone/desktop browser companion
        |
        | BRSP/1 commands and returned sanitized state
        v
bundled Android WebView (VDO.Ninja transport only)
        |
        | bounded lane + peer + opaque UTF-8 payload
        v
native Kotlin BRSP session and authorization
        |
        | exact QuestAppAction
        v
one app-owned QuestActionPort used by local and remote UI
```

The WebView never receives the BRSP pairing secret, Android intents, filenames, native command names, permission authority, or a separate native grant/state API. Encoded BRSP frames can contain negotiated scopes and sanitized state, but the WebView carries them only as untrusted opaque bytes. It receives a separate VDO transport secret and forwards bounded data-channel frames. Kotlin performs BRSP proof, scope, epoch, sequence, dedupe, revision, lifecycle, and application validation.

## File map

- [`kotlin/QuestActionContract.kt`](kotlin/QuestActionContract.kt) defines a closed action vocabulary, exact argument decoding, scope/sensitivity metadata, and a privacy-safe state projection.
- [`kotlin/QuestActionRouter.kt`](kotlin/QuestActionRouter.kt) shows one application authority shared by local headset UI and remote requests, including revision, background, scope, and dedupe gates.
- [`android/BundledWebViewTransport.kt`](android/BundledWebViewTransport.kt) is a hardened transport-only Android WebView boundary with bundled-asset navigation, fixed JavaScript operations, lane byte caps, peer validation, and generation fencing.
- [`android/RemoteSessionOwner.kt`](android/RemoteSessionOwner.kt) shows explicit local Enable/Approve/Stop ownership and Meta activity/spatial lifecycle hooks.
- [`android/RemoteSessionService.kt`](android/RemoteSessionService.kt) shows a private notification Stop receiver; it never launches the activity or reconstructs authority after process death. The legacy filename is retained only so links stay stable.
- [`android/AndroidManifest.xml`](android/AndroidManifest.xml) is a manifest fragment with the minimum network/notification permissions for this architecture. Merge it deliberately instead of copying it over a real Quest manifest.
- [`webview/transport-lifecycle.js`](webview/transport-lifecycle.js) owns exactly one generation-fenced VDO transport instance, closes rejected peers, and makes stale callbacks inert.
- [`webview/bridge-forwarding.js`](webview/bridge-forwarding.js) fails closed when reliable outbound backpressure rejects a control frame.
- [`webview/index.html`](webview/index.html) and [`webview/index.js`](webview/index.js) show the bundled, pinned, data-only bootstrap with a narrow CSP and fixed native bridge methods.
- [`companion/profile.js`](companion/profile.js) is a hand-written companion profile that recognizes only the example catalog and sanitizes target state.
- [`fixtures/`](fixtures/) contains a byte-stable capability manifest, safe state, and positive/negative command cases shared by the deterministic tests.
- [`test/native-meta-quest.test.js`](test/native-meta-quest.test.js) checks the example's closed-world catalog, projection, lifecycle, and native-boundary invariants without claiming an Android build or WebRTC route.

## Replace the example contract first

The sample actions are deliberately small:

| Action | Scope | Availability | Meaning |
| --- | --- | --- | --- |
| `request-status` | `app.observe` | always | Return the current sanitized projection. |
| `request-capabilities` | `app.observe` | always | Return the exact action catalog. |
| `set-interaction-mode` | `panel.presentation.write` | interactive | Select `pointer` or `direct` through normal app logic. |
| `set-panel-visible` | `panel.presentation.write` | interactive | Change app-owned panel visibility; do not hide Stop/approval controls. |
| `recenter-panel` | `panel.presentation.write` | interactive | Request an app-owned spatial recenter operation. |
| `revoke` | `session.safety` | always | Revoke the current remote session. |
| `enable-browser-remote` | none | headset-local | Create a fresh invitation locally. Never decode from BRSP. |
| `approve-controller` | none | headset-local | Approve the pending controller/scopes locally. Never decode from BRSP. |
| `approve-runtime-permissions` | none | headset-local | Grant Android/Meta permissions locally. Never decode from BRSP. |

For a real application, inventory every local app action and classify it exactly once as remotely eligible normal, remotely eligible sensitive, or headset-only. A sensitive action gets its own scope and a separate local grant. Do not add a generic `invoke`, reflection lookup, Android intent, selector, key/input event, URL, file, shell, or arbitrary JSON state setter.

The companion should first request status/capabilities, compare the full manifest and capability hash with its pinned profile, and only then enable mutating controls. A scope alone is insufficient when target and companion builds may disagree about the action catalog.

## Wire local and remote input through one authority

Local panel controls for remotely eligible application semantics call `QuestApplicationAuthority.dispatch(action)`. The remote gate calls the same method only after BRSP proof plus scope, availability, revision, and epoch checks. Neither path clicks a UI element or writes view state directly. Headset-only lifecycle gates such as Enable and Approve are cataloged in the same closed manifest but are invoked through the local session owner and never decoded from BRSP.

Effects that can fail should run through an app-owned typed effect port. Commit a new revision only after the effect succeeds. A failed native effect returns a stable error and keeps state/revision unchanged. Avoid optimistic state that claims a panel recentered or device operation started before the native operation actually succeeds.

The example allows only observe/capability/revoke behavior while the activity is not interactive. All other requests return `target_not_interactive`; they are not queued for later execution. Adapt this allow-list to the app's safety case, but keep background behavior explicit and tested.

## Pairing and lifecycle assembly

1. A headset-local **Enable browser remote** action creates a fresh session ID, target epoch, 256-bit BRSP pairing secret, separate 256-bit VDO transport secret, and monotonically increasing transport generation.
2. Publish the locally approved notification Stop surface first so it exists before the endpoint is discoverable.
3. Give only `{ room, transportSecret, generation }` to `BundledWebViewTransport`. Keep the pairing secret exclusively in the native BRSP session.
4. Show the browser invitation locally in the headset. Treat its URL fragment/QR as a short-lived bearer secret; never log, persist, cache, or put it in a query string.
5. Both endpoints emit their hello immediately when both lanes open. The target hello advertises the locally grantable set frozen before transport starts; the controller hello supplies its independently generated identity/epoch/nonce and requested scopes. Show those requested scopes in the headset and require **Approve controller** before the target sends proof/ready or gains application authority. Any grant change closes the peer and starts a fresh invitation.
6. On BRSP ready, clear invitation display/material and expose only sanitized state.
7. The target is interactive only while both Android Activity resume and Meta VR readiness are true. Either `onPause` or `onVRPause` marks it background immediately. `onSpatialShutdown` and `onDestroy` call the same idempotent producer-first shutdown.
8. Notification **Stop**, headset **Stop**, proof failure, invite/session expiry, accepted peer close, or fatal reliable backpressure revokes scopes, advances/fences the generation, clears secrets, neutralizes leased intent, stops the WebView transport, and removes the notification.

The example uses an ordinary notification plus a private broadcast receiver; it does not claim foreground-service ownership. The receiver has no boot path, cannot cold-launch the Quest activity, and cannot recreate a remote session after process death. If the product genuinely keeps a network, BLE, or other operation alive in a foreground service, choose the Android service type that describes that actual work and move the relevant ownership there. A Stop notification by itself is not justification for `connectedDevice`.

## WebView boundary

Use AndroidX `WebViewAssetLoader` and an HTTPS app-owned asset origin. Disable file/content access, DOM storage, mixed content, remote navigation, popups, and media capture. Package the reviewed BRSP/VDO adapter and exact pinned VDO SDK locally; do not navigate this WebView to the external companion site. The example HTML paths work from this repository layout; adapt those local paths when copying the files into an Android asset directory without changing or remotely loading the pinned vendor bytes.

The JavaScript interface has only four fixed operations:

```text
peerOpened(generation, peerKey)
peerClosed(generation, peerKey)
postInbound(generation, lane, peerKey, payload)
transportDiagnostic(generation, kind, route, rttMs)
```

Each argument is bounded and generation-checked in Kotlin. Native-to-WebView delivery invokes one fixed bridge method with JSON-quoted string arguments. It never evaluates controller-provided code, even though Android's fixed `evaluateJavascript` API is used to call that bundled function.

A compromised transport WebView after a legitimate session is ready can still forge or suppress frames within the authority Kotlin granted to that authenticated peer. Pairing-secret separation prevents the WebView from independently completing a new BRSP proof, but it is not full containment of an already-authorized session. Use native WebRTC and per-frame authentication if that stronger boundary is required.

## Android and Meta Quest integration

Merge the manifest fragment with the app's real Meta/OpenXR declarations. The example needs network access plus local notification permission; it does not request camera, microphone, location, storage, accessibility, overlay, package-query, foreground-service, or boot permissions. If the product also uses Bluetooth, sensors, files, or a real foreground service, review those as separate capabilities and select the Android service type for the work that service actually owns rather than attributing it to BRSP.

Wire `RemoteSessionOwner` from the real Meta activity:

```kotlin
override fun onResume() {
  super.onResume()
  remoteOwner.onActivityResumed()
}

override fun onPause() {
  remoteOwner.onActivityPaused()
  super.onPause()
}

override fun onVRReady() {
  super.onVRReady()
  remoteOwner.onVrReady()
}

override fun onVRPause() {
  remoteOwner.onVrPaused()
  super.onVRPause()
}

override fun onDestroy() {
  remoteOwner.onActivityDestroyed()
  super.onDestroy()
}

override fun onSpatialShutdown() {
  remoteOwner.onSpatialShutdown()
  super.onSpatialShutdown()
}
```

Do not remotely request Android runtime permissions, launch the activity, dismiss Guardian/Meta UI, synthesize controller input, arm kiosk mode, or alter system settings. Those remain headset-local actions.

## Companion and networking boundary

The browser controller is an ordinary HTTPS page and requests only the scopes in [`companion/profile.js`](companion/profile.js). It renders the target's sanitized returned state, not an optimistic local copy. Reliable commands remain pending until a matching target acknowledgement arrives.

The supplied VDO.Ninja adapter uses Internet signaling and external ICE/TURN infrastructure even when the selected WebRTC path is direct over the same Wi-Fi. It is not an offline-LAN adapter. Offline use needs owned authenticated LAN signaling plus raw WebRTC, or an authenticated local WSS adapter, with its own HTTPS/certificate, Local Network Access, firewall, privacy, and qualification work. See the repository's [deployment boundary](../../docs/14-deployment-network-and-csp.md).

## Deterministic checks and evidence boundary

Run the whole repository gate:

```sh
npm run check
```

Or run only this fragment's Node checks:

```sh
node --test examples/native-meta-quest/test/native-meta-quest.test.js
```

These checks prove byte-stable fixture/profile agreement, exact command shapes, state redaction, headset-only exclusion, generation fencing, peer-close behavior, and producer-first Stop in JavaScript. Static checks inspect the manifest and Kotlin/WebView fragments for their documented boundaries.

They do **not** compile Kotlin, build or sign an APK, exercise Meta Spatial SDK APIs, contact VDO.Ninja, prove direct/relay routing, test notification or any selected Android foreground-service policy on a device, or qualify a physical Quest/phone. A product fork must add Kotlin/Android unit tests, Gradle lint/build, APK manifest/native-library inspection, install/hash readback, a physical headset command receipt, physical phone/browser lifecycle tests, and route/latency evidence under the [qualification model](../../docs/15-qualification-record.md).
