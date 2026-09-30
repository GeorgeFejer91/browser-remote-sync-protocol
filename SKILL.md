---
name: browser-remote-sync-protocol
description: Design, integrate, review, test, or qualify BRSP/1 semantic remote control between a target application and a browser or smartphone companion. Use for typed remote commands, live intent/state synchronization, VDO.Ninja data-only WebRTC, native BRSP adapters, Marionette controls, pairing, scopes, leases, reconnects, or same-Wi-Fi controller workflows. Do not use for remote desktop, arbitrary DOM/input injection, or general shell/file administration.
---

# Browser Remote Sync Protocol

Use BRSP as a versioned application contract, not as a generic remote-access channel. Adapt the repository's contracts to the application while preserving target authority, explicit activation, mutual proof, least-authority scopes, bounded messages, separate reliable and replaceable lanes, freshness, teardown, and evidence discipline.

## Route the Work

Read the repository's `AGENTS.md` first when changing this repository. It requires every Markdown file in `docs/` to be read in lexical order before planning, editing, testing, or publishing the protocol itself.

For integration work in another application, read only the references needed:

- Read `docs/00-overview.md`, `docs/01-architecture.md`, and `docs/02-threat-model-and-privacy.md` before choosing authority, transport, or pairing.
- Read `docs/03-protocol-specification.md` for every wire implementation or interoperability claim.
- Read `docs/04-vdo-ninja-adapter.md` when using the pinned VDO.Ninja data-only WebRTC adapter.
- Read `docs/11-marionette-companion-profile.md` for smartphone controls, manifests, coalescing, target leases, lifecycle, and accessibility.
- Read `docs/12-app-integration-recipes.md` and `examples/application-integration/README.md` when adding BRSP to an application.
- Read `docs/13-native-shell-webview-integration.md` for Tauri or another privileged native shell.
- Read `docs/14-deployment-network-and-csp.md` before claiming same-Wi-Fi, direct, offline-LAN, CSP, or endpoint behavior.
- Read `docs/08-testing-and-qualification.md` and `docs/15-qualification-record.md` before testing or claiming completion.

## Integration Contract

1. Inventory exact remotely eligible outcomes and model them as bounded `(scope, action, args)` operations or complete replaceable intent. Never transmit JavaScript, selectors, DOM operations, global input, shell strings, arbitrary paths/URLs, credentials, or dynamic function names.
2. Keep one target-owned authoritative reducer. Local target UI and authenticated remote requests use the same domain operations, while each adapter performs its own authentication and authorization checks.
3. Keep `localIntent`, `authoritativeState`, and `presentationState` separate. Rendering returned state must not create new outbound intent.
4. Use reliable ordered control plus `applied` acknowledgements for discrete transitions. Use newest-only replaceable intent/state for joysticks, sliders, pointers, and other complete current values.
5. Give momentary controls a target-enforced receiver-local lease. A phone release packet is helpful but is not the safety boundary.
6. Require explicit Start/Connect, fresh per-session material, mutual role-bound proof, negotiated scopes, visible status, and complete producer-first Stop. A room, stream label, peer UUID, or connected transport is not identity.
7. Bound bytes, shapes, rates, queues, revisions, dedupe, epochs, sequences, participants, logs, and retries. Preserve the protocol's canonical JSON and HMAC test vectors across languages.
8. Publish target-returned state and snapshots so the controller renders confirmation rather than assuming a successful send changed the app.

## Native and Quest Targets

A native target may implement the BRSP envelopes over a native WebRTC or authenticated WebSocket adapter, but it must reproduce the normative canonical JSON, role-bound HMAC, lane, sequencing, scope, and acknowledgement behavior exactly. Keep the immersive Android/OpenXR or Spatial SDK application as the sole frame and lifecycle owner. Route accepted actions into narrow typed native reducers; do not expose a remote shell or make a Tauri/WebView surface the immersive renderer merely to reuse browser code.

The supplied VDO.Ninja adapter is browser JavaScript and depends on Internet signaling/STUN/TURN even when two devices share Wi-Fi. Same-Wi-Fi may yield a direct WebRTC route, but it is not offline LAN discovery. For offline LAN control, design and qualify an owned authenticated signaling/raw-WebRTC or WSS adapter without changing BRSP application semantics.

## Verification

Start with the repository's actual scripts and fixtures. Preserve separate evidence tiers for deterministic protocol tests, real browser modules, public VDO signaling/routes, physical phones, and packaged native/Quest targets. A successful build, responsive viewport, configured `forceTURN`, or same-machine browser test does not prove physical-device behavior, relay routing, direct Wi-Fi, native integration, or protocol conformance.

Report the exact protocol/profile, commit, adapter, target/controller versions, observed route, command acknowledgement, live-state behavior, lifecycle cases, and every untested boundary.
