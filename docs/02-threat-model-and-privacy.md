# 02 — Threat model and privacy

## Security boundary

BRSP/1 protects a live session between two browser instances that already share a high-entropy secret through a separate trusted channel. It authenticates possession of that secret and negotiates bounded capabilities/scopes before application messages are accepted.

It is not an account identity system, public-key infrastructure, invitation service, durable authorization database, malware sandbox, remote desktop, or safety-certified control channel.

## Assets

An application should identify at least these assets:

- authority to invoke each remote action;
- confidentiality and integrity of command arguments and state;
- the pairing secret;
- room/session and stream identifiers;
- IP address and network metadata;
- application state and private labels;
- availability of the target and controller;
- audit evidence, if the product requires it;
- the user's ability to understand and stop the connection.

## Actors

- **Target user**: operates the application that owns authoritative state.
- **Controller user**: sends scoped requests.
- **Room observer**: can discover or imitate signaling entries if room access is weak or leaked.
- **Connected malicious peer**: reaches the WebRTC data path but lacks or has stolen the pairing secret.
- **Authorized but abusive controller**: passes authentication but attempts out-of-scope, malformed, excessive, or dangerous actions.
- **Network/service infrastructure**: signaling, STUN, TURN, hosting, DNS, CDN, and browser vendors.
- **Local attacker or extension**: may read page content, input, browser storage, or process memory outside BRSP's protection.

## Trust statements

### What WebRTC provides

WebRTC data channels use SCTP over DTLS over ICE. The standardized stack provides confidentiality, integrity protection, and transport peer authentication for the negotiated connection. It does not by itself tell the application that the peer is the intended person or is authorized for `scene.write`.

### What VDO.Ninja provides

The SDK performs signaling and helps negotiate direct or TURN-relayed WebRTC. Its password option can hash room/stream identifiers and encrypt SDP/ICE signaling material. These are valuable protections, but BRSP does not treat a room password, listing, source label, peer UUID, or successful `view()` as application authorization.

VDO.Ninja's current privacy documentation states that direct P2P peers may see one another's IP addresses; STUN learns network information; TURN can relay encrypted traffic; service/providers process operational metadata; and Cloudflare may receive full request URLs including query parameters. The service terms do not promise availability, security, or error-free operation. Review the current binding policies for each deployment rather than relying on this repository's summary.

### What the BRSP proof provides

The mutual proof binds both hello envelopes and roles to possession of the same secret:

```text
HMAC-SHA-256(
  pairing secret,
  "BRSP/1 proof" || sender role || canonical target/controller hello transcript
)
```

The transcript includes session ID, peer IDs, epochs, nonces, capabilities, and requested/granted scopes. Role-specific input prevents one side's proof from being reflected back as the other's.

This is a symmetric-key session proof. Anyone who learns the secret can impersonate either role. It provides no long-term identity, non-repudiation, certificate validation, account revocation, or protection from a compromised endpoint.

## Pairing-secret rules

- Generate at least 192 random bits for production sessions. The demo uses `crypto.getRandomValues()` and base64url encoding.
- Treat a 6-digit code or memorable password as insufficient for this direct HMAC design. A recorded transcript permits offline guessing. If human-entered short codes are required, use a reviewed PAKE such as SPAKE2/OPAQUE through a proven library and protocol, not ad-hoc repeated hashing.
- Exchange the secret through a separate trusted channel or a QR code physically shown by the target. Do not send it over the unauthenticated BRSP channel it is meant to authenticate.
- Do not include it in a URL query, room name, stream ID, label, analytics event, console log, issue, screenshot, or recording.
- A URL fragment is not sent in the HTTP request, but it can still leak through browser history, copied messages, screenshots, extensions, or local compromise. Treat invite links as bearer secrets and expire them.
- Generate a new secret and session ID for every session. Reload must not silently resume.

The reference code enforces a minimum of 16 UTF-8 bytes only to reject obviously weak/empty values in tests and local experiments. That minimum is not the production recommendation.

## Threats and mitigations

| Threat | Consequence | Required mitigation |
| --- | --- | --- |
| Guessable/shared room ID | Unwanted discovery, connection attempts, metadata exposure | Random per-session room ID; never rely on it for authentication |
| Friendly source-name spoofing | User selects an impostor | Treat labels as display-only; verify BRSP proof; show authenticated role/state |
| Secret theft | Full session impersonation | High entropy, out-of-band transfer, short lifetime, no logging/storage, explicit stop/rotation |
| Replay from an old connection | Old command or state applied | Fresh peer epoch and nonces; hello transcript proof; per-epoch unsigned sequence; unique command ID; target dedupe |
| Duplicate reliable command | Action applied twice | Idempotent action design and bounded command-result cache; durable dedupe when reconnect retries are supported |
| Reordered/late state | Scene regresses | Per-epoch unsigned half-range sequence rejection; replaceable state lane |
| Oversized/deep JSON | Memory/CPU denial of service | 16 KiB control, 8 KiB state, finite numbers, depth/array/key/token bounds before application dispatch |
| Flood of valid commands | Target or UI overload | One pending command in demo; per-scope rate limits; bounded reliable backlog; disconnect abusive peer |
| Reliable queue growth | Seconds of delayed control or memory pressure | 256 KiB adapter cap; observe `bufferedAmount`; refuse/close or apply explicit bounded retry policy |
| Live-state queue growth | Old movement replays later | Unordered zero-retry lane; send only when no queued bytes; retain one newest state |
| Unauthorized command | Application compromise | Exact action allow-list, negotiated least-authority scope, validate at target, never dispatch arbitrary names dynamically |
| Prototype/property abuse | Object graph manipulation | Reject unsafe field names; parse into bounded JSON; copy only expected fields into typed state |
| State/intent feedback loop | Oscillation or host-authored state echoes upstream | Separate local intent, authoritative state, and presentation variables |
| Direct peer IP exposure | Privacy/network information leak | Disclosure and consent; qualified TURN/VPN/private infrastructure; verify actual route rather than requested mode |
| TURN/service outage | No connection or higher latency | Visible failure, retry budget, self-hosted/contracted infrastructure, alternate adapter; never promise hosted-service availability |
| Hidden-tab scheduling | Late messages and stale UI | Foreground workflow, lifecycle visibility, receiver-local freshness, hold-last semantics; do not claim timers override OS scheduling |
| Cross-site scripting in host app | Secret/state theft and arbitrary actions | Strong CSP, output encoding, dependency control, no `eval`, application security review |
| Compromised vendored SDK | Transport/application compromise | Pin exact version/source/license/hash; review updates; serve locally with CSP; dependency/security process |

## Scopes are necessary but not sufficient

The controller requests scopes and the target grants scopes in `hello`. Both compute the intersection. An action is permitted only if its scope appears in that intersection.

Still validate every command at the target:

```js
if (command.scope !== "scene.write") reject("scope_denied");
if (command.action !== "set-scene") reject("unsupported_command");
if (!finiteAndInRange(command.args.scene.x, -1, 1)) reject("invalid_argument");
if (command.expectedRevision !== currentRevision) reject("revision_conflict");
```

Do not turn a scope into a dynamic module name, function lookup, URL, selector, SQL fragment, shell string, or code expression. Scope negotiation limits a pre-existing allow-list; it does not create new capabilities at runtime.

## Direct versus relay privacy

Direct routing generally offers lower latency and avoids relaying application bytes through a TURN server, but peers may learn one another's IP addresses. TURN hides the peer's direct address from the other endpoint by placing a relay in the path, while the relay provider handles encrypted traffic and network metadata.

Forcing TURN is a request, not proof of the selected route. The implementation that inspired this repository exposed independent peer-quality readback and required both endpoints to report a relay route during qualification. Follow the same rule: never label a session private/relayed merely because a configuration checkbox was set.

Public/free TURN infrastructure is valuable for development but is not a production service-level agreement. Capacity, location, logging, retention, acceptable use, and incident response must match the application.

## VDO.Ninja SDK and signaling boundary

Use the official SDK. Its upstream documentation warns that direct use of the private signaling WebSocket API is not approved and may be blocked or changed. BRSP does not reverse engineer or stabilize that private protocol.

The signaling server is not the application-data relay in the reference pattern. Application payloads use WebRTC data channels. Do not enable WebSocket data fallback silently: it changes routing, privacy, delivery, and availability assumptions. If an adapter intentionally supports fallback, negotiate and expose it as a distinct transport path.

## Data minimization

Remote control should send only what the peer needs:

- normalized state rather than raw pointer trajectories;
- a named command rather than a keyboard event;
- public participant labels rather than private identities;
- the current scene rather than application databases or recordings;
- receiver-local packet age rather than transmitting unnecessary wall-clock timestamps;
- no credentials, cookies, access tokens, participant physiology, analytics identifiers, or local camera perspective unless explicitly required and reviewed.

The application should decide separately whether BRSP state belongs in durable logs. The reference demo keeps a bounded on-screen session log and never logs the pairing secret or every state frame.

## Browser and origin security

Production deployments should:

- serve over HTTPS (localhost is suitable for local development);
- use a restrictive Content Security Policy and local/pinned scripts;
- set `connect-src` only for the signaling/STUN/TURN endpoints actually required;
- avoid third-party analytics on pages containing pairing material;
- clear session values on Stop/page close;
- prevent embedding unless explicitly supported (`frame-ancestors`);
- review service workers and caches so secrets/state are not persisted;
- display authenticated role, scope, route, stale state, and Stop accessibly;
- protect the host application from XSS before treating BRSP authentication as meaningful.

## Safety boundary

BRSP/1 is not suitable by itself for an actuator or high-consequence workflow. Those systems need independently reviewed identity, authorization, command interlocks, state-machine safety constraints, rate/energy limits, emergency stop, audit, redundancy, failure analysis, and often certified protocols.

## Next

Read the normative [03 — BRSP/1 protocol specification](03-protocol-specification.md). Normative “MUST,” “MUST NOT,” “SHOULD,” and “MAY” statements there define interoperability for this repository.
