# 15 — Qualification tiers and current record

This document states what has actually been exercised for the current BRSP repository and what remains open. A passing protocol test is not a physical-phone result; a responsive viewport is not iOS/Android lifecycle evidence; `forceTURN: true` is not an observed relay route; and an architecture case study is not BRSP conformance.

Runnable browser artifacts live under [`qualification/`](../qualification/README.md).

## Evidence tiers

| Tier | Evidence | What it can support | What it cannot support |
| ---: | --- | --- | --- |
| 0 | Static repository/contract checks | Required files, local links, pinned hashes, forbidden media/private signaling patterns | Runtime protocol behavior |
| 1 | Node protocol/application tests with deterministic adapters | Codec/state machine, proof, scopes, reducers, sequencing, backpressure, leases, teardown logic | Browser/WebCrypto integration, VDO service, physical UI |
| 2 | Real browser modules with deterministic in-process transport | Browser ES modules/Web Crypto, controller/target handshake and UI viewport behavior | Signaling, ICE, direct/TURN route, radio/OS lifecycle |
| 3 | Attended two-browser VDO run on one machine | Pinned SDK signaling/data-only interoperability and observed route for that environment | Physical device, radio transition, native WebView |
| 4 | Attended physical browser devices | Touch/layout/browser lifecycle and real network route for named devices | Native desktop IPC/WebView behavior unless one endpoint is the app |
| 5 | Packaged native target plus external physical browser | Actual desktop WebView or Quest APK, CSP/bridge, native authority, lifecycle, named phone/browser | Other operating systems, devices, networks, sensors, or release channels |
| 6 | Published product support matrix | Exact supported combinations and operational acceptance | Unlisted combinations |

Every result records the lowest tier that directly exercises the claim. A higher tier supplements rather than erases deterministic lower-tier tests.

## Current BRSP candidate receipt — 2026-08-30

### Identity and environment

| Field | Value |
| --- | --- |
| Repository | `GeorgeFejer91/browser-remote-sync-protocol` |
| Protocol | BRSP/1, pre-1.0 reference |
| Candidate lineage | Base commit `17b5cdb` plus the application-integration, qualification, core-hardening, and documentation update represented by the repository tree containing this receipt |
| Host used for local deterministic checks | Windows, Europe/Berlin operator environment |
| Runtime | Node.js `v24.19.0`, npm `11.17.0` |
| VDO SDK | Vendored `v1.5.5`; hashes enforced by repository checker |
| Media | No requested audio/video in reference adapter; repository check rejects capture APIs |

The final publication commit and its GitHub Actions run are the immutable identifiers for the pushed tree. This local receipt does not pre-claim that future CI result.

### Deterministic repository evidence

The candidate was checked with:

```sh
npm run check
```

Recorded local result on 2026-08-30: `npm run check` **passed** the repository contract/hash/link checks and all **41/41** Node tests, with zero failures, skips, cancellations, or todos. `npm run check` invokes `node --test`, so this receipt does not pretend a redundant separately captured `npm test` run occurred.

The suite covers, at minimum:

- canonical bounded plain JSON and rejection of custom prototypes, object/array accessors, sparse or decorated arrays, non-finite values, and other malformed input;
- unsigned sequence ordering and wraparound;
- role-bound mutual HMAC proof and failure with the wrong secret;
- exact scope/capability intersection;
- command application, revision conflict, dedupe with a fresh ordered `applied` envelope, and target-returned state;
- authoritative freshness starting at ready and remaining evaluable after disconnect;
- latest-intent and newest-only state backpressure;
- explicit multi-target selection, SDK UUID binding, retryable selection failure, and rejection of initial reliable-send failure;
- Stop-wins lifecycle races, complete failed-start cleanup, and inert stale SDK completions/callbacks;
- inert application wrapper construction, exact app reducer validation, rejection of an immortal initially-active lease, momentary lease expiry, persistent hold, and producer-first teardown;
- synchronous demo pairing-material clearing and fresh values on restart;
- pinned SDK hashes, local links, no media capture, and no direct private signaling WebSocket use;
- native Meta Quest integration fragments: byte-stable manifest/profile,
  headset-only exclusion, manifest/hash mutation gate, privacy-safe projection,
  inert/generation-fenced transport lifecycle, explicit peer-close revocation,
  reliable backpressure fail-close, producer-first Stop, and static
  Kotlin/Android authority boundaries.

The final CI run for the publication commit remains the immutable remote confirmation. The local 41/41 result applies to this candidate tree and must not be copied forward after code, tests, pinned SDK, application profile, or native integration fragment changes.

### Browser smoke evidence

On 2026-08-30, [`qualification/browser-smoke.html`](../qualification/browser-smoke.html) was served locally and exercised in the in-app browser at a `390 × 844` smartphone viewport.

Observed result: **PASS, tier 2**.

Directly exercised:

- the repository's real ES modules and Web Crypto implementation;
- controller/target hello, mutual proof, and ready;
- least-authority accepted scope;
- reliable semantic command and matching application acknowledgement;
- replaceable live intent;
- authoritative target-returned state on the controller;
- target-local authoritative state;
- idempotent teardown;
- no console warnings or errors during the attended fixture;
- no horizontal overflow in the inspected smartphone viewport.

This fixture uses a deterministic in-process transport. It opened no VDO signaling or peer connection. It is not evidence of direct WebRTC, TURN, same-Wi-Fi behavior, physical touch, iOS/Android suspension, or a desktop WebView.

### Current open BRSP gates

| Gate | Status | Evidence needed |
| --- | --- | --- |
| Two-browser public VDO.Ninja session for this candidate | Not recorded in this receipt | Attended target/controller run with exact browsers, duration, console, command/state result |
| Direct route | Not tested | Candidate-pair/SDK quality readback from both endpoints |
| Forced TURN route | Not tested | `forceTURN` requested at both endpoints plus independent `relay` readback from both |
| Physical Android/Chromium phone | Not tested | Named device/OS/browser, portrait/landscape, touch, app switch/lock, Wi-Fi transition |
| Physical iOS/WebKit phone | Not tested | Named device/OS/browser and equivalent lifecycle matrix |
| Packaged Tauri target plus external phone browser | Not tested | Tier-5 packaged-app session with CSP/capability/IPC and window lifecycle evidence |
| Offline private LAN adapter | Not implemented/qualified | Owned adapter/infrastructure and a separate network/security record |
| Production identity/invitation/revocation | Not implemented | Backend identity/policy profile and security review |
| Multi-controller BRSP arbitration | Not implemented | Explicit lease/ownership profile and conflict fixtures |

## Native Meta Quest transfer pilot — host-built boundary

The independent **Polar Remote Quest** pilot informed
[16 — Native Meta Quest target and browser companion](16-native-meta-quest-integration.md).
Its bounded status for this protocol record is **host-built pilot**, not an
accepted tier-5 device result.

The architecture includes a pure Kotlin BRSP target, native Spatial panel,
closed capability manifest, separate VDO/BRSP secrets, controller-owned epoch,
headset-local scope acceptance, packaged transport-only WebView, Android
notification Stop surface, and Chromium companion. Whether that surface is an
ordinary notification or an FGS backed by qualifying service-owned work remains
an explicit Android gate. Those design facts do not
substitute for an immutable end-to-end receipt.

| Native Quest gate | Current record status | Required evidence |
| --- | --- | --- |
| Final public pilot commit and APK identity | Not recorded here | Clean commit, build inputs, APK SHA-256, signer, manifest/native-library/asset inspection |
| Visible physical Quest command | Not recorded | Exact APK installed on exact Quest; controller proof, action ID, applied revision, sanitized state, native marker, visible effect |
| Physical Android phone | Not tested | Named device/OS/Chrome, QR/Connect/Accept, portrait/landscape, lock/app-switch/network matrix |
| VDO direct or relay route | Not tested | Independent selected-route/RTT readback at both endpoints |
| Worn Polar H10 ECG | Not tested | Local Bluetooth permission, worn/wet/awake H10, connection, 130 Hz ECG mode, increasing real samples, remote start/stop |
| Handshake/lifecycle/Android service conformance | Not accepted | Immediate hello with proof/ready withheld pending local Accept; Android plus VR/OpenXR interactivity; no deferred mutation; peer loss; `onSpatialShutdown`/destroy/process fail-close; FGS type backed by actual service-owned work or removed |
| Command latency | Not measured for acceptance | Controller command-to-`applied` p50/p95/p99 bound to exact route/network/build |
| Offline LAN | Not implemented/qualified | Owned adapter and WAN-disconnected physical browser/Quest receipt |

Do not promote install/launch/process evidence into the visible-command row.
Do not promote same-Wi-Fi VDO into offline LAN. Add a new immutable receipt when
the exact candidate passes rather than editing these `not tested` cells into
assumptions.

## Affect Tracker desktop/browser Party case study

Commit [`9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb`](https://github.com/GeorgeFejer91/affect-tracker-web/tree/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb) is the current transfer case study.

Recorded implementation/evidence supplied by that project:

- desktop host with smartphone browser guest;
- smartphone browser host with desktop guest;
- host-authored bounded Party roster/scene fan-out through existing duplex connections;
- the same semantic scene fields sent to connected participants;
- desktop returned aggregate used for WebView presentation only, with no Rust/LSL mutation;
- smartphone-only local camera remains presentation state;
- 217/217 project tests passed and the named commit's CI passed.

Qualification boundary:

- no physical smartphone↔Tauri session was recorded for that commit;
- it uses an experimental public discovery room and `password:false`;
- it does not implement BRSP's role-bound mutual proof or negotiated scopes;
- it is not BRSP conformance evidence and must not be used as a secure-controller default;
- “same scene” means shared semantic roster/state/visual parameters, not pixel identity across unequal viewports.

Use the case study for topology, host authority/fan-out, feedback-loop separation, CSP, desktop presentation isolation, and accessibility projection. Use BRSP or a product identity layer for generalized authentication and authorization.

## How to record an attended VDO run

### Setup

1. Checkout a clean exact commit and record `git rev-parse HEAD` plus `git status --short`.
2. Run `npm run check` and record the result.
3. Start `npm run serve` and open two fresh browser profiles/windows.
4. Confirm no signaling before Start and no camera/microphone prompt.
5. Start the target, transfer room/secret out of band, then Start the controller.
6. Record browser/OS/device, network, SDK hashes, and whether each endpoint requested TURN.

### Happy and negative paths

- reach mutual ready and verify accepted scopes;
- send live intent and confirm both displays derive from target-returned state;
- send a reliable command and wait for matching `applied`;
- test the right room with a wrong secret and verify controls never enable;
- if multiple matching targets are advertised, verify explicit target selection and selected UUID binding;
- interrupt target state, verify hold/stale/recovery, then replace the connection and require a new handshake/snapshot;
- Stop during delayed signaling cleanup and verify no producer continues emitting.

### Route evidence

Record route at both endpoints independently:

```text
forceTURN requested: target yes/no, controller yes/no
observed target route: direct/relay/unknown, RTT
observed controller route: direct/relay/unknown, RTT
```

Only label a forced-relay row **pass** when both endpoints report `relay`. A request checkbox or one endpoint's status is insufficient.

## Physical phone/native-shell additions

For a physical phone, add:

- model, OS, browser engine/version;
- portrait, landscape, rotation, safe-area, dynamic viewport, large text, reduced motion, and screen-reader status;
- pointer capture/cancel, edge gestures, pinch/pan/Reset invariance, and keyboard/switch alternative where supported;
- app switch, lock/unlock, Wake Lock loss, battery saver, Wi-Fi loss/return, and Wi-Fi↔cellular transition;
- lost release and target-enforced neutral lease timing.

For a native shell, also add:

- exact Tauri/Electron version, OS, system WebView version, development versus packaged build;
- CSP actually shipped and any violations;
- complete capability union for the participating window label;
- typed IPC success, malformed, denied, revision conflict, and shutdown paths;
- window close/hide/reopen, app quit, sleep/wake, and update/restart behavior;
- proof that presentation-only remote scene data did not mutate privileged native state.

For a native Meta Quest target, additionally record:

- exact Quest model/Horizon OS, Meta Spatial SDK, Android target SDK, system
  WebView, package, signer, and APK SHA-256;
- headset-local notification/Bluetooth/pairing permission and scope approval;
- Activity resume/pause plus VR/OpenXR ready/focus and declared HMD policy,
  `onSpatialShutdown`, destroy/recreate, process death, local Stop, and
  controller peer-loss behavior;
- proof that target/controller hellos obey BRSP timing while target proof/ready
  remain blocked until local Accept;
- foreground-service type mapped to actual service-owned work, or evidence that
  the notification-only design uses no FGS;
- the exact remotely eligible/headset-only capability manifest and hash;
- proof that the WebView bridge has no action/native-method surface and that
  packaged VDO/BRSP bytes match their pins;
- visible scene/panel effect plus native applied marker;
- sensor readiness/sample evidence only when claiming a real hardware path.

Playwright responsive/WebKit simulation remains browser evidence, not WKWebView/Tauri or physical iOS evidence.

## Record template

Copy this block into an immutable qualification artifact:

```text
Date/operator:
Repository commit and clean state:
Protocol/profile/capabilities/scopes:
SDK/adapter hashes:
Target device/OS/browser-or-WebView:
Controller device/OS/browser:
Network and impairment:
TURN requested at each endpoint:
Observed route and RTT at each endpoint:
Duration and input fixture:
Command/ack result:
Intent/state rate, gaps, stale/recovery:
Backpressure/coalescing counters:
Lifecycle cases:
Accessibility/layout cases:
Console/native errors:
Raw artifact location:
Result: pass / conditional / fail / not tested
Caveats and open gates:
```

Do not edit an old result into a new claim. Add a new record for a new commit, SDK, browser, device, route, or materially changed profile.
