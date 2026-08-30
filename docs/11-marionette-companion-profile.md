# 11 — Marionette smartphone companion profile

## Purpose

The Marionette profile turns a smartphone browser into a fast, explicit companion controller for a primary browser application. It is an application profile built on BRSP/1; it does not introduce arbitrary remote desktop access.

Typical arrangement:

```text
Desktop / TV / tablet target                   Smartphone companion
----------------------------                   --------------------
owns authoritative app state                   owns local touch UI
shows pairing invitation                       requests narrow scopes
announces data-only endpoint   <============>  views target endpoint
validates commands/intent                       sends buttons + live controls
returns applied + state                         renders confirmed status
```

One VDO.Ninja publisher/viewer peer connection is sufficient and duplex. The phone never needs to publish a second stream or request camera/microphone access merely to control the target.

## Profile identity

Recommended negotiated capability set:

```json
[
  "command-ack",
  "latest-intent",
  "latest-state",
  "marionette-controls-v1",
  "state-snapshot"
]
```

Recommended scopes are app-specific and narrow, for example:

```json
[
  "presentation.navigate",
  "presentation.pointer",
  "player.transport",
  "scene.write"
]
```

Do not use one universal `remote-control` or `admin` scope if controls can be separated.

## Pairing UX

### Static/serverless development flow

1. Target user presses **Enable phone remote**.
2. Target generates a fresh random room/session ID and 192-bit pairing secret.
3. Target starts the data-only VDO endpoint and shows:
   - app/origin identity;
   - “phone controller” role;
   - requested/grantable scope summary;
   - expiry/Stop statement;
   - room and secret for manual transfer, or a QR invitation.
4. Phone opens the companion URL, receives/pastes the session material, but still shows an explicit **Connect** action.
5. Both run BRSP hello/proof/ready.
6. Target shows the authenticated phone and accepted scopes. Phone shows the authenticated target and actual route.

A QR code can encode a URL fragment because fragments are not sent in the HTTP request, for example:

```text
https://target.example/companion/#room=<id>&secret=<bearer-secret>
```

This remains a bearer secret. It can leak through screenshots, copied chat, browser history, extensions, backups, or shoulder surfing. Parse it only after origin verification, remove it from the visible address/history where feasible, keep it in memory, require Connect, expire it, and never put it in a query parameter. For higher assurance, use a one-time opaque invitation resolved through an authenticated backend instead of embedding the long secret.

For a native Quest target whose VDO adapter runs in a lower-trust packaged
WebView, use independent VDO and BRSP secrets. The invitation fragment then has
exactly four values:

```text
#room=<vdo-room>&session=<brsp-session>&transportSecret=<vdo-password>&pairingSecret=<brsp-proof-key>
```

The target WebView receives only `room` and `transportSecret`; the Kotlin BRSP
core receives only `session` and `pairingSecret`; the controller needs all four.
The QR must not contain a controller epoch, nonce, sender ID, requested scope,
or action. The controller generates its freshness identity locally. See
[16 — Native Meta Quest target](16-native-meta-quest-integration.md).
The target still emits its BRSP hello immediately after lane opening; local
approval withholds target proof/ready and application authority, not the hello.
Its locally grantable set is fixed before the lanes open. The headset displays
the independently computed request/grant intersection; narrowing that set at
approval time closes the handshake and requires a new invitation.

### Production flow

Prefer:

- target/device enrollment;
- signed one-time invitation with short expiry;
- account or device-bound authorization;
- target-side Accept for requested scopes;
- backend revocation/audit;
- high-entropy session key delivered after invitation validation;
- QR that contains no reusable long-term credential;
- explicit list/revoke of connected controllers.

The BRSP HMAC handshake remains useful for channel binding/session confirmation, but it does not replace product identity.

## Target control manifest

The phone should not guess which controls exist. The target's reliable snapshot SHOULD include a validated Marionette manifest:

```json
{
  "profile": "brsp-marionette-controls",
  "version": 1,
  "title": "Presentation remote",
  "controls": [
    {
      "id": "next",
      "kind": "command-button",
      "scope": "presentation.navigate",
      "action": "next",
      "label": "Next slide"
    },
    {
      "id": "pointer",
      "kind": "joystick-2d",
      "scope": "presentation.pointer",
      "label": "Pointer",
      "minimum": -1,
      "maximum": 1,
      "deadZone": 0.08,
      "expiry": "neutral",
      "leaseMs": 500
    },
    {
      "id": "volume",
      "kind": "absolute-slider",
      "scope": "player.transport",
      "label": "Volume",
      "minimum": 0,
      "maximum": 1,
      "step": 0.01,
      "expiry": "hold"
    }
  ]
}
```

The manifest is descriptive data, not executable UI code. The companion supports a fixed allow-list of control kinds and validates every field. Unknown kinds are ignored and displayed as unsupported. Labels are rendered as text, never HTML.

A closed native profile SHOULD also publish a canonical SHA-256 hash of the
complete manifest in sanitized state. The companion requests the full manifest
reliably after `ready`, compares both exact canonical content and expected hash,
and keeps mutation controls disabled until the current session matches. Status
and capability requests may remain available so version skew is diagnosable.
Reset manifest confirmation on Stop, peer replacement, or reconnect.

Recommended version-1 kinds:

- `command-button`
- `toggle-command`
- `momentary-button`
- `absolute-slider`
- `scrubber`
- `joystick-1d`
- `joystick-2d`
- `choice-command`
- `status` (read-only)

Application-specific hand-designed phone layouts MAY replace generated controls, but they still use the same scopes and message patterns.

## Two input paths

### Discrete reliable actions

Use BRSP `command` for actions where an edge matters:

```json
{
  "commandId": "cmd_...",
  "scope": "presentation.navigate",
  "action": "next",
  "args": {},
  "expectedRevision": 18
}
```

Phone UI behavior:

1. keep the button available only when authenticated and scope-granted;
2. on activation, send once and show pending;
3. prevent accidental rapid repeats or apply the manifest's rate limit;
4. clear pending only on matching `applied`;
5. render success/failure and returned target state;
6. make retry safe through command ID dedupe/idempotency.

Examples: next/previous, reset, submit, start/stop, choose item.

### Fast replaceable controls

Use BRSP `intent` for current controls where newest value replaces older values:

```json
{
  "scope": "presentation.pointer",
  "controls": {
    "pointer": { "x": 0.63, "y": -0.22, "active": true }
  }
}
```

The phone aggregates all controls for one scope/profile into a complete current intent frame. It does not send raw `pointermove` events, client pixels, event timestamps, DOM targets, or touch trajectories.

Examples: joystick, absolute slider, pointer position, jog/shuttle, color/parameter pad.

The target returns authoritative `state`; that returned state drives the shared display and confirmed phone readback.

## Fast-control scheduler

### Changed intent

- Collect Pointer Events with pointer capture.
- Normalize to the manifest range.
- Apply dead zone/curve locally if the manifest defines them.
- Coalesce with `requestAnimationFrame` or an ideal-deadline limiter.
- Send no faster than 60 Hz; many controls are adequate at 30 Hz.
- Package the complete current intent, not one message per raw browser event.
- If `bufferedAmount > 0`, replace the pending intent rather than queueing.

### Heartbeat

While a momentary/leased control is owned, repeat current intent every 100 ms even if unchanged. This repairs a lost final value and renews the target lease.

### Release

On pointer up/cancel, send a neutral inactive intent immediately. Because that frame can be lost, continue neutral heartbeats briefly or rely on the target lease. `pagehide`, `visibilitychange`, and Stop MAY attempt a final release but are best-effort only.

The target's lease, not the phone's final event, is the safety boundary.

## Target lease/dead-man behavior

Every momentary control declares `expiry: "neutral"` and a bounded `leaseMs` (recommended 500 ms for the 100 ms profile). The target records receiver-local time only when a valid newer authenticated intent for that scope is accepted.

If the lease expires:

1. neutralize momentary controls through the same target reducer;
2. preserve persistent `expiry:"hold"` settings unless product policy says otherwise;
3. increment authoritative revision when state changes;
4. publish the resulting state;
5. show “phone control lost / neutralized” on both screens;
6. require fresh accepted intent to regain live control;
7. never execute a fallback command or unrelated local input silently.

This prevents a phone screen lock, Wi-Fi change, tab suspension, lost pointer-up, or dead battery from leaving a joystick/button stuck.

For higher-consequence motion, use a shorter qualified lease, independent local interlock, and a protocol specifically reviewed for the safety requirement; BRSP alone is insufficient.

## Joystick implementation

Use Pointer Events and pointer capture:

```js
pad.addEventListener("pointerdown", (event) => {
  pad.setPointerCapture(event.pointerId);
  activePointer = event.pointerId;
  updateJoystick(event);
});

pad.addEventListener("pointermove", (event) => {
  if (event.pointerId === activePointer) updateJoystick(event);
});

pad.addEventListener("pointerup", releaseJoystick);
pad.addEventListener("pointercancel", releaseJoystick);
```

Normalize around the pad center and clamp the radial vector. Apply a manifest-defined dead zone and curve:

```text
raw radius <= deadZone -> (0,0)
otherwise normalized radius = (raw - deadZone) / (1 - deadZone)
output radius = normalized radius ^ responseExponent
```

Send normalized finite X/Y in `[-1,1]`. The target clamps again. The target must not trust phone viewport geometry.

Provide keyboard/switch alternatives, a visible neutral center, sufficient touch target size, and optional handedness/layout stored only on the phone.

## Sliders and scrubbers

An absolute slider is replaceable intent and usually `expiry:"hold"`. A scrubber often has two semantic phases:

- high-rate preview position as intent;
- reliable `commit-seek` command on release if exact commitment matters.

This hybrid prevents a reliable queue of every intermediate position while guaranteeing one acknowledged final transaction.

Do not infer a final commit solely from absence of more intent; the phone may have disappeared.

## Momentary buttons

A momentary button such as push-to-talk or boost should be represented in the complete leased intent snapshot:

```json
{
  "controls": {
    "pressed": ["boost"]
  }
}
```

The next snapshot without `boost`, or lease expiry, releases it. Avoid independent unreliable “down” and “up” edges; losing “up” creates a stuck control.

If every activation must be counted exactly once, it is a reliable command button instead.

## Phone layout best practices

- Use a dedicated responsive companion route, not a squeezed desktop interface.
- Place high-frequency controls in comfortable thumb zones and let the user choose left/right handed layout locally.
- Use large labeled targets and avoid hover-only affordances.
- Set `touch-action` deliberately per control; do not block page scroll globally unless the full surface is a control.
- Use pointer capture so movement remains owned outside the initial element.
- Handle `pointercancel`, orientation change, resize, and browser chrome changes.
- Keep connection/auth/stale/lease state visible without consuming the whole screen.
- Provide a persistent Stop/Disconnect action separated from destructive app commands.
- Respect safe-area insets and dynamic viewport units.
- Support portrait and landscape intentionally.
- Respect `prefers-reduced-motion`; local haptics are optional and never proof of target application.
- Use text/shape in addition to color for pending, live, rejected, and disconnected states.
- Keep the screen awake only after a current user gesture and release Wake Lock on Stop; show when it is unavailable/lost.

## Phone-specific view camera

If the phone displays the same spatial scene but needs more overview, add a local-only camera:

- one pointer on empty scene space pans;
- two pointers pinch about their centroid;
- a bounded example zoom range is `0.5–1.6`;
- Reset returns to centered zoom `1`;
- render shared objects through the camera;
- invert the camera for local object hit testing/dragging;
- do not transmit, persist, record, or let the camera mutate target-authored scene state;
- desktop layouts need not expose it.

This is exactly the distinction between “everyone sees the same scene” and “every device must use the same viewport.” Shared world semantics remain equal while the phone changes perspective.

## Target-side reducer example

```js
function applyPhoneIntent({ scope, controls, sequence }) {
  if (scope !== "presentation.pointer") throw new Error("scope_denied");
  if (!exactPointerShape(controls.pointer)) throw new Error("invalid_argument");

  const pointer = {
    x: clampFinite(controls.pointer.x, -1, 1),
    y: clampFinite(controls.pointer.y, -1, 1),
    active: controls.pointer.active === true,
  };

  authoritativeState = {
    ...authoritativeState,
    revision: authoritativeState.revision + 1,
    pointer,
  };
  pointerLease.acceptedAt = performance.now();
  pointerLease.sequence = sequence;

  return {
    revision: authoritativeState.revision,
    state: authoritativeState,
  };
}
```

If application work is asynchronous, record the accepted sequence and verify it is still newest immediately before committing. An old async result must not overwrite newer intent.

## Multiple phones

BRSP/1's reference session is one controller/one target. Supporting multiple phones requires an explicit target policy:

- one active controller lease; others read-only;
- per-scope controller ownership;
- host-arranged merge of independent controls;
- priority with visible preemption;
- deterministic commutative combination for a narrow control;
- backend arbitration.

Never merge multiple controller intents by accidental arrival order. Show every connected controller and the active owner. Authenticate each connection independently and issue distinct controller IDs/epochs.

## Network and lifecycle behavior

The phone can switch Wi-Fi/cellular, lock, suspend the browser, enter battery saver, or lose foreground scheduling. Requirements:

- target lease neutralizes momentary controls;
- controller state becomes stale visibly after the application threshold;
- no automatic target switch after reconnect;
- new peer connection performs a new proof/ready/snapshot;
- late old-channel events are ignored;
- user can reconnect explicitly with a fresh/valid invitation;
- route can change after ICE recovery and should be re-observed;
- neither Wake Lock nor a PWA install guarantees background execution.

Consider a native companion or backend-mediated push/session service if reliable background control is a product requirement.

## Optional device sensors

Device orientation, motion, microphone, camera, location, and haptics are separate permissions and privacy boundaries. Do not request them for ordinary controls.

If an app explicitly needs tilt control:

- require a separate current gesture and platform permission;
- explain use;
- sample/cap locally;
- transmit normalized derived intent, not raw sensor history;
- add manifest kind/scope/capability;
- target validates and leases it;
- stop immediately on permission/session loss;
- qualify phone/browser behavior.

## Observability without surveillance

Phone and target should show:

- role and target label;
- transport connecting/open/closed;
- BRSP authenticating/ready/error;
- accepted scopes;
- direct/relay/unknown route and approximate RTT when available;
- last applied command status;
- live intent active/lease remaining or expired;
- authoritative state live/stale/holding/recovering;
- foreground/Wake Lock condition where relevant.

Keep logs bounded and session-local by default. Do not log every high-rate intent, raw touches, secret, full invitation, IP, or private app state.

## Marionette acceptance matrix

Test at least:

### Pairing and security

- no network on page load;
- fresh Start/Connect required after reload;
- correct secret succeeds; wrong secret fails before controls enable;
- same room with impostor label cannot pass proof;
- scope not granted remains disabled and rejected;
- invitation/secret absent from logs, query string, analytics, screenshots used as evidence;
- Stop closes both lanes and neutralizes leased controls.

### Fast controls

- 30/60 Hz changing joystick without reliable backlog;
- injected `bufferedAmount` retains newest intent only;
- lost final release is repaired by heartbeat or target lease;
- target neutralizes after lease expiry;
- persistent slider holds according to manifest;
- scrub preview does not create reliable history; commit is acknowledged;
- out-of-range/non-finite/malformed intent rejected;
- old/wrapped/duplicate sequence ignored;
- async reducer cannot overwrite a newer sequence.

### Phone interaction

- portrait and landscape;
- small/large phones and safe-area insets;
- touch, stylus, keyboard/switch alternative;
- pointer leaves control, pointer cancel, two-finger browser gesture conflict;
- orientation/resize while controlling;
- reduced motion, screen reader names/status, contrast, large text;
- phone-only scene pan/pinch/Reset does not change wire/shared coordinates.

### Network/lifecycle

- same-LAN direct and forced relay with route readback at both endpoints;
- Wi-Fi→cellular/network interruption;
- phone hidden, screen locked, app switched, Wake Lock lost;
- target close/restart and explicit reconnect;
- stale hold/recovery hysteresis;
- delayed signaling disconnect after local producers are quiesced;
- no late old-channel event affects the new session.

Record exact commit, SDK hashes, target/phone browsers/OS/devices, route, RTT/gaps, duration, input fixture, and open gates. Simulator/responsive-mode UI evidence does not replace a physical phone receipt.

## Reference demo mapping

The repository's [`two-browser-demo`](../examples/two-browser-demo/index.html) is responsive and can be opened on a phone. It demonstrates:

- explicit target/controller roles;
- generated room and 192-bit secret;
- VDO data-only connection;
- mutual BRSP proof and scope negotiation;
- slider scene updates through `latest-intent`;
- reliable acknowledged Reset command;
- returned target-owned scene/revision;
- direct/relay diagnostic badge;
- state heartbeat, stale hold, and three-frame recovery;
- bounded session log and complete Stop.

It is intentionally generic. A production app should replace its controls with a validated target manifest or a purpose-designed companion layout and implement target leases for momentary controls.

## Copyable application seam

The [`application-integration` starter](../examples/application-integration/README.md) supplies the missing application boundary without claiming to be a general generated-control SDK. Its hand-written scene profile demonstrates:

- inert construction and explicit Start/Stop;
- a fixed deep-frozen non-executable manifest plus exact state/command/intent validators;
- separate `scene.command` and `scene.intent` scopes;
- reliable `reset`, `set-pulse`, and `stop-pointer` commands;
- one complete current pointer plus persistent hue intent;
- a target-local 500 ms pointer lease;
- persistent hue hold without idle heartbeat/revision churn;
- returned authoritative state kept separate from desired controller controls;
- producer-first idempotent teardown;
- deterministic protocol/application tests.

Read [12 — Copyable application integration recipes](12-app-integration-recipes.md) for browser wiring. A Tauri or other native-shell target uses the same profile in its bundled WebView and crosses into native authority only through typed, revalidated product IPC; see [13 — Native-shell WebView integration](13-native-shell-webview-integration.md).

The current evidence boundary is recorded in [15](15-qualification-record.md). The browser smoke fixture is deterministic in-process evidence, not public VDO, physical-phone, or packaged native-shell evidence.
