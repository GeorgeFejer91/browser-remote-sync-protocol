# 16 — Native Meta Quest target and browser companion

## Decision

A native Meta Quest application can be controlled from a phone or laptop
browser, but the browser must control an explicit application contract—not the
Quest operating system, arbitrary touch coordinates, Android components, or a
generic native method surface.

The recommended first architecture keeps the immersive renderer and product
authority in Kotlin/Meta Spatial SDK. BRSP authentication, scopes, revisions,
dedupe, and action validation also remain native. A small bundled WebView may
host the pinned VDO.Ninja JavaScript adapter when a native WebRTC build is not
yet available, but that WebView is a lower-trust transport component boundary:

```text
Android Chrome / desktop Chromium companion
  fixed controls + target-returned state
                 |
  BRSP/1 over data-only WebRTC
                 |
Quest APK: bundled local transport WebView
  VDO signaling + RTCDataChannel bytes only
                 |
  generation-bound, byte-bounded bridge
                 |
Quest APK: pure Kotlin BRSP target
  hello/proof/ready, scopes, sequence, dedupe, revisions
                 |
  typed RemoteAction
                 |
one application action dispatcher
  local panel ----------+---------- remote adapter
                        |
Polar/device adapter + Meta Spatial scene/panel authority
```

This is a migration architecture, not a reason to make the immersive app a
web application. A later native WebRTC adapter can replace the transport
WebView without changing the BRSP envelopes, action catalog, reducer, or
companion.

Do not embed Tauri in the immersive APK. Tauri can later wrap the same
companion profile for a native desktop/mobile operator shell, but the Quest
target remains Android/Kotlin/Meta Spatial and exposes no Tauri IPC surface.

Copyable integration fragments are in
[`examples/native-meta-quest/`](../examples/native-meta-quest/README.md).
They are not a complete Meta Spatial SDK project or a qualified APK.

## Scope and non-scope

This chapter covers:

- one native immersive target and one browser controller;
- Meta Spatial SDK/Android lifecycle ownership;
- explicit headset pairing and exact scope approval;
- a pure Kotlin BRSP target with cross-language fixtures;
- a packaged VDO.Ninja data-only bridge with no media tracks;
- typed app/Polar/presentation actions and sanitized state;
- Android 14 foreground-service and notification boundaries;
- build, APK, browser, WebRTC, Quest, and hardware evidence tiers.

It does not grant or imply:

- remote app launch, Guardian/Meta UI control, Android settings, permission
  approval, kiosk arm, or headset wake/unlock;
- arbitrary controller/touch/key injection, reflection, intents, components,
  URLs, files, shell commands, JavaScript, or native method names;
- video, microphone, raw ECG, participant records, or export download;
- offline LAN behavior from the supplied VDO.Ninja adapter;
- background survival after the immersive Activity or process is destroyed;
- safety-critical control.

If unrestricted screen/input control is the actual requirement, use a reviewed
remote-desktop architecture. Do not stretch BRSP into that security boundary.

## Authority map

Assign one owner to every fact before adding networking:

| Fact | Owner | Remote role |
| --- | --- | --- |
| Spatial entities, panels, and application phase | Native application state/reducer | Request a typed transition; render returned state |
| Polar BLE connection and ECG producer | Native Polar adapter | Request start/stop only when a declared guard permits it |
| Android permission prompts | Headset user and Android | Observe readiness only; never approve remotely |
| Pairing Enable, controller Accept, scope grant | Headset-local UI | Present request; cannot self-approve |
| BRSP proof, epochs, sequence, dedupe, revision | Pure Kotlin session core | Supply authenticated envelopes |
| VDO room discovery, signaling, ICE, RTCDataChannels | Packaged transport adapter | Establish the byte path only |
| Companion layout and local pending UI | Browser companion | Never becomes target authority |
| Route and RTT | Transport diagnostics | Sanitized observation; never identity or liveness authority |
| Foreground/background eligibility | Combined Android and VR/OpenXR lifecycle adapter | Reject disallowed actions; never defer them |

Local headset buttons and accepted remote requests must enter the same semantic
dispatcher. Do not implement a second remote-only reducer and do not simulate
clicking the local UI.

## Project layout

A practical Android project separates protocol authority from platform work:

```text
remote-control-core/
  Actions.kt            closed action and capability catalog
  Protocol.kt           bounded JSON + project-specific canonical JSON
  BrspWire.kt           exact BRSP/1 envelopes and proof transcript
  TargetConnection.kt   target handshake, scopes, sequence, dedupe, revisions
  Deadlines.kt          elapsed-realtime invitation/session/idle policy
  src/test/              cross-language fixtures and reducer/session tests

app/
  PolarRemoteActivity.kt             Spatial lifecycle and local panel
  NativeActionDispatcher.kt          sole semantic route
  PolarH10Adapter.kt                  BLE/Polar effects
  RemoteBrspAdapter.kt                Android owner-thread/session adapter
  BundledWebViewTransport.kt          fixed transport-only bridge
  RemoteStopNotification.kt           ordinary local Stop surface
  RemoteControlForegroundService.kt  optional qualifying-work owner
  src/main/assets/remote_bridge/      pinned packaged JS, no runtime CDN

companion/
  src/profile.js        exact scopes/actions/manifest/hash
  src/invitation.js     four-field fragment parser
  src/controller.js     inert lifecycle, command pending/applied/state
  vendor/               exact BRSP/VDO bytes and licenses
  test/                 browser/profile/invitation/lifecycle fixtures
```

Keep `remote-control-core` free of Android, Meta, Polar, WebView, and WebRTC
dependencies. That makes protocol tests fast and gives a future native WebRTC
adapter the same target authority.

## Start with the action catalog

Inventory every local application outcome exactly once. A useful entry records:

```kotlin
data class CapabilityManifestEntry(
  val actionType: String,
  val schemaVersion: Int,
  val requiredScope: RemoteScope?,
  val sensitivity: Sensitivity,
  val availabilityGuard: String,
  val remotelyEligible: Boolean,
)
```

An ECG/remote-panel pilot can use this closed catalog:

| Action | Scope | Guard | Remote |
| --- | --- | --- | --- |
| `request-status` | `app.observe` | always | yes |
| `request-capabilities` | `app.observe` | always | yes |
| `start-scan` | `polar.control` | interactive | yes |
| `stop-scan` | `polar.control` | always | yes |
| `retry-connect` | `polar.control` | interactive | yes |
| `disconnect` | `polar.control` | always | yes |
| `start-ecg` | `polar.control` | interactive and connected | yes |
| `stop-ecg` | `polar.control` | always | yes |
| `set-panel-visible` | `panel.presentation.write` | interactive | yes |
| `revoke` | `session.safety` | always | yes |
| `enable-pairing` | none | headset-local | no |
| `approve-pairing` | none | headset-local | no |
| `approve-permissions` | none | headset-local | no |

The exact names are an application profile, not additions to the normative
BRSP type registry. Another Quest app should define its own narrow catalog.
`set-panel-visible` must affect only the app-owned presentation panel; it must
not hide the headset-local pairing approval or every Stop/revoke surface. If
those controls share one panel, keep an independent notification Stop and
consider making remote hide ineligible.

The manifest test must enumerate the sealed action type and fail when an action
is missing or duplicated. Serialize the complete manifest with BRSP canonical
JSON and publish a SHA-256 capability hash in sanitized state. The controller
keeps mutation controls disabled until it has:

1. reached BRSP `ready`;
2. received the required scope;
3. requested the full manifest reliably;
4. compared the exact manifest and expected hash for its compiled profile.

This turns target/controller version skew into a visible fail-closed state.
`request-status` and `request-capabilities` may remain available so the mismatch
can be diagnosed. Do not let a label-only or hash-only comparison replace the
complete manifest comparison.

## Typed actions and results

Model the remote boundary with product types:

```kotlin
sealed interface QuestRemoteAction {
  val type: String

  data object RequestStatus : QuestRemoteAction {
    override val type = "request-status"
  }

  data object StartEcg : QuestRemoteAction {
    override val type = "start-ecg"
  }

  data class SetPanelVisible(val visible: Boolean) : QuestRemoteAction {
    override val type = "set-panel-visible"
  }

  data object EnablePairing : QuestRemoteAction { // headset-only
    override val type = "enable-pairing"
  }
}

data class RemoteResult(
  val actionId: String,
  val status: Status,
  val revision: Long,
  val error: ErrorCode?,
  val state: RemoteState,
)
```

The wire decoder uses an exact action/argument switch:

```kotlin
fun decodeAction(action: String, args: JsonObject): QuestRemoteAction =
  when (action) {
    "request-status" -> noArgs(args, QuestRemoteAction.RequestStatus)
    "start-ecg" -> noArgs(args, QuestRemoteAction.StartEcg)
    "set-panel-visible" -> {
      requireExactKeys(args, setOf("visible"))
      QuestRemoteAction.SetPanelVisible(args.requiredBoolean("visible"))
    }
    else -> throw ProtocolException(ErrorCode.ACTION_UNAVAILABLE)
  }
```

There is deliberately no `invoke`, `method`, `component`, `intent`, `path`,
`url`, `selector`, `event`, or `key` branch. A new outcome requires a new typed
variant, manifest entry, reducer case, negative tests, and controller profile.

## Share one application dispatcher

The dispatcher validates native preconditions, performs a bounded effect, then
commits the semantic reducer result:

```kotlin
fun dispatch(action: QuestRemoteAction): ActionApplyResult {
  val effectAccepted = when (action) {
    QuestRemoteAction.StartEcg ->
      state.sensor == SensorState.CONNECTED && polar.startEcg()
    is QuestRemoteAction.SetPanelVisible -> {
      spatialPanel.setVisible(action.visible)
      true
    }
    else -> true
  }

  if (!effectAccepted) {
    return ActionApplyResult(state, ErrorCode.ACTION_UNAVAILABLE)
  }

  val before = state // a synchronous native callback may already have updated it
  val reduced = QuestReducer.reduce(before, action)
  if (reduced.changed) {
    state = reduced.state.copy(revision = before.revision + 1)
  }
  return ActionApplyResult(state)
}
```

Do not increment revision or report success before a native effect is accepted.
A BLE SDK call can fail despite a syntactically valid remote command. Return a
stable error and unchanged state rather than speculative success.

The local panel calls this same `dispatch(action)` function. Equivalence tests
should prove that local and remote entrypoints produce the same reducer state,
native effect request, revision, and rejection for equivalent actions.

## Sanitize target state

Return only the fields the controller needs:

```kotlin
data class RemoteState(
  val revision: Long,
  val targetInteraction: TargetInteraction,
  val panelVisible: Boolean,
  val scan: ScanState,
  val sensor: SensorState,
  val ecg: EcgState,
  val connectionRoute: ConnectionRoute,
  val rttMs: Long?,
  val capabilityHash: String,
)
```

Do not include the H10 identifier, device address, raw ECG samples, HR/RR
history, participant data, questionnaire answers, pairing material, filenames,
export contents, stack traces, or peer addresses. Coarse status such as
`connected` or `streaming` is enough for the remote UI.

Diagnostics such as route and RTT may update more often than semantic state.
Do not increment the application revision merely because RTT changed; doing so
would make an otherwise current command fail its expected-revision check.

## Reproduce BRSP/1 exactly in Kotlin

A native target is interoperable only when it reproduces
[the normative wire contract](03-protocol-specification.md), including:

- one complete UTF-8 JSON value per message;
- 16 KiB control and 8 KiB replaceable-state limits;
- exact envelope fields and directions;
- finite numbers, depth/array/object/key bounds, and unsafe-key rejection;
- project-specific BRSP canonical JSON—not an RFC 8785 claim;
- role-bound HMAC-SHA-256 proof over the complete two-hello transcript;
- independent unsigned 32-bit lane sequences and fresh endpoint epochs;
- exact scope/capability intersection;
- command-ID/body dedupe and fresh-envelope acknowledgement on retry;
- expected revision checks and target-returned state;
- fresh proof/ready/snapshot on every replacement connection that a product profile
  supports. The Polar pilot instead treats accepted peer close as session
  termination and requires a fresh headset Enable/invitation.

Reject pathological nesting before building a recursive JSON tree. A byte cap
alone does not prevent a deeply nested 8 KiB document from exhausting a parser
stack. Then validate the parsed tree again.

Share byte-for-byte fixtures between JavaScript and Kotlin:

```text
canonical target hello bytes
canonical controller hello bytes
canonical complete transcript bytes
target proof input and base64url HMAC
controller proof input and base64url HMAC
wrong role / changed nonce / changed scope / changed array-order failures
```

Use an exact 43-character unpadded base64url representation for a SHA-256 HMAC
when that is what the JavaScript reference produces. Compare proof bytes in
constant time after validating encoding and length.

## Pairing invitation: exactly four transported values

The VDO transport password and BRSP proof secret serve different authorities.
Use independent fresh 256-bit values, encode them as unpadded base64url, and
keep both out of query parameters:

```text
https://controller.example/companion/
  #room=<vdo-room>
  &session=<brsp-session-id>
  &transportSecret=<vdo-password>
  &pairingSecret=<brsp-hmac-secret>
```

The fragment contains exactly:

| Field | Purpose | Consumer |
| --- | --- | --- |
| `room` | VDO discovery namespace | target transport and controller transport |
| `session` | BRSP/1 session binding | native target and controller BRSP core |
| `transportSecret` | VDO signaling/transport password | transport adapters only |
| `pairingSecret` | BRSP role-bound proof key | native target core and controller BRSP core |

It must not contain controller sender ID, controller epoch, controller nonce,
target epoch, requested scopes, a native component, or an action. Each endpoint
generates its own fresh sender ID, unsigned epoch, and nonce locally. In
particular, a target-authored QR must not fix the controller's replay namespace.

Parse only those four bounded keys, verify the companion origin, immediately
remove the fragment from visible history, hold values in memory, and still
require a current **Connect** gesture. A fragment is bearer material even
though it is not sent in the HTTP request. It can leak through screenshots,
browser history, extensions, copying, or shoulder surfing.

A defensive companion parser is:

```js
const ALLOWED = new Set([
  "room", "session", "transportSecret", "pairingSecret",
]);

export function invitationFromHash(hash) {
  const values = new URLSearchParams(hash.replace(/^#/u, ""));
  const keys = [...values.keys()];
  if (
    keys.length !== ALLOWED.size ||
    new Set(keys).size !== ALLOWED.size ||
    !keys.every((key) => ALLOWED.has(key))
  ) {
    throw new TypeError("Invitation must contain each exact field once.");
  }
  return validateExactInvitation({
    room: values.get("room"),
    session: values.get("session"),
    transportSecret: values.get("transportSecret"),
    pairingSecret: values.get("pairingSecret"),
  });
}
```

Generate an invitation only after a local headset Enable gesture. A conservative
pilot policy is:

- invitation expires after two elapsed-realtime minutes, including time spent
  waiting for proof;
- one controller peer only;
- target shows the requested scopes and requires local Accept;
- pairing secret is discarded after mutual proof;
- the QR/manual bearer is hidden and its Kotlin copy is cleared at `ready`;
- controller-idle authority expires after 15 minutes of accepted controller
  ingress;
- the absolute session expires after two elapsed-realtime hours;
- local Stop advances the session generation/epoch and clears all authority.

Use `SystemClock.elapsedRealtime()` or an equivalent monotonic clock. Handler
callbacks are scheduling conveniences, not deadline authority after headset
sleep.

## Optional public-beacon profile: permanent address, local approval

The Polar Remote Quest pilot also demonstrates a deliberately weaker discovery
profile for a lab operator who cannot scan a QR shown inside VR. It replaces the
one-time four-field transfer with one stable **public Beacon ID** while retaining
headset-local authorization for every controller session.

This is not the default BRSP trust model. The Beacon ID and every value derived
from it are public addressing/binding material. Anyone who knows the ID can
reach the room and form the role-bound proof. That proof binds the BRSP
transcript to the selected Beacon ID; it does **not** identify or authorize the
person. The wearer pressing **Accept** for the displayed controller and exact
scopes is the only application-authorization boundary.

The pilot profile is fixed as follows:

| Item | Rule |
| --- | --- |
| Beacon ID | 12 random bytes generated once per app install, stored privately by the app, displayed as six groups of four hexadecimal characters |
| Normalization | Remove spaces/hyphens, lowercase, require exactly 24 hex characters |
| VDO room | `prq_` plus the normalized Beacon ID |
| BRSP session ID | `prq.session.` plus the normalized Beacon ID |
| Transport binding | base64url(SHA-256(UTF-8(`polar-remote-quest/v1/transport\n` + ID))) |
| BRSP proof binding | base64url(SHA-256(UTF-8(`polar-remote-quest/v1/brsp\n` + ID))) |
| Browser persistence | The normalized public Beacon ID only; never controller state, derived fields, proofs, epochs, or participant/sensor data |
| Activation | No network session at page load. The browser requires Find then Request control; the target requires Allow external controllers |
| Authorization | One pending controller; headset displays controller ID and requested scopes; Accept or Reject is local-only |
| Replacement | Reject, peer loss, Stop, expiry, or transport failure revokes authority and creates a fresh target ID, epoch, nonce, and transport generation behind the same Beacon ID |

Native derivation:

```kotlin
private fun binding(label: String, normalizedBeaconId: String): String =
  Base64.getUrlEncoder().withoutPadding().encodeToString(
    MessageDigest.getInstance("SHA-256").digest(
      ("$label\n$normalizedBeaconId").toByteArray(StandardCharsets.UTF_8)
    )
  )

val room = "prq_$normalizedBeaconId"
val session = "prq.session.$normalizedBeaconId"
val transportBinding = binding("polar-remote-quest/v1/transport", normalizedBeaconId)
val brspBinding = binding("polar-remote-quest/v1/brsp", normalizedBeaconId)
```

Browser derivation:

```js
async function binding(label, id) {
  const bytes = new TextEncoder().encode(`${label}\n${id}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return btoa(String.fromCharCode(...digest))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

const room = `prq_${id}`;
const session = `prq.session.${id}`;
```

The target still emits its hello immediately after the lanes open, but it
withholds target proof, ready, application commands, and scoped state until
local Accept. Accept freezes only the intersection of the predeclared locally
grantable set and the exact controller request. Reject closes that peer and
rearms the same public address with fresh endpoint-local replay state.

Because the binding is derived from public material, this profile gives up the
normal separation between the VDO transport holder and the BRSP proof holder.
A malicious party who learns the Beacon ID can occupy or repeatedly request the
one-controller slot, and a compromised transport WebView can derive the same
binding. Rate limits, one-controller admission, a short pending-request window,
fresh epochs, and local Reject reduce abuse but do not create identity. Use an
account-backed one-time invitation or a reviewed PAKE/ephemeral-key bootstrap
when controller identity, unattended access, or denial-of-service resistance is
a product requirement.

The reference subpage implementing this profile is:

```text
https://georgefejer91.github.io/browser-remote-sync-protocol/polar-remote-quest/
```

For the current single-headset test pilot, that hosted page and its matching APK
compile in one fixed public Beacon ID. The UI therefore has no Beacon-ID or Find
step: pressing **Request full app control** derives the fixed room/session
bindings locally and requests every remotely eligible scope. The wearer must
still press **Accept** or **Reject** in the Quest. This deliberate convenience
mode means any site visitor can request control and all APKs built with the same
constant collide in one global rendezvous room. Keep it confined to one attended
pilot; restore a per-install address or authenticated bootstrap before deploying
multiple headsets.

It is a static PWA. GitHub Pages hosts only controller assets; VDO.Ninja still
provides Internet signaling/ICE, and application commands remain on encrypted
WebRTC data channels. This is not a WAN-disconnected offline-LAN design.

## Local approval before target proof

BRSP/1 requires both endpoints to send `hello` immediately after both lanes
open. Local approval therefore cannot be implemented by withholding the target
hello. Fix the target's grantable scope policy—including any sensitive-scope
toggle—before Enable opens the transport.

The target hello advertises the complete predeclared `locallyGrantable` set; it
does not wait for the controller request and does not place the eventual
intersection in `grantedScopes`. Both endpoints emit their independently formed
hello immediately after both lanes open. When the controller hello arrives, the
target validates and binds one pending controller, computes
`requestedScopes ∩ locallyGrantable`, and displays that accepted-scope
candidate with the bounded sender label. It may validate and retain one exact
early controller proof, but it sends no target proof, `ready`, snapshot, state,
or application response until the wearer accepts locally:

```text
lanes open
  -> target hello advertises the frozen locally-grantable set immediately
  -> controller hello advertises its request immediately
  -> exact controller decode and one-peer binding
  -> compute the accepted-scope intersection
  -> target phase PENDING_LOCAL_APPROVAL
  -> show requested and accepted-scope candidate in headset
  -> controller proof may be validated/held, but target proof is withheld
  -> wearer Accept
  -> target proof + matching ready exchange
  -> snapshot + latest state
```

If the wearer rejects the controller or wants to narrow the predeclared grant
set, close the peer and create a fresh invitation under the new local grant
policy. A target hello must never change inside one handshake. This flow keeps
the normative immediate-hello rule, makes local acceptance mandatory before
mutual readiness, and binds the complete requested/granted arrays and both
endpoint epochs into the proof transcript. Both endpoints independently verify
that `ready.acceptedScopes` is the sorted intersection.

Sensitive scopes need a distinct headset-local toggle or approval page before
Enable. Do not bundle participant identifiers, consent, questionnaire answers,
exports, or recording control into a broad general scope merely because the
same operator uses them.

## VDO.Ninja transport bridge

The supplied VDO adapter remains data-only:

```text
target WebView:     connect -> joinRoom -> announce(data-only)
controller browser: connect -> joinRoom -> view(audio:false, video:false)
both:               brsp_control_v1 + brsp_state_v1 RTCDataChannels
```

The reliable control channel carries handshake, command, acknowledgement,
snapshot, error, and bye. The unordered zero-retry channel carries target
state. This pilot profile does not accept controller state-lane messages; add
controller live intent only as a separately declared capability and reducer.

Package the exact readable/minified VDO SDK, license, BRSP adapter, and hash
records into the APK. Load no executable JavaScript from a runtime CDN. The
bridge should be loaded from AndroidX `WebViewAssetLoader` under
`https://appassets.androidplatform.net/assets/`, disable file/content access,
disable DOM storage when unneeded, reject navigation away from the bundled
origin, and set `android:usesCleartextTraffic="false"`. Android documents
`WebViewAssetLoader` as the HTTPS/Same-Origin-compatible way to load packaged
assets and warns that native WebView bridges can expose app authority if they
load untrusted content or broad methods ([asset loader](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader.html),
[native-bridge risks](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)).

Expose only fixed transport operations:

```kotlin
interface TransportEndpoint {
  fun peerOpened(generation: Long, peerKey: String): String
  fun peerClosed(generation: Long, peerKey: String): String
  fun postInbound(
    generation: Long,
    lane: String,
    peerKey: String,
    payload: String,
  ): String
  fun transportDiagnostic(
    generation: Long,
    kind: String,
    route: String,
    rttMs: Int,
  )
}
```

There is no bridge method for an app action. Kotlin treats `payload` as
untrusted bytes and independently validates the full BRSP session before the
typed dispatcher is reached.

Native-to-WebView output also uses one fixed operation:

```text
receive(lane, peerKey, boundedEncodedEnvelope)
closePeer(peerKey)
stop()
```

Validate lane, peer-key shape, byte size, and transport generation on both
sides. Queue all Kotlin session mutation onto one owner thread with a bounded
admission gate. Fence every asynchronous `connect`, `join`, `announce`, event,
send, and stop completion by generation/operation identity so a late callback
from a previous invitation cannot mutate the current session.

Reliable outbound backpressure is fail-closed. If the control adapter refuses
an envelope because its bounded backlog is full, close the peer and revoke the
native session. Replaceable state retains only one newest pending value.

An explicit native `closePeer()` must report the peer-close edge back into
Kotlin even if the pinned JavaScript adapter does not emit its own close event.
Deduplicate that report. Otherwise Kotlin may retain a `READY` session after
the transport peer is gone.

## Why separate the two secrets

Supplying one secret to both VDO and BRSP is permitted by the generic browser
demo but gives a bundled transport WebView the BRSP bearer. A native target can
do better:

- `transportSecret` enters only the target WebView and controller transport;
- `pairingSecret` enters only the Kotlin BRSP core and controller BRSP core;
- WebView transport events are untrusted until Kotlin verifies BRSP proof;
- a transport compromise cannot create a brand-new authenticated session from
  the VDO secret alone.

This separation has a precise residual risk. After a legitimate session has
reached `READY`, compromised WebView JavaScript can observe and forge newer
typed BRSP frames on the existing authenticated channel within already granted
scopes. Keeping the proof secret out of the WebView does not authenticate each
post-ready frame to Kotlin. Stronger containment requires native WebRTC/channel
ownership or a reviewed per-frame session-MAC extension. Do not describe the
WebView design as resilient to a live WebView-engine compromise.

## Controller contract

The browser controller is inert on construction and starts only on **Connect**.
It creates a fresh local controller ID, epoch, and nonce; requests explicit
scopes; and renders only target-returned state.

For a discrete command:

```js
const commandId = session.sendCommand(
  "panel.presentation.write",
  "set-panel-visible",
  { visible: false },
  { expectedRevision: confirmed.revision },
);
pending.set(commandId, performance.now());
```

The controller waits for the matching `applied` body:

```json
{
  "commandId": "cmd_...",
  "ok": true,
  "revision": 12,
  "result": {
    "revision": 12,
    "targetInteraction": "interactive",
    "panelVisible": false,
    "scan": "idle",
    "sensor": "connected",
    "ecg": "stopped",
    "connectionRoute": "direct",
    "rttMs": 23,
    "capabilityHash": "..."
  },
  "error": null
}
```

Only then does the UI show the transition as applied and compute
command-to-applied latency. A `send()` return, VDO data-channel open event, or
JavaScript promise completion is not application success.

Bound controller work as well:

- maximum pending commands;
- acknowledgement timeout policy;
- one exact catalog compiled into the UI;
- complete manifest/hash verification before mutations;
- no arbitrary action entry field;
- no pairing secrets in storage, service-worker cache, logs, crash reports, or
  analytics;
- Stop clears session, transport, pending commands, manifest confirmation, and
  confirmed state.

An installable PWA improves launch ergonomics and asset caching. It does not
grant background JavaScript reliability. Qualify phone lock, app switch,
browser suspension, orientation, and network changes on physical supported
devices.

A service worker may cache only versioned static companion/profile assets. It
must not persist invitation values, secrets, proofs, pending commands, returned
state, or logs. Update the controller profile and expected manifest/hash as one
release unit. A cached UI that opens without WAN is not evidence of offline-LAN
control; the VDO adapter still needs its external signaling/ICE path.

The Polar pilot publishes unchanged sanitized state every two seconds and the
companion marks it stale after six seconds without accepted target state. A
target heartbeat does not extend the 15-minute controller-idle authority.
After an accepted peer-close edge, the pilot revokes native `READY` state and
requires a fresh headset Enable/invitation rather than retaining a 60-second
authenticated reconnect grace. An adopter that wants resumption must design
and qualify it explicitly; VDO stream/peer identity alone cannot resume BRSP
authority.

## Foreground, background, and shutdown policy

Define eligibility from the target lifecycle, not from WebRTC connection state:

| Target condition | Allowed remote behavior |
| --- | --- |
| Activity resumed and XR session ready/focused under the app's HMD policy | All granted actions whose product guards pass |
| Activity paused or XR paused/unfocused but process still alive | Status/capabilities plus idempotent safe stop, disconnect, ECG stop, and revoke |
| Non-interactive target receives an unsafe mutation | Return `target_not_interactive`; do not queue |
| Spatial shutdown or Activity destruction | Revoke, stop producers, close transport/service, clear secrets |
| Process death/service recreation | No session material; fail closed and stop |
| App not launched | No remote endpoint; remote cold launch is out of scope |

Never defer a rejected background mutation for execution on resume. A command
that arrived while the target was non-interactive must remain rejected after
the Activity/XR session returns.

Android `onResume()` alone is not an XR-interactivity signal. Compute an
effective target guard from the Android Activity state plus the pinned Meta
SDK's VR/OpenXR readiness/focus callbacks. Meta documents `onVRReady()` and
`onVRPause()` as independent from the Android lifecycle; an app may additionally
require `onHMDMounted()` and clear interactivity on `onHMDUnmounted()` when its
safety/usability policy requires a wearer. Publish the effective transition
immediately so the companion does not render stale eligibility.

Meta's Spatial SDK adds `onSpatialShutdown()` to the Android lifecycle and
documents it as the reliable final Spatial cleanup callback, while `onStop()`
or `onDestroy()` may not be called. It also requires the full immersive
`android:configChanges` set shown in its lifecycle guide for current Horizon OS
behavior ([Meta Spatial Activity lifecycle](https://developers.meta.com/horizon/documentation/spatial-sdk/spatial-sdk-activity-lifecycle/)).
Use one idempotent shutdown owner from `onSpatialShutdown()`, `onDestroy()`,
failed initialization, and local Stop, and call `super.onSpatialShutdown()` in
the order required by the pinned SDK.

An outline is:

```kotlin
private var activityResumed = false
private var vrReady = false

private fun updateRemoteInteractivity() {
  dispatcher.setTargetInteractive(activityResumed && vrReady)
  remote.publishLatestState()
}

override fun onPause() {
  activityResumed = false
  updateRemoteInteractivity()
  super.onPause()
}

override fun onResume() {
  super.onResume()
  activityResumed = true
  updateRemoteInteractivity()
}

override fun onVRPause() {
  vrReady = false
  updateRemoteInteractivity()
  super.onVRPause()
}

override fun onVRReady() {
  super.onVRReady()
  vrReady = true
  updateRemoteInteractivity()
}

override fun onSpatialShutdown() {
  shutdownOnce()
  super.onSpatialShutdown()
}

override fun onDestroy() {
  shutdownOnce()
  super.onDestroy()
}
```

## Android 14 foreground-service boundary

A foreground service is justified only when it owns actual ongoing work that
matches its declared service type. Do not start one merely to obtain a
persistent Stop notification. If the Activity owns all transport/session work
and destruction tears it down, keep Stop in the headset UI and use an ordinary
ongoing notification if a second local surface is useful.

An ordinary notification does not keep the process alive. Treat its permission,
visibility, action delivery, and removal as physical-device UI evidence, and
retain an in-Activity Stop surface when the Activity is interactive.

When qualifying connected-device work really moves under a foreground service,
the service may provide a persistent, locally approved Stop action. It still
does not automatically own the Spatial scene, recreate pairing material,
launch the Activity, or prove background session survival.

For an Android 14 target, select the service type that actually describes the
work owned by the service. Android requires the type, `FOREGROUND_SERVICE`, the
type-specific `FOREGROUND_SERVICE_CONNECTED_DEVICE` permission, and at least
one listed runtime/manifest prerequisite for a service that genuinely owns the
external BLE/network-device interaction. A manifest may declare
`CHANGE_NETWORK_STATE` so qualifying network-device work can start before an
optional Bluetooth runtime grant; Bluetooth permissions remain separately
required before Polar operations. Merely satisfying that prerequisite does not
justify the service type. See Android's current
[foreground-service type requirements](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device)
and [launch rules](https://developer.android.com/develop/background-work/services/fgs/launch).

Do not copy `connectedDevice` into every Quest app. A different use case may
require another type or no long-running service; verify the current target SDK
requirements and purpose-built alternatives.

When the service genuinely owns qualifying connected-device work, its
declaration stays private:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission
    android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<service
    android:name=".RemoteControlForegroundService"
    android:exported="false"
    android:foregroundServiceType="connectedDevice" />
```

Recommended service rules:

- start only from the visible Activity after local Enable;
- own the actual bounded BLE/network connected-device work represented by its
  type; do not declare a type only to satisfy a permission prerequisite;
- make notification approval a local product gate before exposure;
- include a notification action that invokes only local revoke/Stop;
- return `START_NOT_STICKY`;
- register no boot receiver;
- accept no external intent extras that select actions, components, peers, or
  permissions;
- never start the Activity remotely;
- on unexpected service recreation, stop because no in-memory session key or
  approval exists.

The notification is a Stop surface, not proof that the WebView or Spatial
Activity will continue running after destruction. If real service-owned
background connectivity is required, move transport/session ownership into a
separately designed component and requalify Android, Meta, security, and UI
semantics; do not infer it from an FGS declaration. A notification-only pilot
should remove the FGS rather than presenting `connectedDevice` as cosmetic
lifecycle authority.

## Worked end-to-end command

For `set-panel-visible { visible: false }`:

1. Companion is `ready`, has `panel.presentation.write`, and has verified the
   exact target manifest/hash.
2. It sends one reliable `command` with unique ID and the last confirmed
   revision.
3. The transport WebView forwards bounded opaque bytes plus the current
   generation and peer key.
4. Kotlin checks generation, one-controller ownership, elapsed deadlines,
   envelope, session, peer ID/epoch, sequence, scope, action, exact args,
   dedupe, target interactivity, and revision.
5. The shared dispatcher calls the native panel visibility effect.
6. Only after accepted effect, the reducer increments revision.
7. Kotlin sends one `applied` result and a newest-only sanitized state.
8. The companion clears pending only on the matching acknowledgement and
   renders `panelVisible:false` from returned state.

Expected failures do not mutate state:

| Condition | Result |
| --- | --- |
| Controller did not receive the scope | `scope_denied` |
| Manifest/hash not verified | Controller does not send |
| Activity paused or XR paused/unfocused | `target_not_interactive` |
| `visible` missing, non-boolean, or extra field present | `malformed`/`invalid_argument` |
| Expected revision is old | `revision_stale` |
| Same action ID with different body | `deduplication_conflict` and close/fail-closed policy |
| Previous transport generation/epoch | `stale-generation`/`epoch_stale` |
| Duplicate/old sequence | `replay` |
| Native panel effect fails | `action_unavailable` |

## Safe revocation order

Stop is producer-first and idempotent:

1. enter stopping/disabled so new ingress and local offers reject;
2. cancel state heartbeat, deadline callbacks, quality polling, retries, and
   controller input;
3. neutralize app-owned live intent and stop Polar/other producers as product
   policy requires;
4. send best-effort `bye` only if already ready;
5. clear native proof secret, approvals, controller binding, dedupe, and
   invitation bearer;
6. advance/invalidate the transport generation before asynchronous callbacks
   can return;
7. close data channels and the VDO transport;
8. remove the WebView bridge/destroy the WebView during final Activity
   shutdown;
9. remove the foreground notification/service if one exists.

Do not await signaling disconnect before revoking native authority. A delayed
service promise must not leave commands or heartbeats active.

## Network modes: do not conflate them

### Internet-assisted VDO.Ninja mode

The packaged VDO adapter uses external VDO signaling, STUN, and optional TURN.
Two devices on the same Wi-Fi may select a direct ICE path for application
bytes, but Internet services are still needed to establish it. Report the
access network and observed route independently:

```text
access network: same Wi-Fi
signaling dependency: Internet/VDO.Ninja
observed selected route: direct / relay / unknown
```

Do not call this offline LAN. Do not call `forceTURN:true` relay evidence until
both endpoints independently report a relay-selected candidate.

### Offline-LAN mode

Offline LAN is a separate adapter and qualification unit. It needs owned
authenticated signaling or an authenticated local WSS relay, certificate and
origin strategy, browser Local Network Access behavior, discovery/QR policy,
ICE configuration, peer identity binding, abuse limits, and operations. BRSP
application envelopes and reducers can remain unchanged.

An HTTPS PWA reaching a private HTTP/WS endpoint can be blocked by mixed-content
or local-network rules. Do not work around this by disabling browser security
or accepting generic certificate warnings. Follow [the deployment chapter](14-deployment-network-and-csp.md).

## Build and APK inspection

A green Gradle task is only source/package evidence. Produce a content-addressed
APK and inspect the actual artifact:

- exact package/application label/version/SDK levels;
- one expected exported launcher Activity;
- remote service `android:exported="false"` and exact FGS type when present, or
  proof that a notification-only design packaged no FGS;
- requested permissions and absence of camera, microphone, storage, location,
  broad package, accessibility, or debug-provider permissions not justified by
  the profile;
- `allowBackup="false"` and cleartext disabled where required;
- arm64 native libraries and signer/certificate digest;
- bundled bridge, BRSP/VDO source, license, notice, and exact SHA-256 values;
- no runtime CDN URL, release debugging provider, generic IPC service, or
  remotely selectable component;
- final APK SHA-256.

Install and launch by an exact serial-scoped device workflow. A matching APK
hash plus resumed package proves installation/launch only. It does not prove
the spatial panel was visible, a browser authenticated, a command applied, a
VDO route, or H10 ECG.

## Validation matrix

Keep evidence cumulative and claim-specific:

| Stage | Required proof | Still not proved |
| --- | --- | --- |
| Kotlin/JS deterministic | canonical/HMAC fixtures, malformed input, scope, replay, dedupe, revision, deadlines, reducer/effect result | Browser, VDO, Android, Quest, H10 |
| Android host build | debug/release compile, lint, manifest and APK inspection, packaged asset hashes | Runtime lifecycle or visible panel |
| Browser deterministic | real browser modules/Web Crypto, invitation parser, profile/manifest gate, controller lifecycle | Public signaling, ICE route, physical phone |
| Attended VDO | exact build, target/controller proof, command/applied/state, route readback, Stop | Quest runtime unless target is installed APK |
| Physical Quest + desktop browser | installed APK hash, visible spatial effect, native marker, lifecycle, route | Physical-phone touch/lifecycle; H10 unless present |
| Physical Quest + Android phone | Selected one-time invitation or Beacon Find/Request/Accept, touch/orientation/lock/network cases, commands and state | iOS or unlisted devices |
| Physical Quest + worn H10 | device-local permission, discovery/connect, 130 Hz ECG readiness and increasing real samples, remote start/stop | Other sensors/firmware/environments |
| Offline LAN | WAN disconnected, owned adapter, authenticated pairing, browser permission, observed route and latency | Internet/VDO service behavior |

At minimum, automate these negative cases:

- both endpoints emit independently formed hellos immediately when both lanes
  open; target proof/`ready` and application data remain blocked until local
  Accept, and a grant-policy change requires a fresh invitation;
- wrong proof secret, reflected role, changed transcript, and exact proof length;
- malformed, oversize, excessive depth, unsafe key, unknown field/action;
- before-ready application data and controller state-lane injection;
- wrong session/sender/peer/generation/epoch, duplicate/old sequence;
- denied scope, stale revision, command-ID/body conflict, unavailable native
  effect;
- more than one controller, queue/rate overflow, reliable-send failure;
- invitation/idle/absolute elapsed-realtime expiry;
- heartbeat/diagnostic traffic does not extend controller-idle authority;
- pause rejects mutation without deferred execution;
- peer close immediately revokes native `READY` authority;
- cleared proof material plus peer loss cannot silently authenticate a
  replacement connection;
- late configure/start/channel callbacks from an old generation are inert;
- Stop, Activity destroy, Spatial shutdown, and process/service recreation are
  fail-closed and idempotent;
- manifests cover every action exactly once and companion/native manifests are
  canonical-byte equal;
- logs contain no secrets, peer/device identifiers, raw ECG, participant data,
  questionnaire values, or export contents.

For physical acceptance, record command-to-`applied` p50/p95/p99 from the
controller pending timestamp, route readback, state convergence, and exact
device/browser/build identities. A sub-500 ms p95 goal is a product criterion,
not a claim until measured on the named network and route.

## Privacy-safe evidence markers

Useful headset markers contain only bounded semantics:

```text
channel=remote status=peer-open accepted=true
channel=remote status=proof-verified authority=scoped
channel=remote status=command-applied action=set-panel-visible revision=12
channel=remote status=command-rejected error=target_not_interactive
channel=remote status=transport-quality route=direct rttMs=23
channel=remote status=session-closed authority=revoked
```

Hash the session epoch if correlation is necessary; never log its raw value.
Do not log raw invalid payloads. Evidence screenshots must not show the QR,
fragment, room, secrets, peer identifiers, nearby private environment, or
participant/sensor data.

## Current pilot boundary

The independent **Polar Remote Quest** pilot informed this chapter. Its current
implementation shape includes a pure Kotlin target core, a native Meta Spatial
panel, Polar H10 adapter, packaged transport-only WebView, Chromium companion,
closed 13-entry action manifest, optional public-beacon/local-approval profile,
controller-owned epoch, local scope approval, elapsed deadlines, foreground
Stop notification, a separately scoped bounded ECG activity projection, and
deterministic/APK host gates.

The pilot's current notification-only foreground-service shape is not a
completed Android `connectedDevice` qualification: before release it must
either move genuine qualifying connected-device work under the service owner or
remove the FGS and retain Stop through Activity UI/an ordinary notification.
Likewise, effective interactivity must combine Android and VR/OpenXR state and
the immediate-hello/local-approval flow must pass the conformance fixtures.

That description is architecture and host-built evidence. Unless a separate
immutable qualification record names the exact APK hash, Quest, controller,
H10, browser, route, actions, lifecycle cases, latency distribution, and raw
evidence location, it does **not** claim:

- an attended browser command changed the physical Quest scene;
- physical Android phone qualification;
- direct or relayed route qualification;
- worn-H10 ECG qualification;
- offline-LAN operation;
- sub-500 ms p95 latency;
- production readiness.

Keep those rows `not tested` until the exact candidate passes. Update
[15 — Qualification record](15-qualification-record.md) with a new immutable
row rather than rewriting host evidence into a physical-device claim.

## Implementation sequence

1. Build a separate Quest APK/package so the existing study remains untouched.
2. Inventory every local action and mark it normal, sensitive, or headset-only.
3. Extract one native dispatcher and state projection; route local UI through
   it before networking.
4. Implement pure Kotlin BRSP parsing, canonical proof, session, deadlines,
   dedupe, revisions, and manifest tests.
5. Prove JavaScript/Kotlin canonical and HMAC fixtures byte for byte.
6. Add local Enable, requested-scope display, Accept/Reject, Stop, and expiry.
   Choose either the default four-field one-time invitation or the explicitly
   documented public-beacon/local-approval profile; do not blur their trust
   claims.
7. Add the packaged transport-only adapter with separate VDO secret,
   generation fencing, bounded bridge, and fail-closed peer close.
8. Add the browser companion with manifest/hash gate and confirmed-state UI.
9. Wire foreground/background policy and one idempotent Spatial shutdown owner.
10. Add a locally started, non-exported, non-sticky foreground service only if
    it owns actual work matching a current Android service type; otherwise use
    the Activity's Stop UI and, if needed, an ordinary notification.
11. Pass deterministic Kotlin/JS/browser tests, lint, and APK inspection.
12. Install the exact APK and prove one visible typed command end to end on a
    physical Quest.
13. Expand the catalog only after scope, redaction, lifecycle, and audit tests
    pass for each action class.
14. Qualify physical phone/H10/route/latency rows separately.
15. Implement offline LAN only as a new owned transport with its own security
    and browser/network acceptance matrix.

## Adoption worksheet

```text
Quest application/package:
Pinned Meta Spatial SDK and target Horizon OS:
Authoritative native state owner:
Local action inventory:
Normal / sensitive / headset-only classification:
Remote scopes:
Exact action and argument schemas:
Availability/background guards:
Capability manifest version and canonical SHA-256:
Sanitized state fields:
Native effects and stable error registry:
Pairing/discovery profile, origin, and transfer policy:
Invitation / idle / absolute elapsed deadlines:
Transport secret owner:
BRSP pairing secret owner:
Transport adapter and pinned source/hash/license:
WebView or native WebRTC boundary:
Android permissions / FGS type / local Stop surface:
Spatial pause and shutdown behavior:
Reliable queue / ingress queue / rate limits:
State heartbeat / stale threshold / reconnect policy:
Log and screenshot redaction policy:
Host tests and APK inspection:
Quest / phone / H10 / route / latency evidence rows:
Offline-LAN requirement and separate adapter owner:
```

The transfer rule is simple: the browser requests a small, versioned application
meaning; the native Quest target proves who may request it, decides whether it
is currently safe and available, applies it through normal app logic, and
returns the authoritative result.
