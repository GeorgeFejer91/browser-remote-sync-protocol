# 08 — Testing and qualification

## Why qualification is part of the protocol

A remote-control feature can appear correct while two tabs share one computer and still fail when the controller is a physical phone, a peer is TURN-relayed, a tab is backgrounded, or a data channel is congested. BRSP therefore separates four kinds of evidence:

1. deterministic protocol tests;
2. local browser behavior;
3. real network and lifecycle behavior;
4. application-specific safety and usability acceptance.

Passing one layer never implies that the other layers passed. Responsive device emulation is useful UI evidence, but it is not proof of mobile scheduling, radio changes, screen locking, or physical touch behavior.

The repository's numbered evidence tiers and current bounded claims are published in [15 — Qualification tiers and current record](15-qualification-record.md). Use those tier names when summarizing a result.

## Evidence record

Every qualification record SHOULD identify:

- repository commit and dirty/clean state;
- protocol version and negotiated capabilities;
- exact transport adapter and vendored SDK hashes;
- target and controller browser name/version, OS, and device;
- connection route as direct, TURN relay, or unknown;
- test network and any intentional impairment;
- wall-clock date, duration, and operator;
- inputs, expected outcome, observed outcome, and raw artifact location;
- failures, caveats, and untested gates.

Do not rewrite an inherited result as if it was measured against a new commit. The [source ledger](10-sources-and-provenance.md) marks which findings came from the Affect Tracker implementation and which checks were performed in this repository.

## Automated reference suite

Run:

```sh
npm test
npm run check
```

The Node test suite uses paired in-memory lanes so it can deterministically cover the application protocol without a network service. It verifies:

| Area | Required assertion |
| --- | --- |
| Canonical encoding | Object key order is stable and invalid/non-finite/deep/oversized input is rejected. |
| Plain-data boundary | Dates, maps, custom prototypes, object or array accessors, sparse arrays, extra array properties, and unsafe object properties are rejected rather than interpreted as JSON application data. |
| Sequencing | Duplicate, old, half-range, and normal values behave correctly across unsigned 32-bit wrap. |
| Authentication | Matching secrets prove both roles; a wrong secret cannot reach `ready`. |
| Negotiation | Capabilities and scopes are the exact independent intersection. |
| Authority | Controller command produces target application, a fresh ordered `applied`, and returned target-owned state; duplicate command IDs reuse the cached result without reusing an old envelope sequence. |
| Intent | Negotiated smartphone intent reaches only the target reducer and converges through returned state. |
| Freshness | Controller state age begins at ready, is updated only by accepted authoritative state, and remains evaluable after an explicit disconnect. |
| Backpressure | Replaceable state/intent retains the newest pending value instead of accumulating history. |
| Activation | Constructing the VDO adapter does not construct/start the SDK. |
| Data-only VDO | Target uses `announce()` and controller uses `view()` with audio/video/resources disabled. |
| Selection | Multiple matching targets require explicit selection; custom channels remain bound to the selected stream and peer UUID. |
| Lifecycle races | Stop wins in-flight connect/join/view work, failed starts clean up completely, stale SDK callbacks are inert, and an explicit selection failure remains retryable. |
| Session secrecy | Demo stop clears generated pairing material synchronously and restart produces fresh values. |
| Delivery modes | Control is ordered/reliable and live state is unordered with zero retransmits. |
| Application seam | Fixed non-executable Marionette manifest, exact state/command/intent validation, revision conflict, momentary lease, persistent hold, and producer-first Stop are tested independently of transport. |
| Supply chain | Pinned SDK files match recorded SHA-256 hashes and local links resolve. |

For changes to protocol validation, add a negative test before changing behavior. For a new capability, test both negotiated and absent-capability paths.

## Additional protocol test vectors required for a production fork

The reference suite is a starting point. A production implementation SHOULD add portable fixtures for:

- exact canonical transcript bytes and HMAC result;
- altered role, nonce, hello array order, session ID, and version;
- duplicated/changing hello and mismatched `ready`;
- application data before mutual ready;
- wrong session, sender ID, epoch, lane, and direction;
- every byte/array/object/depth boundary at limit and limit plus one;
- unsafe field names and unexpected fields;
- command ID dedupe and cache eviction policy;
- revision conflict and retry policy;
- lost/reordered/duplicated replaceable frames;
- old channel events after reconnect;
- asynchronous reducer completion after a newer intent;
- control queue cap and acknowledgement timeout;
- malformed binary extension frames if enabled.

Cross-language implementations MUST share byte-for-byte canonical/HMAC fixtures. “Both sides use JSON” is not an interoperability test.

## Deterministic browser smoke

Serve the repository and open the browser fixture:

```sh
npm run serve
```

<http://127.0.0.1:4173/qualification/browser-smoke.html>

This loads the real BRSP ES module and uses real browser Web Crypto with a deterministic in-process transport. It proves browser-level proof/scopes, reliable command/acknowledgement, replaceable intent, target-returned state, and teardown without making an external connection. Its source and exact limitation are documented in [`qualification/README.md`](../qualification/README.md).

A phone-sized responsive viewport remains tier-2 simulated browser evidence. It is not VDO route evidence or a physical phone receipt.

## Local browser smoke test

The following is an attended VDO.Ninja test, distinct from the deterministic browser fixture. Start the static server:

```sh
npm run serve
```

Open the demo in two fresh windows. Clear any retained developer state before each clean run.

### Activation and privacy

- Load both pages and observe that no SDK endpoint or transport starts before **Start**.
- Confirm there is no camera/microphone permission prompt.
- Confirm the page uses the local pinned SDK, not a runtime CDN.
- Confirm refresh requires another explicit Start/Connect.
- Confirm logs do not include the secret, proof, full invitation, application private state, or peer IP.

### Happy path

- Start a target and copy the room/secret through a separate trusted path.
- Start a controller and wait for mutual authentication on both sides.
- Check that negotiated scope/capability status is visible.
- Move live controls quickly; both scenes should converge on target-returned values.
- Use Reset; pending must clear only on the matching `applied` result.
- Stop; producers and both lanes should quiesce immediately.

### Negative path

- Use the right room and wrong secret. Controls must never enable.
- Request a scope the target does not grant. It must remain disabled/rejected.
- Inject a malformed, oversized, old-sequence, or wrong-epoch frame in a development fixture. It must not mutate state.
- Restart the target. The controller must not silently attach to a different target or preserve authenticated readiness.

## Physical smartphone companion matrix

Use at least one iOS/WebKit and one Android/Chromium phone when those platforms are supported. Record physical device models; desktop responsive mode is a separate row.

### Layout and input

- portrait and landscape, including rotation during input;
- smallest and largest supported viewports, browser chrome expanded/collapsed;
- safe-area insets and dynamic viewport height;
- touch target size, handedness, large text, screen reader names, contrast, reduced motion;
- touch, stylus where supported, and keyboard/switch alternative;
- pointer capture outside the control, `pointercancel`, multi-touch conflict, edge gestures;
- local-only scene pan, pinch, and Reset without any wire/shared-coordinate change.

### Lifecycle

- switch apps and return;
- screen lock/unlock;
- Wake Lock acquired, denied, and lost;
- Wi-Fi disconnect/reconnect and Wi-Fi-to-cellular transition;
- browser/process suspension and OS battery saver;
- orientation or resize while a leased control is active;
- close/reload while a momentary control is held.

The target must neutralize every `expiry: "neutral"` control after its receiver-local lease. A final phone `pointerup`, `pagehide`, or Stop packet is useful but cannot be the safety boundary.

## Real transport matrix

Perform attended two-device sessions rather than relying only on mocked lanes.

| Case | Procedure | Acceptance |
| --- | --- | --- |
| Direct candidate | Run on networks where a direct candidate is possible. | Both peers report direct or the limitation is recorded; live control remains current. |
| Forced TURN | Enable adapter `forceTURN` at both endpoints. | Both independently report relay; intent/state and reliable commands still pass. |
| Mixed route intent | Enable `forceTURN` at only one endpoint. | Treat as an invalid/diagnostic fixture; never claim relay without readback from both. |
| Restrictive network | Use corporate/guest/cellular networks in the support matrix. | Pairing succeeds or the precise unsupported network is documented. |
| Interruption | Interrupt network long enough to close/recover ICE. | Stale state is visible, leased controls neutralize, and any new connection repeats handshake/snapshot. |

`forceTURN` is configuration intent, not evidence of the selected route. Obtain candidate-pair diagnostics from both endpoints.

## Performance and freshness fixtures

### Changing-state run

Drive a deterministic control through the complete phone → target → phone path for at least several minutes. Record:

- offered intent rate;
- accepted target rate;
- target state publication rate;
- controller acceptance/render rate;
- round-trip input-to-returned-state latency where measurable;
- maximum inter-arrival gap and p95/p99;
- adapter coalesced/replaced offer count;
- state stale/recovery transitions;
- reliable lane queued bytes and command acknowledgement latency.

Do not count application-coalesced offers as packet loss. They were deliberately not handed to the transport.

### Unchanged heartbeat

Hold a valid unchanged scene/control. Verify the documented heartbeat repairs a dropped update and maintains freshness without generating an excessive reliable queue.

### Injected backpressure

In a mock or instrumented adapter, keep `bufferedAmount` above zero while offering values A, B, and C. Drain once. Only C should be handed off next. Repeat for both target state and controller intent.

### Rate-limiter correctness

Use an ideal-deadline scheduler, not `lastSend = now` drift that can accidentally halve a nominal 60 Hz stream. Report the measured rate; do not infer it from the configured interval.

## Stale, hold, and recovery test

1. Reach stable ready/live state.
2. Interrupt authoritative target state without destroying the rendered scene.
3. At the configured receiver-local threshold, show stale and hold the last valid state.
4. Resume with one valid current frame. Apply it immediately.
5. Keep the presentation in recovering state until the declared consecutive-frame hysteresis completes.
6. Verify unrelated diagnostic or optional placement packets do not extend authoritative liveness.
7. Close the channel and verify it receives the same stale grace instead of instantly clearing the scene.

Browser background throttling can delay timers by seconds. Measure both foreground and background behavior; do not claim the threshold is a wall-clock deadline under OS suspension.

## Multi-peer/Party qualification

For an authoritative host fan-out profile:

- test 1 through the declared maximum guests;
- enforce maximum participant count, message bytes, and aggregate publication rate;
- verify every guest receives the byte-equivalent scene version/roster;
- verify stable participant ordering and removal;
- verify a guest accepts the aggregate only when its fresh identity appears;
- disconnect/reconnect one guest while others continue;
- confirm no intent/display feedback loop causes state drift;
- confirm guests cannot impersonate the host or gain other guests' direct channel authority.

## Security review fixtures

- entropy source and invitation expiry/reuse;
- online and offline secret-guessing assumptions;
- proof reflection and transcript modification;
- exact origin, CSP, third-party script, analytics, and extension exposure;
- bearer material in URLs, history, logs, crash reports, screenshots, clipboard, and referrers;
- scope escalation and unknown capability handling;
- arbitrary action, selector, URL, HTML, prototype-pollution, and code-injection attempts;
- command replay/dedupe across reconnect;
- bounded CPU, memory, logs, pending commands, and message rates;
- connected-controller inventory, revocation, and audit behavior for production identity systems.

A security review must also cover the signaling/TURN service and product backend; application HMAC does not make surrounding infrastructure irrelevant.

## Release gate

A release profile SHOULD publish a table with each supported target/controller combination and one of:

- **pass** — exact commit/profile qualified;
- **conditional** — works with a named limitation;
- **fail** — tested and does not meet acceptance;
- **not tested** — no evidence.

Do not replace “not tested” with assumed parity. Keep raw evidence immutable and record any later interpretation separately.

Copy the record template and inspect the current open matrix in [15 — Qualification tiers and current record](15-qualification-record.md).

## Current repository status

The repository includes automated protocol/adapter/application-seam tests, the contract checker, and a deterministic real-browser smoke fixture. The application starter implements a target-local lease for its bounded Marionette pointer profile; that does not constitute a general reusable companion SDK or physical-device qualification. The generic demo remains suitable for attended VDO browser smoke testing. Production identity, invitation expiry/revocation, multi-controller arbitration, public-VDO evidence for the current candidate, packaged native-shell/phone evidence, and cross-browser physical-device qualification remain open and are not claimed complete. See the dated [current record](15-qualification-record.md).
