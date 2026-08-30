# 14 — Deployment, network inventory, and Content Security Policy

BRSP application envelopes are transport-neutral, but a deployment is not. Hosting, signaling, ICE, relay, browser origin rules, native WebView policy, firewalls, service availability, and privacy must match the selected adapter.

This chapter inventories the exact defaults found in the repository's pinned VDO.Ninja SDK `v1.5.5`. Re-run the inventory and qualification whenever the vendored bytes change.

## Deployment shapes

| Shape | Target assets | Companion assets | Connection path |
| --- | --- | --- | --- |
| Two hosted browsers | HTTPS static/app host | Same or another approved HTTPS host | VDO signaling plus WebRTC, or product backend |
| Tauri target plus phone | Bundled local WebView assets | Approved HTTPS companion origin | VDO in WebView plus WebRTC; typed IPC stays local |
| Native Quest target plus browser | Kotlin/Meta Spatial APK with optional packaged transport-only WebView | Approved HTTPS companion/PWA origin | VDO in packaged WebView plus WebRTC; BRSP proof/actions stay in Kotlin |
| Existing SaaS backend | HTTPS web app | HTTPS responsive companion | Authenticated WSS/WebTransport through product backend |
| Offline/private LAN | Bundled/local HTTPS app | LAN HTTPS app | Owned WSS signaling/data service or raw WebRTC signaling; not the default VDO adapter |

Cross-origin target and companion pages do not need CORS to exchange WebRTC data-channel messages; each separately reaches signaling and then the negotiated peer route. Any invitation API, hosted assets, WebSocket backend, or TURN credential endpoint still has its own origin/CORS/authentication policy.

## Pinned VDO.Ninja network inventory

The following entries were verified directly in [`vendor/vdoninja/1.5.5/vdoninja-sdk.js`](../vendor/vdoninja/1.5.5/vdoninja-sdk.js):

| Endpoint/default | Purpose | Governed by page/WebView `connect-src`? | Deployment consequence |
| --- | --- | --- | --- |
| `wss://wss.vdo.ninja` | Default SDK signaling WebSocket | Yes | Required by the supplied adapter unless an audited SDK host override is deliberately implemented |
| `https://turnservers.vdo.ninja/` | Default runtime TURN-list request | Yes | Allow exact HTTPS origin; response may supply relay hosts dynamically |
| `stun:stun.l.google.com:19302` | Default Google STUN candidate service | Not fully; ICE is browser/network-stack traffic | Disclose third-party network metadata and allow in relevant firewall policy |
| `stun:stun.cloudflare.com:3478` | Default Cloudflare STUN candidate service | Not fully | Same as above |
| Runtime TURN URLs returned by the TURN-list service | Relayed encrypted WebRTC candidate path | Not fully | Hosts/ports can change; observe selected route and operate/contract infrastructure for production requirements |
| Pinned fallback relay names under `*.vdo.ninja` and `*.obs.ninja`, on TURN UDP 3478 and TURNS TCP/TLS 443 | SDK fallback when the TURN-list request fails | Not fully | The fallback list is version-specific, not a durable exhaustive firewall contract |

In pinned source, the named fallback candidates include:

```text
turn-cae1.vdo.ninja:3478
turn-usw2.vdo.ninja:3478
turn-eu4.vdo.ninja:3478
turn-eu1.vdo.ninja:3478
turn-use1.vdo.ninja:3478
www.turn.obs.ninja:443
turn.obs.ninja:443
```

Do not copy fallback usernames/credentials into documentation, application configuration, logs, or product policy. They belong to the pinned upstream implementation and are not a production service contract. The runtime TURN endpoint is authoritative for that service session, and a production product should use reviewed owned/contracted relay credentials and capacity.

The SDK source also contains alternate TURN-list origins for specific VDO-owned hostnames. They are not reached by the repository demo or a bundled Tauri WebView under their normal origins; if deployment hostname or SDK configuration changes, inventory actual requests again.

## Internet versus local Wi-Fi

Two devices on the same Wi-Fi may negotiate a direct host or server-reflexive ICE candidate, so application bytes can travel directly between them. That does **not** make the supplied VDO adapter offline or LAN-only:

1. both endpoints first open the external signaling WebSocket;
2. the SDK uses external STUN by default;
3. it requests a TURN list and may relay through TURN;
4. DNS, service availability, network policy, and browser scheduling remain dependencies.

The phone does not browse to the desktop's private IP and the desktop does not need to expose an HTTP port. “Connected over Wi-Fi” should be documented as the access network, while route readback reports `direct`, `relay`, or `unknown`.

If offline LAN operation is required, choose one deliberately:

- raw WebRTC with an authenticated signaling service reachable on the LAN and an ICE policy tested for that topology;
- a local WSS application relay with product authentication, routing, bounds, reconnect, and newest-only coalescing;
- a native companion using an owned transport and the same BRSP envelopes/test vectors.

An HTTPS Internet page connecting to a private-network HTTP/WS service can encounter mixed-content and browser local-network-access restrictions. Use a trusted HTTPS/WSS origin and certificate strategy, explicit user activation, exact host policy, firewall installation guidance, and physical-browser testing. Do not disable browser security or tell users to accept a generic certificate warning.

Primary platform references include the W3C [Mixed Content recommendation](https://www.w3.org/TR/mixed-content/) and Chrome's [Local Network Access update](https://developer.chrome.com/blog/local-network-access?hl=en). Browser policy is evolving; verify the supported versions at release time.

## Static HTTPS Content Security Policy

Serve CSP as an HTTP response header. A restrictive starting profile for the supplied VDO adapter and fully local assets is:

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  connect-src 'self' wss://wss.vdo.ninja https://turnservers.vdo.ninja;
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
  form-action 'self';
```

Keep it on one header line in actual server configuration. Add only resources the audited application really uses. Do not add `unsafe-eval`, `*`, `https:`, a generic `wss:`, arbitrary WebSocket hosts, or a runtime CDN for the SDK.

`frame-ancestors` is not effective from a `<meta http-equiv>` policy; use an HTTP header when clickjacking resistance is required. If the application intentionally embeds, replace `none` with the exact reviewed ancestors and test the product boundary.

CSP does not express all WebRTC STUN/TURN candidate traffic. A page can satisfy `connect-src` while enterprise firewalls still block ICE, UDP, or relay hosts. Test the route on supported networks and explain failures accurately.

## Tauri v2 CSP

A bundled Tauri WebView needs its local IPC paths in addition to the two CSP-visible VDO origins:

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src ipc: http://ipc.localhost wss://wss.vdo.ninja https://turnservers.vdo.ninja; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'"
    }
  }
}
```

Tauri injects hashes/nonces for bundled content as described by its [CSP documentation](https://v2.tauri.app/security/csp/). Test both development and packaged builds: a development URL may require different sources, but release configuration must not inherit a broad dev origin.

Keep the privileged WebView on bundled content. Enabling remote WebView content or granting a remote origin Tauri API access is a material security expansion and is unnecessary for the external-phone topology. The phone remains a normal HTTPS page outside the desktop process.

Capabilities and CSP solve different problems:

- CSP constrains what the WebView may load/connect/execute;
- Tauri capabilities constrain core/plugin API access by window/WebView label;
- Rust validation/policy constrains what an allowed application command may do;
- BRSP proof/scopes constrain the remote peer's application authority.

All four remain necessary at their respective boundaries.

## Native Quest packaged transport WebView

A Quest target can load the pinned VDO SDK and adapter from APK assets through
AndroidX `WebViewAssetLoader` at the reserved HTTPS origin. Because that WebView
has no visible product UI and owns only transport, its document can use a
narrower policy:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self';
               connect-src https://turnservers.vdo.ninja wss://wss.vdo.ninja;
               base-uri 'none'; form-action 'none'">
```

Also disable file/content access, DOM storage when unused, mixed content, and
navigation outside `https://appassets.androidplatform.net/assets/`. Package the
exact SDK/adapter/license bytes; do not load the companion or another remote
origin in the bridge-enabled WebView.

The VDO `transportSecret` may enter this WebView, but the BRSP `pairingSecret`
stays in Kotlin. Expose only generation-bound bounded transport events and
opaque lane payloads. Android warns that native WebView bridges are available
to every frame and can expose application privilege when content or methods are
too broad; see [Android's bridge guidance](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges).

This containment reduces pre-authentication authority but does not prevent a
compromised WebView from forging typed frames after a legitimate session is
ready. See [16](16-native-meta-quest-integration.md) for that residual,
Android/Spatial lifecycle, and APK inspection.

## Serve and cache the pinned SDK correctly

The page should load:

```html
<script src="/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js" defer></script>
<script type="module" src="/app.js"></script>
```

Deployment checks:

- serve JavaScript with an appropriate JavaScript MIME type and no content transformation;
- retain the exact SDK, readable source, MPL-2.0 license, notice, tag, and SHA-256 hashes;
- give versioned SDK assets long immutable caching only while their path is content/version stable;
- ensure HTML/application entry points update coherently rather than mixing old code with a new protocol profile;
- do not cache invitation fragments, pairing secrets, proofs, or session state in a service worker;
- do not let analytics, crash capture, or support screenshots collect room/secret values;
- test a fresh profile with no prior SDK TURN-list cache as well as a warmed profile.

The pinned SDK may cache its TURN server list for a short TTL in browser storage. Treat returned relay credentials/metadata as transient service configuration, keep the origin free of unrelated scripts, and re-review this behavior on an SDK update.

## Invitation delivery

For a static demonstration, room and secret can be transferred manually through a separate trusted channel. A QR fragment may improve usability:

```text
https://controller.example/companion/#room=<id>&secret=<bearer-secret>
```

The fragment is not sent in the HTTP request, but it remains bearer material visible to browser history, copied messages, screenshots, extensions, backups, and people nearby. Verify the companion origin, parse only expected bounded keys, remove the fragment from visible history, keep values in memory, require a separate Connect gesture, expire/revoke the invitation, and clear it on Stop.

For production, prefer a short-lived one-time opaque invitation resolved through the product identity backend, then derive/deliver a fresh session key. Never place a reusable credential or pairing secret in a query parameter.

## Existing-backend WebSocket deployment

When the product already has authenticated browser sessions and a WebSocket service, that backend is often the simpler operational choice. It must provide:

- target/controller authorization and session routing;
- one complete bounded BRSP envelope per WebSocket message;
- separate logical control and state/intent queues;
- newest-only coalescing before replaceable data enters a reliable socket queue;
- per-client/server byte, message, pending-command, rate, and fan-out bounds;
- fresh epoch/proof/session binding or an explicitly specified identity-bound alternative;
- reconnect snapshot and command dedupe retention;
- controller inventory, revocation, abuse limits, logs, and retention policy.

Do not describe WebSocket/TCP as unordered zero-retry delivery. It is reliable and ordered; the adapter can only prevent obsolete values from entering its queue and discard obsolete values at bounded application layers.

## Owned raw-WebRTC deployment

Replacing VDO.Ninja removes that hosted service dependency but adds work:

- authenticated offer/answer and ICE-candidate signaling;
- glare/perfect-negotiation handling;
- STUN/TURN selection, short-lived relay credentials, rotation, capacity, geography, and abuse controls;
- equivalent reliable and unordered zero-retry data channels;
- reconnect/ICE restart, explicit peer ownership, diagnostics, and shutdown;
- operations, service levels, privacy/data inventory, and incident response.

The BRSP application reducer, proof/scopes, bounds, sequencing, revisions, backpressure, freshness, and teardown remain applicable. Signaling authentication may strengthen identity but should not silently change BRSP wire semantics without a named profile/version.

## Network/privacy disclosure

Before Start, explain at least:

- the endpoint will contact external signaling and ICE services;
- direct peers may learn network addresses from the WebRTC path/diagnostics;
- TURN may relay encrypted application traffic and process network metadata;
- forced TURN may add latency and requires observed relay readback at both endpoints;
- the hosted services carry no application availability guarantee from this repository;
- pairing material must be transferred separately and is cleared on Stop;
- a hidden/suspended browser may not keep real-time scheduling.

No camera or microphone permission should be requested for the data-only profile.

## Deployment verification

For each supported origin/app bundle:

1. load fresh and confirm no network session before Start;
2. inspect loaded script URLs/hashes and CSP violations;
3. record signaling/TURN-list requests and selected ICE route without logging secret/IP details in product logs;
4. confirm no media permission prompt and no audio/video track;
5. exercise correct/wrong secret, denied scope, Stop, refresh, reconnect, and target selection;
6. test direct and forced-relay routes with independent readback at both endpoints;
7. test supported home, enterprise/guest, VPN, and cellular networks;
8. test offline, DNS, TLS, proxy, firewall, and service outage presentation;
9. test phone suspend/network transition and native window lifecycle where supported;
10. publish the exact result tier and open gates in [15 — Qualification record](15-qualification-record.md).

Continue with [15](15-qualification-record.md) for the evidence model and the current repository receipt.
