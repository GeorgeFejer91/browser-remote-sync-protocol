# 06 — Problems encountered and transferable solutions

This ledger generalizes the problems encountered while implementing and qualifying Affect Tracker's remote Flubber, normalized placement, reciprocal Universe mode, immutable settings beacon, multi-guest Party scene, and smartphone Party camera. “Observed” describes that source implementation and its recorded builds; it is not automatically a performance claim for this repository or every network.

## 1. Treating VDO.Ninja as a video-only tool

**Problem.** The product only needed to send coordinates, symbols, settings, and scene state. A video stream would waste encoding/decoding/network work and would not provide a typed control return path.

**Solution.** Use VDO.Ninja's data-only `announce()`/`view()` SDK path with `audio:false` and `video:false`. Build application messages on bidirectional data channels.

**Transfer rule.** Separate “VDO.Ninja the connection service/SDK” from “video the media payload.” Choose data channels for structured state.

## 2. Confusing discovery with authentication

**Problem.** A public room, source prefix, SDK UUID, or friendly label lets a UI find a peer but does not prove who controls it. The original public remote room intentionally permitted observation/impersonation and had to disclose that boundary.

**Solution.** BRSP adds mutual transcript proof with a separate high-entropy secret and least-authority scope intersection. Labels remain display-only.

**Transfer rule.** Routing names are not identity. Authenticate above signaling before enabling commands.

## 3. Source labels were not available when needed for discovery

**Problem.** In the source integration, custom peer metadata was available only after a peer connection, while the chooser needed a human-readable name before connecting.

**Solution.** Encode a bounded sanitized public-name token into the advertised stream ID before a fresh random suffix, while still supplying the label as peer metadata. For BRSP production invitations, prefer a trusted invitation service and random room; the demo uses a generic label and unique room.

**Transfer rule.** Audit when metadata becomes available. Never assume post-connection metadata can drive pre-connection selection, and never put private identity or secrets into public identifiers.

## 4. Creating two connections for two-way data

**Problem.** It is easy to make both peers announce and view each other because the roles sound directional. That creates duplicate peer connections, duplicate routing choices, and possible duplicate data.

**Solution.** Use one publisher/viewer connection. Its data channels are already duplex. The target announces; the controller views; commands travel one direction and acknowledgements/state the other.

**Transfer rule.** Connection-establishment role is not data direction. Add a second connection only for a separately justified topology/media need.

## 5. Using one reliability policy for every message

**Problem.** Reliable retransmission is correct for a command or settings snapshot but harmful for an obsolete high-rate coordinate. One channel cannot simultaneously optimize both without application scheduling complexity and head-of-line risk.

**Solution.** Separate lanes:

- reliable ordered control for handshake, commands, applied acknowledgements, and snapshots;
- unordered `maxRetransmits:0` state for replaceable current state.

**Transfer rule.** Classify each message by semantic consequence of loss, duplication, and delay before selecting transport options.

## 6. Queuing obsolete live state

**Problem.** When network/browser send queues grow, continuing to append 60 Hz movement creates a delayed replay. A receiver then sees where the object was instead of where it is.

**Solution.** Inspect `RTCDataChannel.bufferedAmount`. If nonzero, do not send another live state. Retain one latest pending value and replace it until the channel drains.

**Observed.** In a forced-TURN high-change test of the source app, injected/observed backpressure produced 206 discarded offers while the receiver stayed live. Clearing pressure sent current state; obsolete history was not replayed.

**Transfer rule.** “Latest state wins” must exist in queue behavior, not only in the receiver reducer.

## 7. A nominal 60 Hz limiter delivered near 30 Hz

**Problem.** The original limiter compared every animation frame only with the previous accepted send. Browser frames arriving slightly earlier than 16.67 ms were rejected, and the next opportunity came one frame later, effectively halving cadence.

**Solution.** Advance an ideal 60 Hz deadline, permit a bounded 5 ms early tolerance, enforce at least 11.67 ms between changed sends, and repay timing debt so the long-run cap remains 60 Hz.

**Observed.** Fresh source-app desktop checks after the change measured about 59.72 frames/s direct and 58.48 frames/s through forced TURN over roughly 136–137 seconds, with independently reported routes.

**Transfer rule.** Rate limiting frame-driven input needs a deadline model, not a naive minimum elapsed comparison. Test slightly-early frames and long-run rate.

## 8. A lost final change never recovered

**Problem.** Sending only on change means the final value can be the one message lost on a partial-reliability channel. If the user stops moving, no new message repairs it.

**Solution.** Repeat current state on a bounded heartbeat. The source high-rate coordinates used 100 ms; aggregate Party scenes used 250 ms; the generic demo uses 250 ms.

**Transfer rule.** Replaceable state needs a heartbeat or snapshot repair path even when unchanged.

## 9. Sequence comparison broke at wraparound

**Problem.** Ordinary numeric `next > previous` fails when a uint32 wraps from `0xffffffff` to `0`. Accepting all different values allows old packets to regress state.

**Solution.** Use unsigned half-range ordering and bind sequences to a fresh sender epoch. Reject duplicates, older values, and exactly half-range ambiguity.

**Transfer rule.** Define wrap behavior in the wire contract and test it, even if a session is unlikely to send four billion frames.

## 10. Raw viewport pixels disagreed across screens

**Problem.** The same pixel coordinate does not describe the same relative movement on a desktop, phone, or resizable window. Absolute normalized placement can also jump the receiving object at connect time.

**Solution.** Normalize within each object's movable viewport range. On first remote placement, anchor sender-current to receiver-current; apply later sender displacement to that local anchor; allow local movement to re-anchor.

**Transfer rule.** Synchronize semantic/relative geometry, then project locally. Connection should not unexpectedly reposition local content.

## 11. Optional placement accidentally became a liveness signal

**Problem.** A secondary placement packet could continue arriving while the authoritative affect/state packet stopped. Treating any message as fresh would incorrectly keep the session live.

**Solution.** Only accepted authoritative state owns liveness. Placement updates projection but neither establishes nor extends state freshness.

**Transfer rule.** Define one or an explicit set of liveness-owning message types; do not use generic “last network activity.”

## 12. Mirrored display state echoed back as input

**Problem.** Party guests received host-authored position/appearance for their displayed object. Reusing that returned display position as the guest's next upstream local offer made the host's own arrangement look like a new guest movement, creating a feedback loop.

**Solution.** Keep upstream local intent separate from returned authoritative display state. Rendering a remote state does not call the outbound input path.

**Transfer rule.** Maintain explicit `localIntent`, `authoritativeState`, and `presentationState` domains. This is one of the most important general lessons.

## 13. “Same state” still looked different

**Problem.** Sending X/Y alone does not make a complex procedural scene identical. Random outline offsets, palette, size, shape, animation phase, roster order, and layout can differ.

**Solution.** Define the desired equality level. Party mode sent shared visual settings and animation phase, kept stable roster order, and derived per-participant projection offsets deterministically from public session stream IDs.

**Transfer rule.** Decide whether peers must share data, semantic scene, animation timeline, or pixels. Transmit or deterministically derive every property required at that level.

## 14. Immediate close and silent-timeout behavior disagreed

**Problem.** The receiver used a two-second last-packet grace for silence but entered stale immediately on an explicit channel-close event. This could flash lost/live during a repair.

**Observed.** In an attended forced-TURN run of the source build, the old behavior was already stale at a 1.591-second operator capture. The fixed build remained live/holding at 1.580 seconds and showed one stable warning at 3.426 seconds; capture/switching overhead means these are bounds, not exact transition times.

**Solution.** Record the disconnect edge immediately but use the same last-valid-state freshness deadline for visible stale. A repaired same-source channel inside grace produces no warning flash.

**Transfer rule.** Network events and application freshness are related but not identical state machines.

## 15. One returning frame caused status flapping

**Problem.** An isolated delayed frame after stale could flip the UI live briefly before another gap.

**Solution.** Apply every accepted state immediately but require three consecutive valid frames before the status reports recovered.

**Transfer rule.** Separate data application latency from status hysteresis.

## 16. Background browser scheduling dominated transport behavior

**Problem.** A correct WebRTC channel cannot force JavaScript tasks and timers to run while the browser/OS deprioritizes a hidden surface. Wake Lock prevents some sleep but does not guarantee normal scheduling.

**Observed.** A source-app ordinary hidden receiver delayed stale/closed presentation by about 9.8–11.2 seconds and continued surfacing queued tasks at roughly 10 frames/s. A sender whose foreground helper was displaced degraded to roughly one update per second with about 1,056 ms p95 receiver gaps. These are specific Chrome/Quest workflow observations, not universal browser constants.

**Solution.** Use a foreground render/task owner when the platform supports the product workflow, request/renew Wake Lock as a convenience, show degradation, and give a user-gesture restore action. Keep the receiving app in a supported foreground/immersive state for low latency.

**Transfer rule.** Qualify the browser lifecycle, not just the network. No protocol timestamp fixes a page that is not being scheduled.

## 17. Adding a delay buffer would not fix background scheduling

**Problem.** When a hidden page surfaces queued messages late, adding a receiver delay buffer seems like a way to order/smooth them. It would increase normal latency and still could not establish when JavaScript actually received a network packet versus when a task ran.

**Solution.** The coordinate profile intentionally carried no wall-clock timestamps and applied accepted frames immediately. The product declared hidden ordinary tabs outside its bounded low-latency workflow.

**Transfer rule.** Do not add latency to hide an ownership/scheduling problem. If wall-clock freshness is required, design clock/latency semantics explicitly and still treat suspension separately.

## 18. Requesting TURN was mistaken for using TURN

**Problem.** A `forceTURN` flag expresses configuration intent. ICE can fail, fall back, or be misreported by UI if route is not independently observed.

**Solution.** Read peer connection quality/stats at both endpoints and require `relay` evidence for relay qualification. Expose requested versus observed route separately.

**Observed.** The source app recorded direct same-PC RTT of 0–1 ms and forced-TURN RTT around 34–39 ms in several attended runs. These are exact environment receipts, not service-wide latency promises.

**Transfer rule.** Never turn a requested mode into a verified claim.

## 19. Automatic target selection caused surprise ownership

**Problem.** Auto-selecting when multiple sources exist, or switching to a restarted source during an active/stale session, can connect the controller to an unintended user.

**Solution.** Auto-select only within a documented initial single-source settle window, or require explicit selection. Never auto-switch during immersive/active ownership. A restarted source with a fresh ID requires a new explicit choice.

**Transfer rule.** Selection is authority. Prefer a small user interaction over invisible peer substitution.

## 20. Departed sources remained in signaling discovery

**Problem.** VDO signaling could retain an old disconnected source label after the publisher restarted, leaving stale chooser entries.

**Solution.** Preserve the old selected source during its same-source repair grace. Once the user explicitly selects a different source, remove only the known-dead prior label. Do not indiscriminately delete healthy alternatives.

**Transfer rule.** Discovery presence is eventually observed metadata, not authoritative connection health. Reconcile it with selected-channel evidence carefully.

## 21. Late events from the old source corrupted the new one

**Problem.** After a user switches sources, old channel messages or close events can arrive later and mutate the current receiver if callbacks only reference global selection.

**Solution.** Capture accepted stream ID, peer UUID, and channel object in each listener. Before handling an event, verify all still equal current ownership.

**Transfer rule.** Async callbacks must prove they still own the state they intend to change.

## 22. Stop continued emitting while signaling disconnected

**Problem.** Awaiting `sdk.disconnect()` before stopping heartbeats/frame offers leaves an interval in which application packets can still be emitted. A delayed signaling promise made this race testable.

**Solution.** Enter `stopping`, cancel producers and timers, close/clear channels, then await SDK teardown.

**Transfer rule.** Local quiescence precedes remote/infrastructure cleanup.

## 23. Binary and string messages collided on one handler

**Problem.** Live coordinates were binary, while Party aggregate replies were strings on the same duplex channel. Feeding strings into the binary decoder or arbitrary binary into JSON/control logic caused ambiguity.

**Solution.** Dispatch by JavaScript data type and exact typed magic/length. Strings have a separate byte cap and protocol decoder; binary packets have fixed lengths/magic. Neither auxiliary string nor placement changes affect-coordinate liveness.

BRSP further separates general control and state channels to reduce multiplexing ambiguity.

**Transfer rule.** Every channel needs an explicit type namespace and bounded decoder. Never “try JSON, then execute/fallback.”

## 24. Static settings were treated like continuous state

**Problem.** Portable settings need reliable complete delivery and human review, unlike high-rate position. Automatically applying a discovered public snapshot would also trust an unauthenticated source too much.

**Solution.** Capture one immutable versioned snapshot at Start, send it on an ordered reliable channel, validate exact schema/bytes, preview, and require an explicit local Apply action. UI changes after Start require stop/restart.

**Transfer rule.** Choose a transactional snapshot protocol for configuration; do not reuse a lossy live-state lane.

## 25. Network activation occurred too early

**Problem.** Constructing SDK clients or reconnecting on page load violates privacy expectations and can expose network metadata without current intent.

**Solution.** Page load only renders controls/disclosure and local scripts. Every endpoint requires a fresh Start press. Refresh returns to idle. Start/Stop are accessible and visible.

**Transfer rule.** Connection lifecycle is a product permission boundary, not merely an SDK call sequence.

## 26. CDN SDK updates weakened reproducibility

**Problem.** A `latest` CDN script can change networking code without an application commit, undermining source review, offline/static operation, licensing, and qualification.

**Solution.** Vendor exact minified and readable source plus license, upstream tag, and SHA-256 hashes. Load locally and test hashes.

**Transfer rule.** Network dependencies belong in the evidence chain.

## 27. Public rooms and `password:false` had to be disclosed

**Problem.** The original Flubber discovery room was intentionally public and used no SDK password so any room listener could observe arbitrary normalized coordinates. That was a narrow product exception, not a secure general control protocol.

**Solution.** The source application disclosed public discovery, peer IPs, signaling/STUN/TURN, relay latency, and no availability guarantee. BRSP's generalized demo instead uses a fresh room, generated secret in SDK signaling, and application-layer proof.

**Transfer rule.** Prototype privacy decisions must not silently become production defaults when generalizing code.

## 28. Shared scene fan-out could become an accidental mesh

**Problem.** Connecting every guest to every other guest increases WebRTC connections, duplicate authority, CPU, network, and privacy exposure.

**Solution.** Party host maintains one receiver per guest, aggregates one stable scene, and sends that identical scene back through each guest's existing duplex channel. Guests do not receive one another's connections.

**Transfer rule.** For a bounded group, centralize scene authority and fan-out. For a larger group, use purpose-built server/SFU/data infrastructure rather than assuming browser mesh scalability.

## 29. Unbounded guest count was a product and accessibility risk

**Problem.** Even if signaling permits many room members, each guest adds a peer connection, rendering work, roster controls, labels, and viewport crowding.

**Solution.** Cap guests deliberately. Affect Tracker used eight invited guests and a maximum aggregate roster of nine including the host, with an 8 KiB scene and 30 Hz/250 ms rate profile.

**Transfer rule.** Protocol/service capacity is not the same as a usable product bound.

## 30. Phone users needed perspective, not a different shared scene

**Problem.** A phone's smaller viewport could not comfortably show the complete Party space. Transmitting each phone's zoom would cause connected screens to disagree about host-authored placement or fight for camera authority.

**Solution.** Add a smartphone-only local camera after Party becomes active: one-finger empty-space pan, two-finger centroid pinch, zoom range 0.5–1.6, Reset to centered 1.0, and inverse camera for object drag. Desktop exposes no Party camera. Camera state is neither transmitted, persisted, recorded, nor allowed to mutate the host scene.

**Transfer rule.** Separate shared world state from per-device view accommodation.

## 31. Reciprocal control needed a convergence rule

**Problem.** If two peers both control the same value with ordinary assignment, packet arrival order can make displays differ.

**Solution.** Universe mode kept independent local X/Y intentions and combined them by component-wise addition followed by saturation to `[-1,1]`. The operation is commutative, so both sides converge when they hold the same latest pair.

**Transfer rule.** Symmetric co-control requires an explicit deterministic algebra or a real multi-writer conflict protocol. Do not call a race “collaboration.”

## 32. Receiving alone was misread as reciprocal readiness

**Problem.** One endpoint could receive a partner while the partner had not selected it back, making a duplex co-control UI appear ready prematurely.

**Solution.** Reciprocal-live required both a valid incoming coordinate and at least one listener connected to the local outgoing source. Discovery UI closed only at that boundary.

**Transfer rule.** Define readiness from the complete application topology, not one network edge.

## 33. Real measurements were easy to overgeneralize

**Problem.** Same-PC direct RTT, forced-TURN route, synthetic 130 Hz input, older commit evidence, and physical Quest/worn-sensor evidence answer different questions.

**Solution.** Record exact commit, build/cache revision, device/browser, route evidence, input type, duration, cadence/gaps, and open gates. Do not relabel historical or synthetic evidence.

**Transfer rule.** Qualification is a ledger of bounded claims, not a single “tested” badge.

## Consolidated checklist

Before transferring BRSP principles to another app, answer:

- What exact application meaning crosses the network?
- Who owns each field/action?
- Which messages require reliability and applied acknowledgement?
- Which values are replaceable?
- How is identity proven above discovery?
- What scopes are requested and granted?
- What byte/rate/queue/participant limits apply?
- What sequence/epoch/revision/dedupe rules apply?
- What owns liveness?
- What happens on stale, close, repair, restart, and old callbacks?
- How do unequal viewports project the same semantic state?
- Which presentation state stays local (especially phone zoom/pan)?
- How is Stop guaranteed to quiesce producers?
- How are direct/relay and foreground claims independently measured?
- Which exact build/device/network evidence remains open?

Continue with [07 — Patterns and use cases](07-patterns-and-use-cases.md) for concrete transfers.
