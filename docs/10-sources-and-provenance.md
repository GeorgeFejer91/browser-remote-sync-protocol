# 10 — Sources and provenance

## Method and date

This ledger distinguishes normative standards, current service/SDK documentation, source-implementation evidence, and repository-authored decisions. Sources were reviewed on 2026-08-30 unless an inherited measurement states another date. A link establishes provenance; it does not transfer a source's license to original BRSP documentation.

## Reused code and licenses

| Artifact | Provenance | Treatment |
| --- | --- | --- |
| BRSP core, demo, tests, and documentation | Original repository work generalized from the public implementation lessons below | MIT, except named third-party files |
| Application-integration starter and deterministic browser qualification fixture | Original repository work implementing the documented Marionette seam | MIT |
| Native Meta Quest integration fragments and deterministic fixtures | Original repository work extracting an application-neutral Kotlin/Android/WebView boundary from the Polar Remote Quest pilot | MIT; fragments are not a complete/qualified APK |
| VDO.Ninja SDK 1.5.5 files under `vendor/vdoninja/1.5.5/` | Copied from the Affect Tracker pin, which identifies the upstream VDO.Ninja SDK distribution | Unmodified runtime files; MPL-2.0 retained; exact hashes checked |
| VDO adapter concepts | Current VDO.Ninja SDK API plus behavior learned in Affect Tracker | Adapter code newly written for this repository |

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), the vendored [MPL-2.0 license](../vendor/vdoninja/1.5.5/LICENSE-MPL-2.0.txt), and [vendor notice](../vendor/vdoninja/1.5.5/NOTICE.md).

## Current VDO.Ninja sources

### SDK repository

- [VDO.Ninja SDK (`ninjasdk`)](https://github.com/steveseguin/ninjasdk)

Adopted facts and constraints:

- the SDK provides data-only `announce()` and `view()` flows;
- the publisher/viewer peer connection is bidirectional for data and is the preferred efficient SDK topology for one data-only peer pair;
- custom data channels can select ordering/retransmission behavior;
- route/quality and `bufferedAmount` information are available for diagnostics/backpressure;
- SDK usage is preferred over directly attaching to the service's internal signaling WebSocket;
- SDK password/salt behavior and service requirements must be reviewed at the pinned version.

The repository pins local SDK 1.5.5 for reproducibility. Current upstream documentation may describe newer behavior; updating the pin requires review, hash update, automated checks, and real route qualification.

The deployment inventory in [14 — Deployment, network, and CSP](14-deployment-network-and-csp.md) was also verified against the readable pinned source. For the normal repository/Tauri origins, that source defaults to:

- signaling at `wss://wss.vdo.ninja`;
- a TURN-list request at `https://turnservers.vdo.ninja/`;
- Google and Cloudflare STUN defaults;
- runtime TURN URLs, with version-specific VDO/OBS fallback relay names.

This is evidence about vendored `v1.5.5`, not a permanent service endpoint/SLA. STUN/TURN ICE traffic is not fully represented by page CSP `connect-src`, and the runtime TURN list may change independently.

### Data-only guide

- [Generic P2P data transmission guide](https://docs.vdo.ninja/guides/iframe-api-documentation/generic-p2p-data-transmission-guide)
- [`&datamode` setup parameter](https://docs.vdo.ninja/advanced-settings/setup-parameters/and-datamode)

These confirm that VDO.Ninja can carry generic peer data without making encoded video the application payload. BRSP uses the SDK's direct data-channel API, not the iframe URL protocol.

### TURN and privacy

- [`turn` configuration](https://docs.vdo.ninja/advanced-settings/turn-and-stun-parameters/turn)
- [`relay` configuration](https://docs.vdo.ninja/advanced-settings/turn-and-stun-parameters/and-relay)
- [Privacy and security details](https://docs.vdo.ninja/help/privacy-and-security-details)
- [VDO.Ninja privacy policy](https://docs.vdo.ninja/help/privacy-and-security-details/vdo.ninja-privacy-policy)
- [VDO.Ninja terms of service](https://docs.vdo.ninja/help/privacy-and-security-details/vdo.ninja-terms-of-service)

Adopted implications:

- direct peers may expose network addresses to the peer/WebRTC diagnostic surfaces;
- STUN, signaling, and optional TURN infrastructure remain part of the data-flow assessment;
- TURN changes the route but is not an application identity mechanism;
- selecting/forcing TURN is intent until both endpoints' selected-candidate diagnostics confirm relay;
- every adopter must re-review current service policy, hosting, availability, and legal/privacy fit.

This repository does not claim that BRSP HMAC encrypts transport payloads; WebRTC supplies channel transport protection, while BRSP proof establishes possession of the session secret over the complete hello transcript.

## Web platform and protocol standards

| Source | Use in BRSP |
| --- | --- |
| [WebRTC 1.0 W3C Recommendation](https://www.w3.org/TR/2021/REC-webrtc-20210126/) | `RTCDataChannel`, ordered/reliable versus partial-reliability options, `bufferedAmount`, low-threshold/drain behavior, and maximum-message considerations |
| [RFC 8831 — WebRTC Data Channels](https://www.rfc-editor.org/rfc/rfc8831) | SCTP over DTLS/ICE architecture and the unordered/zero-retransmit UDP-like live-state profile |
| [RFC 8832 — WebRTC Data Channel Establishment Protocol](https://www.rfc-editor.org/rfc/rfc8832) | In-band data-channel negotiation and channel properties |
| [RFC 6455 — WebSocket](https://www.rfc-editor.org/rfc/rfc6455) | Alternative reliable message transport; application must emulate newest-only behavior before its send queue |
| [WebTransport W3C Candidate Recommendation](https://www.w3.org/TR/webtransport/) | Future server-mediated streams/datagrams adapter; not browser-to-browser signaling, and stream messages require framing |
| [Web Cryptography API](https://www.w3.org/TR/webcrypto/) | Browser HMAC-SHA-256 implementation and cryptographically strong key operations |
| [RFC 2104 — HMAC](https://www.rfc-editor.org/info/rfc2104/) | Keyed message authentication construction used for mutual possession proofs |
| [RFC 3986 — URI syntax](https://www.rfc-editor.org/info/rfc3986/) | URL fragments are separated from the URI sent to an origin, informing—but not making safe—the optional QR fragment pattern |
| [Pointer Events](https://www.w3.org/TR/pointerevents/) | Unified phone touch/stylus/mouse events and pointer capture for companion controls |
| [Screen Wake Lock](https://www.w3.org/TR/screen-wake-lock/) | Optional foreground usability aid; loss/denial is expected and not a background-reliability guarantee |
| [Page Visibility Level 2](https://www.w3.org/TR/page-visibility-2/) | Visibility lifecycle signal; browser/OS scheduling may still throttle or suspend work |
| [Mixed Content](https://www.w3.org/TR/mixed-content/) | Why an HTTPS companion must not rely on an insecure private-LAN HTTP/WS controller endpoint |
| [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access?hl=en) | Current Chrome-origin/user-permission direction for public pages reaching local-network services; verify supported releases at deployment time |

## Native-shell and Tauri sources

The native-shell recipe uses Tauri v2 as the concrete example while keeping the BRSP boundary applicable to Electron and other WebViews:

| Official Tauri source | Use in this repository |
| --- | --- |
| [Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/) | Thin typed request/response boundary for native-authoritative application commands |
| [Calling the frontend from Rust](https://v2.tauri.app/develop/calling-frontend/) | Small versioned native snapshots/events and lifecycle cleanup |
| [Capabilities](https://v2.tauri.app/security/capabilities/) | Window/WebView labels, permission union, generated schemas, and constraining application commands through an app command manifest |
| [Content Security Policy](https://v2.tauri.app/security/csp/) | Bundled WebView CSP, local IPC sources, and avoiding remote runtime scripts/content |

Tauri documentation is version-sensitive. Adopters must inspect the generated schemas and official docs for the exact pinned Tauri/plugin version; the examples do not grant filesystem, shell, process, opener, or arbitrary HTTP authority.

BRSP's canonical JSON definition is project-specific. The repository does not claim RFC 8785 conformance.

## Native Android and Meta Quest sources

The native Quest profile in [16](16-native-meta-quest-integration.md) uses
primary platform documentation for version-sensitive boundaries:

| Official source | Use in this repository |
| --- | --- |
| [Meta Spatial SDK Activity lifecycle](https://developers.meta.com/horizon/documentation/spatial-sdk/spatial-sdk-activity-lifecycle/) | `AppSystemActivity`, required immersive `configChanges`, VR-ready/pause and HMD signals independent of Android resume/pause, and `onSpatialShutdown()` as the final Spatial cleanup owner |
| [Android foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device) | Android 14 type-specific declaration/permission/runtime prerequisites and the bounded `connectedDevice` use case |
| [Launch a foreground service](https://developer.android.com/develop/background-work/services/fgs/launch) | visible-start restrictions, promotion with a declared service type, and target-SDK permission checks |
| [AndroidX `WebViewAssetLoader`](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader.html) | packaged assets over the reserved HTTPS origin with Same-Origin-compatible loading and file/content access disabled |
| [Android WebView native-bridge risks](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges) | why the target bridge must load only packaged content and expose no sensitive or generic native operation |

These sources are version-sensitive. Pin the Meta Spatial SDK, Android target
SDK, AndroidX WebKit, and system WebView used by the candidate, then re-check
the current official requirements. An Android foreground service is not a
claim that a Spatial Activity or BRSP session survives destruction.

## Polar Remote Quest pilot

The native chapter was developed against an independent pilot named **Polar
Remote Quest**. The pilot uses a native Meta Spatial SDK Activity, pure Kotlin
BRSP target, Polar H10 adapter, packaged VDO transport-only WebView, and
Chromium companion. Its architecture contributed these reusable lessons:

- inventory every local action exactly once as remotely eligible or
  headset-only and hash the canonical capability manifest;
- keep controller epoch/nonce local to the controller and, for the default
  profile, limit the QR to room, session, transport secret, and pairing secret;
- when a lab workflow cannot scan a VR QR, name the permanent Beacon ID as a
  public discovery/local-approval profile: it improves ergonomics but does not
  authenticate a person, and headset Accept remains the sole grant boundary;
- keep a browser ECG view bounded, newest-only, normalized, separately scoped,
  revision-independent, and explicitly non-medical; never send raw/full-rate
  ECG through the companion state projection;
- separate the WebView's VDO secret from Kotlin's BRSP proof key;
- queue WebView ingress onto one native owner thread with bounded admission and
  generation-fence every asynchronous transport callback;
- reject non-interactive mutations without deferring them;
- make Spatial shutdown and notification Stop producer-first/idempotent;
- keep route/RTT diagnostics out of semantic revision changes;
- state the post-`ready` WebView compromise residual explicitly;
- preserve BRSP's immediate-hello rule while withholding target proof/ready
  until local controller acceptance, with the target's grantable set fixed
  before the lanes open;
- compute interactive eligibility from Android plus VR/OpenXR state, not
  `onResume()` alone;
- use a foreground service type only for actual service-owned work matching
  that type, never as a cosmetic notification classification;
- end the pilot session on peer loss and require a fresh headset invitation
  rather than promising reconnect after its proof key has been cleared.

Until an immutable public pilot commit and qualification receipt are linked,
this is source-context and host-built architecture evidence only. It is not
physical Quest, phone, H10, route, offline-LAN, latency, or BRSP product
qualification. A later record must add rather than rewrite that boundary.

## Affect Tracker source implementation

The transfer case study is the public Affect Tracker repository at commit [`4680ddf7d2e52cea325cd8cb0bff1868e53a5d33`](https://github.com/GeorgeFejer91/affect-tracker-web/tree/4680ddf7d2e52cea325cd8cb0bff1868e53a5d33). Relevant durable documents include:

- [Remote FLUBBER/VDO.Ninja integration contract](https://github.com/GeorgeFejer91/affect-tracker-web/blob/4680ddf7d2e52cea325cd8cb0bff1868e53a5d33/for-ai/66-EXPERIMENTAL-REMOTE-FLUBBER.md)
- [VDO.Ninja qualification evidence](https://github.com/GeorgeFejer91/affect-tracker-web/blob/4680ddf7d2e52cea325cd8cb0bff1868e53a5d33/for-ai/67-REMOTE-FLUBBER-QUALIFICATION-2026-08-25.md)
- [Settings beacon contract](https://github.com/GeorgeFejer91/affect-tracker-web/blob/4680ddf7d2e52cea325cd8cb0bff1868e53a5d33/for-ai/68-EXPERIMENTAL-SETTINGS-BEACON.md)
- [Ground Control Universe and Party contract](https://github.com/GeorgeFejer91/affect-tracker-web/blob/4680ddf7d2e52cea325cd8cb0bff1868e53a5d33/for-ai/69-EXPERIMENTAL-FLUBBER-COLLABORATION.md)

Relevant implementation files:

- [`flubber-remote.js`](https://github.com/GeorgeFejer91/affect-tracker-web/blob/4680ddf7d2e52cea325cd8cb0bff1868e53a5d33/site/src/flubber-remote.js)
- [`flubber-collaboration.js`](https://github.com/GeorgeFejer91/affect-tracker-web/blob/4680ddf7d2e52cea325cd8cb0bff1868e53a5d33/site/src/flubber-collaboration.js)
- [`ground-control.js`](https://github.com/GeorgeFejer91/affect-tracker-web/blob/4680ddf7d2e52cea325cd8cb0bff1868e53a5d33/site/src/ground-control.js)

### Generalized implementation findings

The [problem/solution ledger](06-problems-and-solutions.md) explains these in detail. The major inherited lessons were:

- one VDO data connection is duplex; a second reverse “stream” is unnecessary;
- split reliable transactions from replaceable high-rate state;
- use unsigned sequence ordering, receiver-local freshness, heartbeat, stale hold, and recovery hysteresis;
- discard/coalesce obsolete live offers under backpressure;
- normalize geometry so unequal screens share scene semantics;
- separate upstream user intent from returned authoritative display to prevent Party feedback loops;
- fan out one identical bounded authoritative aggregate for shared scenes;
- make phone pan/pinch a local projection, not shared scene state;
- guard old source/channel events after reconnect and synchronously quiesce producers before asynchronous teardown;
- do not interpret a friendly source name, stream ID, or room secret alone as authenticated user identity.

### Inherited measured evidence

The source qualification document records attended measurements against its named commit/environment, including approximately 59.72 Hz direct and 58.48 Hz forced-TURN changing-coordinate receipts, zero-backlog behavior under injected pressure, and severe background scheduling gaps (including roughly 9.8–11.2 seconds for one hidden receiver stale transition and about 1056 ms p95 for one displaced sender-helper fixture).

Those measurements motivated BRSP's scheduler, coalescing, route-readback, and “browser suspension defeats timer guarantees” guidance. They are not measurements of this repository's generic demo and must retain their source commit/environment label.

## Affect Tracker desktop/browser Party extension

The later public Affect Tracker commit [`9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb`](https://github.com/GeorgeFejer91/affect-tracker-web/tree/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb) is a second, narrower case study for desktop/native-shell reciprocity. Relevant artifacts include:

- [Party mode contract](https://github.com/GeorgeFejer91/affect-tracker-web/blob/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb/for-ai/69-EXPERIMENTAL-FLUBBER-COLLABORATION.md);
- [desktop Party frontend](https://github.com/GeorgeFejer91/affect-tracker-web/blob/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb/desktop/src/party.js);
- [desktop Party pure core](https://github.com/GeorgeFejer91/affect-tracker-web/blob/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb/desktop/src/party-core.js);
- [browser Party aggregation](https://github.com/GeorgeFejer91/affect-tracker-web/blob/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb/site/src/flubber-collaboration.js);
- [Tauri CSP](https://github.com/GeorgeFejer91/affect-tracker-web/blob/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb/src-tauri/tauri.conf.json) and [settings-window capability](https://github.com/GeorgeFejer91/affect-tracker-web/blob/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb/src-tauri/capabilities/settings.json).

The commit demonstrates both desktop-host/phone-guest and phone-host/desktop-guest Party topology. The host sends one bounded semantic roster/scene back through each existing duplex connection. The desktop uses returned host scene data for WebView presentation only; it cannot mutate Rust or LSL state. Phone pan/zoom remains local projection, so the claim is equal semantic scene fields—not pixel-identical rendering.

Its security profile is intentionally different from BRSP: public experimental discovery, `password:false`, typed/bounded messages and peer binding, but no BRSP role-bound transcript proof or negotiated scopes. It is architecture/topology evidence, not secure generalized controller or BRSP conformance evidence.

The project reported 217/217 tests and passing CI for that commit. No physical smartphone↔Tauri session was recorded, so native/phone runtime qualification remains open. The bounded claim is repeated in [15 — Current qualification record](15-qualification-record.md).

## Repository-authored design decisions

The following are BRSP decisions rather than claims copied from VDO.Ninja or a standards body:

- the exact common envelope, byte/shape limits, type registry, and scope vocabulary;
- complete target/controller hello transcript and role-bound HMAC input;
- project-specific canonical JSON rules;
- target authority, `command`/`applied`, snapshot, state, and live-intent bodies;
- 192-bit recommended direct pairing secret;
- 256 KiB reference reliable queue cap;
- demo heartbeat/stale/recovery values;
- command dedupe size in the reference implementation;
- Marionette control-manifest vocabulary and 500 ms recommended momentary lease;
- explicit non-goals and production roadmap.

These values are conservative reference choices that adopters must validate for their application. They are not protocol values standardized by W3C, IETF, or VDO.Ninja.

## Claim discipline

When extending this work:

1. link a current primary source for an external API/service fact;
2. identify the pinned version actually shipped;
3. label measurements with commit, environment, route, and fixture;
4. distinguish configuration intent from observed route/behavior;
5. distinguish a design recommendation from an interoperability MUST;
6. preserve third-party notices and exact modified/unmodified status;
7. do not copy upstream prose/code beyond its license and attribution terms;
8. update this ledger when a new adapter, protocol source, or inherited measurement materially affects the design.
9. distinguish topology evidence from BRSP authentication/conformance and deterministic browser evidence from VDO, physical-device, or native-shell evidence.
