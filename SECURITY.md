# Security policy

BRSP/1 is a narrow application-message protocol, not a remote desktop or a browser sandbox escape. The reference implementation deliberately cannot send arbitrary JavaScript, selectors, DOM operations, keyboard events, credentials, files, or shell commands.

## Security status

This is a pre-1.0 reference implementation. Its protocol and code have automated tests but have not received an independent cryptographic or application-security audit. Do not use it to control medical devices, vehicles, industrial equipment, financial transactions, account recovery, physical access, or another safety-critical action.

## Required production controls

- Generate at least 192 random bits for each pairing secret. Do not use a short human password in production.
- Exchange the room and pairing secret out of band. Never put the secret in a room name, stream ID, public label, log, analytics event, or URL query string.
- Keep the application command allow-list small. Validate every argument again at the target immediately before applying it.
- Grant the minimum scopes. Treat room discovery and a display label as untrusted, even when VDO.Ninja signaling encryption is enabled.
- Keep control and live-state payloads bounded. Enforce rate limits, state freshness, command idempotency, and transport backpressure.
- Require an explicit user action to connect. Give users a visible Stop action and close channels before awaiting signaling teardown.
- Decide whether direct peer IP exposure is acceptable. Use a qualified private TURN service or another architecture when it is not.
- Add authorization, audit records, revocation, expiry, and origin policy appropriate to the application. BRSP's pairing proof is session authentication, not an account system.

## Reporting a vulnerability

Please open a GitHub security advisory for the repository rather than publishing an exploitable report as a normal issue. Include the affected commit, browser and operating system, a minimal reproduction, impact, and whether the problem occurs in the transport-neutral protocol, VDO.Ninja adapter, or demonstration app.

Do not include live pairing secrets, room IDs, IP addresses, or third-party personal data in a report.
