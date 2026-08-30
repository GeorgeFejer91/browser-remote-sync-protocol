# Browser Remote Sync Protocol

BRSP/1 is a documented, transport-neutral way for one browser application to control and synchronize with another. It sends typed application meaning—commands, acknowledgements, snapshots, and live state—not video frames, raw pointer events, DOM access, or arbitrary code.

The first adapter uses VDO.Ninja's **data-only WebRTC path**. No camera or microphone is requested. One endpoint calls `announce()`, the other calls `view(..., { audio: false, video: false })`, and the resulting publisher/viewer connection carries data in both directions.

> **Is a video tool efficient when the application only sends symbols?**
>
> Video encoding is not. VDO.Ninja is still useful because its SDK also wraps WebRTC discovery, signaling, ICE/STUN/TURN traversal, recovery, and bidirectional `RTCDataChannel`s. Use that data layer directly. If you already operate an authenticated WebSocket backend and do not need peer-to-peer routing, WebSocket may be operationally simpler; BRSP is designed so the application protocol can move between those transports.

## What is in this repository

- A normative [BRSP/1 wire and handshake specification](docs/03-protocol-specification.md).
- A reusable [transport-neutral JavaScript implementation](src/brsp.js).
- A pinned [VDO.Ninja SDK 1.5.5 adapter](src/vdo-ninja-transport.js) with no media capture.
- A [runnable two-browser example](examples/two-browser-demo/index.html) in which a controller changes a target-owned scene and both screens converge on the target's returned state.
- A copyable [application-integration starter](examples/application-integration/README.md) with exact reducers, smartphone intent, a target-enforced dead-man lease, explicit lifecycle, and deterministic tests.
- A dedicated [Marionette smartphone companion profile](docs/11-marionette-companion-profile.md) for fast touch controls, target leases, QR pairing, phone lifecycle, accessibility, and local-only pan/pinch perspective.
- Last-mile recipes for a [browser target plus phone](docs/12-app-integration-recipes.md), a [native-shell WebView plus external browser](docs/13-native-shell-webview-integration.md), and [deployment/network/CSP](docs/14-deployment-network-and-csp.md).
- A tiered [qualification record](docs/15-qualification-record.md) that separates deterministic browser evidence, VDO route evidence, physical-device evidence, and native-shell evidence.
- A detailed [problem/solution ledger](docs/06-problems-and-solutions.md) extracted from building and physically qualifying Affect Tracker's remote Flubber, Universe, settings beacon, and Party modes.
- Architecture, privacy, implementation, testing, transfer patterns, source provenance, and a production roadmap.

## The core architecture

```text
                 signaling / discovery only
      Target  <---------- VDO.Ninja ---------->  Controller
         |                                           |
         +====== one WebRTC peer connection =========+
         |                                           |
         +-- reliable ordered control channel -------+
         |   hello, proof, ready, command, applied,
         |   snapshot-request, snapshot, error, bye
         |
         +-- unordered zero-retry live channel ------+
             controller intent --------------->
             <---------------- authoritative state
```

The control lane is reliable and ordered because commands and acknowledgements must not be silently skipped. The live lane uses `ordered: false, maxRetransmits: 0` because an obsolete position or slider value is less useful than the newest one. If its browser send queue is non-empty, the adapter retains only the newest pending intent/state rather than building a delayed history.

The target is authoritative:

1. Both peers exchange versioned `hello` messages with random nonces, roles, capabilities, and requested/granted scopes.
2. Both prove possession of a separately shared secret with HMAC-SHA-256 over the complete, canonically ordered hello transcript.
3. Both independently compute the same capability/scope intersection and exchange `ready`.
4. The controller sends a scoped command with a unique ID and optional expected revision.
5. The target validates and applies it once, returns `applied`, and publishes the resulting authoritative state.
6. Both screens render that returned state. The controller never treats “sent” as “applied.”

## Run the example

Requirements: Node.js 20 or newer and two browser instances with WebRTC access.

```sh
npm run check
npm run serve
```

Open `http://127.0.0.1:4173/examples/two-browser-demo/` in two fresh browser windows.

1. In the first window, keep **Target app** selected and press **Start target**. This explicit action generates a unique room and a 192-bit pairing secret when the fields are empty.
2. Transfer the displayed room and secret to the second person through a separate trusted channel. Do not publish either value in an issue or screenshot.
3. In the second window, choose **Controller app**, paste both values, and press **Start controller**.
4. Wait until both screens show **Mutually authenticated**. Move the controller sliders. They send coalesced current intent; the target applies it and sends authoritative state back to both displays. Reset is a reliable command and clears pending only after its `applied` acknowledgement.
5. Press **Stop** on both endpoints. Refreshing never reconnects automatically.

The example loads the official SDK from the repository's local `vendor/` directory. It does not depend on a runtime CDN, request media permission, or open a connection on page load.

## Integrate it into an application

Start with the [application-integration starter](examples/application-integration/README.md), not by copying the demo's UI. It separates:

- a target-owned typed reducer and Marionette manifest;
- reliable semantic commands from replaceable current intent;
- authoritative state from local intent and presentation;
- momentary controls with a target-local lease from persistent controls with explicit hold behavior;
- session lifecycle from the chosen transport.

Then choose the matching guide:

- [browser target and smartphone companion](docs/12-app-integration-recipes.md);
- [Tauri/native-shell WebView and external browser](docs/13-native-shell-webview-integration.md);
- [static hosting, exact pinned VDO network inventory, LAN caveats, and CSP](docs/14-deployment-network-and-csp.md).

A desktop WebView and phone on the same Wi-Fi can negotiate a direct WebRTC route, but the supplied VDO adapter still needs Internet signaling and external ICE infrastructure. It is not offline LAN discovery. An offline deployment needs owned authenticated signaling/raw WebRTC or an authenticated local WebSocket adapter.

## Choose the transport deliberately

| Situation | Best starting point | Why |
| --- | --- | --- |
| Two browsers, low-latency state, no backend, NAT traversal needed | VDO.Ninja data-only adapter | Reuses managed signaling and WebRTC traversal while payloads stay peer-to-peer or TURN-relayed. |
| Existing authenticated application backend, many users, centralized policy/audit | WebSocket adapter | Simpler authority, fan-out, revocation, observability, and reconnect semantics. |
| Direct peer connection with infrastructure you control | Raw WebRTC adapter | Full control of signaling, ICE servers, identity, and operations; more engineering. |
| HTTP/3 client-to-server streams/datagrams | WebTransport adapter | Useful for modern server-mediated transport; it is not browser-to-browser signaling by itself. |
| Pixel-perfect arbitrary legacy UI remote operation | Established remote-desktop stack | BRSP intentionally synchronizes application semantics, not pixels or unrestricted input. |

BRSP does not pretend these transports are equivalent. Its envelopes, authentication transcript, scopes, revisions, sequencing, and authority rules remain stable while an adapter supplies connection establishment and delivery semantics.

## Non-goals

- No arbitrary JavaScript, `eval`, DOM selector, event injection, shell command, or remote file execution.
- No screen/video/audio transmission.
- No accounts, long-term identity, revocation service, audit database, or authorization policy engine.
- No guarantee that a browser tab continues real-time work when backgrounded or the operating system suspends it.
- No safety-critical control.
- No claim that room secrecy or a friendly source label authenticates a person.
- No global multi-user consensus protocol. The documented Party pattern is a bounded authoritative host fan-out.

## Documentation map

Read in order for the full transfer guide:

1. [Overview and efficiency decision](docs/00-overview.md)
2. [Architecture and authority](docs/01-architecture.md)
3. [Threat model and privacy](docs/02-threat-model-and-privacy.md)
4. [Normative BRSP/1 protocol](docs/03-protocol-specification.md)
5. [Exact VDO.Ninja adapter setup](docs/04-vdo-ninja-adapter.md)
6. [Implementation guide](docs/05-implementation-guide.md)
7. [Problems encountered and solutions](docs/06-problems-and-solutions.md)
8. [Transferable patterns and use cases](docs/07-patterns-and-use-cases.md)
9. [Testing and qualification matrix](docs/08-testing-and-qualification.md)
10. [Roadmap](docs/09-roadmap.md)
11. [Sources and provenance](docs/10-sources-and-provenance.md)
12. [Marionette smartphone companion profile](docs/11-marionette-companion-profile.md)
13. [Copyable application integration recipes](docs/12-app-integration-recipes.md)
14. [Native-shell WebView and external browser](docs/13-native-shell-webview-integration.md)
15. [Deployment, network inventory, and CSP](docs/14-deployment-network-and-csp.md)
16. [Qualification tiers and current record](docs/15-qualification-record.md)

## Status and provenance

BRSP/1 is a pre-1.0 reference protocol. Automated tests cover encoding, bounds, unsigned sequencing, mutual proof, scope negotiation, command acknowledgement and dedupe, authoritative state/freshness, negotiated smartphone live intent, exact application validation, target leases, explicit selection, VDO data-only activation, delivery modes, newest-only backpressure, and teardown. A deterministic [browser smoke fixture](qualification/README.md) exercises the real ES modules and Web Crypto without contacting signaling. The [current qualification record](docs/15-qualification-record.md) states the higher network, physical-device, and native-shell gates that remain open. The security limitations in [SECURITY.md](SECURITY.md) apply.

The design is derived from the public Affect Tracker implementation and its attended VDO.Ninja qualification evidence, then generalized into a transport-neutral protocol. The newer desktop/browser Party case study at [`9e45c4c`](https://github.com/GeorgeFejer91/affect-tracker-web/tree/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb) demonstrates reciprocal desktop/phone host/guest topology and presentation-only desktop return; it remains an experimental public/passwordless architecture case study rather than BRSP authentication evidence. Exact source versions, standards, measured findings, security deltas, and code-reuse status are recorded in [the source ledger](docs/10-sources-and-provenance.md).

Repository-authored material is MIT licensed. The vendored VDO.Ninja SDK retains MPL-2.0; see [third-party notices](THIRD_PARTY_NOTICES.md).
