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

## Native Meta Quest targets

For a native Quest application, keep the immersive Activity and typed native
reducer authoritative. Permission approval, pairing Enable/Accept, application
launch, Guardian/Meta UI, and any kiosk arm remain headset-only. An external
browser must never select an Android component, intent, URL, file, input event,
or native method.

If a bundled WebView hosts the VDO.Ninja adapter, treat it as a lower-trust
transport boundary. Load only packaged pinned assets, block navigation, disable
unneeded file/content/storage access, expose only generation-bound bounded
lane/peer/payload operations, and validate complete BRSP/1 again in Kotlin.
Use independent VDO transport and BRSP pairing secrets so the WebView cannot
complete a new BRSP proof from transport material alone.

That separation is not post-authentication containment. After a legitimate
session reaches `ready`, compromised WebView JavaScript can forge typed frames
within already granted scopes unless the app uses native WebRTC/channel
ownership or a reviewed per-frame MAC extension. Keep grants narrow and short,
make local Stop immediately revoke native authority, and state this residual
risk explicitly.

The hosted Polar Remote Quest companion is a deliberately named
**public-beacon/local-approval profile**, not the default secret-invitation
profile above. Its stable 96-bit Beacon ID deterministically derives discovery
and transcript-binding values, so anyone who knows that public ID can form a
valid controller request. The proof binds the request to the Beacon ID and
transcript; it does not authenticate a person. The Quest must show the exact
requested scopes and withhold proof, ready, commands, and sensitive state until
the wearer presses Accept for that request. Do not transplant this profile into
a production identity boundary without an account-backed one-time invitation,
reviewed PAKE, or equivalent authenticated bootstrap.

The current hosted pilot goes one step further and compiles the same public
Beacon ID into both the Pages controller and one test APK. It therefore needs
no ID field and requests the complete remotely eligible app scope set by
default. This is a public single-headset rendezvous, not authentication: any
visitor can submit the request, concurrent deployments collide in one room,
and the wearer pressing Accept remains the only grant boundary. Never reuse
this fixed-channel mode for multiple or unattended production headsets.

See [the native Meta Quest integration guide](docs/16-native-meta-quest-integration.md)
for the complete boundary and qualification matrix.

## Reporting a vulnerability

Please open a GitHub security advisory for the repository rather than publishing an exploitable report as a normal issue. Include the affected commit, browser and operating system, a minimal reproduction, impact, and whether the problem occurs in the transport-neutral protocol, VDO.Ninja adapter, or demonstration app.

Do not include live pairing secrets, room IDs, IP addresses, or third-party personal data in a report.
