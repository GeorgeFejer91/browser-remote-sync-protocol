# 09 — Production roadmap

## Roadmap principles

BRSP/1 is deliberately a narrow semantic remote-control protocol, not a remote desktop or universal administration channel. Roadmap work must preserve these invariants:

- explicit user activation and visible Stop;
- no media capture for data-only control;
- typed allow-listed application meaning, never arbitrary code/DOM/input injection;
- target authority and returned-state convergence;
- mutual session proof before application data;
- least-privilege negotiated scopes;
- reliable transactions separated from replaceable live intent/state;
- bounded bytes, rate, queues, participants, logs, and retry work;
- receiver-local freshness and target-enforced leases;
- transport diagnostics are not identity/security claims;
- no automatic ownership switch after reconnect.

The phases below are capability gates, not calendar promises.

## Phase 0 — Reference baseline

Status: implemented in this repository.

Deliverables:

- normative BRSP/1 JSON envelope, handshake, scopes, sequencing, and lane rules;
- transport-neutral JavaScript controller/target implementation;
- data-only VDO.Ninja adapter using one duplex peer connection;
- reliable command/acknowledgement and snapshot flow;
- replaceable controller intent and target state with newest-only backpressure;
- responsive two-browser demo;
- copyable transport-neutral application seam with exact Marionette reducer validation, target lease, persistent-control hold, and producer-first lifecycle;
- Marionette smartphone profile and application threat model;
- native-shell/WebView integration and deployment/CSP/network-inventory guides;
- automated protocol, adapter, application-seam, and vendored-file hash checks;
- deterministic real-browser ES-module/Web-Crypto smoke fixture and an evidence-tier/current-status record.

Exit evidence is limited to the checks actually recorded in [15 — Qualification tiers and current record](15-qualification-record.md). This phase does not supply accounts, revocation, a production signaling service, a packaged native-shell companion SDK, physical-device qualification, or a remotely safe universal browser controller.

## Phase 1 — Interoperability and protocol hardening

Deliverables:

1. Publish versioned canonical JSON and HMAC byte fixtures.
2. Add a second independent implementation, preferably TypeScript plus one non-JavaScript runtime.
3. Create a machine-readable conformance corpus for every message and boundary.
4. Add fuzz/property tests for parsing, envelope validation, sequencing, reducer schemas, and state-machine transitions.
5. Define a formal error registry and compatibility rules for optional fields/capabilities.
6. Specify command acknowledgement timeouts, reconnect retry IDs, and dedupe retention.
7. Model the handshake/session state machine and test every unexpected message in every state.
8. Obtain focused cryptographic/protocol review of transcript construction and secret handling.

Exit gate:

- two implementations pass the identical corpus and real two-browser sessions;
- no known ambiguity in canonical bytes, role ordering, scope intersection, lane direction, or reconnect epoch behavior;
- security review findings are resolved or explicitly accepted.

## Phase 2 — Marionette companion SDK

Deliverables:

1. Define a JSON Schema for the non-executable control manifest.
2. Implement fixed allow-listed UI kinds: command buttons, toggles, sliders, scrubbers, joysticks, choices, and status.
3. Add target leases/dead-man neutralization for momentary controls.
4. Add deterministic input coalescing, intent heartbeat, release burst, and async reducer guards.
5. Ship reusable target and companion packages with lifecycle hooks.
6. Add a QR invitation component that keeps bearer material out of query parameters and removes fragment material after parsing.
7. Add installable PWA metadata only after offline/update behavior is designed; installation must not imply background reliability.
8. Implement accessible, responsive portrait/landscape layouts and phone-local handedness preferences.
9. Implement the phone-only spatial camera (pan/pinch/Reset) as a local projection, with wire-invariance tests.
10. Add direct/relay/unknown route, RTT, stale, lease, and command status components.

Exit gate:

- supported iOS and Android physical-device matrix passes;
- lost release, screen lock, app switch, network transition, and target restart fixtures pass;
- no momentary control remains active beyond the qualified target lease;
- accessibility acceptance passes for every generated control kind.

The phase-0 application starter proves one hand-written scene profile and lease with deterministic tests. It does not complete this phase's general schema, generated-control library, packages, PWA/invitation component, or physical mobile matrix.

## Phase 3 — Production identity, invitations, and policy

The direct pre-shared secret is acceptable for a controlled reference flow but not a full identity system.

Deliverables:

1. Account/device enrollment and explicit target-side controller approval.
2. Single-use signed invitation with short expiry and replay prevention.
3. Exchange a fresh session key after invitation validation; QR contains no reusable long-term credential.
4. Connected-controller inventory, human-readable device labels, scope approval, and immediate revocation.
5. Policy engine for per-app, per-device, and per-scope grants.
6. Session expiry, reauthentication, key rotation, and server-side revocation propagation.
7. Privacy-preserving audit events for connect, grant, command class, revoke, and failure—never high-rate raw intent or secrets.
8. Origin binding and deployment-specific CSP, trusted-script, analytics, storage, and clipboard policy.
9. Rate limits and abuse detection at invitation, signaling, connection, and application layers.

Exit gate:

- threat model reviewed against the real identity/signaling/backend deployment;
- lost/stolen controller revocation is tested end to end;
- invitation replay/expiry/scope escalation tests pass;
- product privacy notice and retention policy match observed data flows.

## Phase 4 — Transport adapter suite

BRSP should remain stable while adapters explicitly document different guarantees.

### Managed VDO.Ninja adapter

- track SDK/API changes and pin audited releases;
- qualify direct and TURN routes on the support matrix;
- expose candidate-pair quality without logging peer addresses;
- define service availability, terms/privacy review, and fallback behavior.

### Application WebSocket adapter

- authenticate the browser-to-server connection using the product identity layer;
- frame one BRSP message per WebSocket message;
- emulate replaceable intent/state before bytes enter the reliable socket queue;
- provide server fan-out, arbitration, revocation, audit, and observability;
- document that already queued reliable bytes cannot become unreliable.

### Self-hosted raw WebRTC adapter

- operate authenticated signaling, ICE configuration, TURN credentials, and abuse controls;
- negotiate equivalent ordered reliable and unordered zero-retry data channels;
- bind signaling identity to BRSP authorization instead of trusting stream names;
- publish operational guidance for TURN capacity, credential rotation, and network failures.

### WebTransport adapter

- use server-mediated sessions; WebTransport is not browser-to-browser discovery;
- map control to reliable framed streams and live values to datagrams or application-coalesced streams;
- add framing because reliable streams are byte streams, not BRSP message frames;
- feature-detect, qualify browser support, and retain WebSocket fallback where required.

Exit gate:

- an adapter contract test suite proves activation, delivery semantics, backpressure, close, reconnect, diagnostics, and message framing;
- each adapter publishes its infrastructure, privacy, route, and failure assumptions;
- at least two adapters interoperate at the application profile level.

## Phase 5 — Multi-controller and shared-scene profiles

Deliverables:

1. Explicit one-controller lease with visible transfer/preemption.
2. Optional per-scope ownership so two controllers cannot race a control accidentally.
3. Authoritative host aggregate scene with version, stable participant IDs/order, bounded roster, and identical fan-out.
4. Deterministic merge functions only for profiles with mathematically valid commutative combination.
5. Separate upstream intent from returned authoritative display to eliminate feedback loops.
6. Presence, leave, timeout, restart, and ghost-listing cleanup semantics.
7. Per-controller authentication, scopes, epochs, rate limits, and revocation.
8. Scale/capacity qualification at the declared maximum—not an unbounded mesh.

Exit gate:

- every multi-controller conflict resolves by documented policy rather than packet arrival accident;
- all peers render the same authoritative scene semantics;
- a controller cannot impersonate host authority or derive other controllers' permissions.

## Phase 6 — Operations, privacy, and resilience

Deliverables:

- bounded metrics for handshake duration, route, RTT, command latency, state gap, stale transitions, queue pressure, reconnects, and errors;
- redaction tests preventing secret, proof, invitation, IP, raw touch trajectory, and private state logging;
- reliability objectives and failure budgets per adapter/profile;
- chaos fixtures for signaling outage, TURN outage/capacity, network migration, packet loss, reordering, and browser suspension;
- dependency update and vendored hash/review workflow;
- incident response, service status, backward compatibility, and protocol deprecation process;
- data inventory, retention/deletion controls, privacy review, and jurisdiction/service-provider assessment;
- independent application/protocol penetration testing.

Exit gate:

- operational dashboards distinguish application rejection, authentication failure, transport failure, stale state, and intentional coalescing;
- on-call/runbook and rollback procedures are exercised;
- no observability requirement expands collection beyond the product privacy contract.

## Phase 7 — Stable release

Potential `1.0` exit criteria:

- frozen BRSP/1 specification plus exhaustive public conformance corpus;
- independently interoperable implementations;
- versioned packages with semantic release and migration policy;
- at least one production identity/invitation profile;
- at least two qualified transport adapters;
- physical mobile and desktop support matrix;
- published security assessment and resolved high-severity findings;
- complete licensing/provenance and reproducible dependency artifacts;
- clearly owned maintenance and vulnerability response.

`1.0` should describe evidence, not aspiration. Missing production identity or physical-device qualification is a release gate, not a footnote.

## Explicitly deferred or rejected

- Arbitrary remote DOM selectors, synthetic browser events, code evaluation, shell/file commands, or unrestricted URL navigation.
- Pixel/video remote desktop. Use an established remote-desktop architecture for that requirement.
- Safety-critical or hazardous machinery control without a domain-specific independently reviewed safety system.
- Silent auto-connect or automatic reassignment to whichever target appears first.
- Short human PIN as the sole direct HMAC secret without a rate-limited password-authenticated/key-exchange design.
- Background reliability claims based only on Wake Lock, PWA installation, or a foreground JavaScript timer.
- Unbounded peer mesh, logs, pending transactions, payloads, or participant counts.

## Suggested first production slice

The smallest defensible product is one target, one explicitly approved phone, three or fewer narrow scopes, reliable buttons plus one leased joystick/slider profile, a backend one-time invitation, VDO data-only or existing authenticated WebSocket transport, visible route/stale/lease state, and a published physical-device qualification matrix. Expand only after that slice meets its gates.

Use [12 — Application integration recipes](12-app-integration-recipes.md) for the application seam, [13 — Native-shell WebView integration](13-native-shell-webview-integration.md) for a desktop target, and [14 — Deployment/network/CSP](14-deployment-network-and-csp.md) before choosing infrastructure. The current evidence and untested gates remain explicit in [15](15-qualification-record.md).
