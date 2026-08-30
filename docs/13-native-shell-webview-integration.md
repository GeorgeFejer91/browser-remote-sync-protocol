# 13 — Native-shell WebView and external-browser integration

A Tauri, Electron, or similar desktop application can synchronize with an external browser without turning the native process into a remote shell. The safest first architecture keeps BRSP and WebRTC in the bundled WebView, then crosses the native boundary only through typed application operations.

```text
Smartphone HTTPS companion
  semantic command / latest intent
              |
       BRSP over WebRTC
              |
Desktop bundled WebView
  proof, scopes, validation, projection, Stop
              |
       narrow typed IPC
              |
Native application core
  authoritative privileged state and policy
```

The external browser never receives a Tauri capability, IPC URL, native command name, shell, filesystem, raw sensor stream, or direct native-process connection. It talks only to the authenticated BRSP endpoint in the WebView.

## Decide where authority lives

### Browser-safe scene authority

If the remotely controlled state is presentation-only and already belongs to the frontend, the WebView can own the reducer and publish state directly. Rust does not need to learn remote presentation state.

Use this for a decorative shared scene, a phone-local camera, a temporary overlay layout, or another browser-safe value with no native privilege.

### Native application authority

If a remote action affects recording, persistent settings, acquisition, files, devices, LSL, or another native resource, Rust owns the state and revalidates the action. The WebView's `applyCommand` callback becomes a thin adapter:

```js
import { invoke } from "@tauri-apps/api/core";

async function applyCommand(command) {
  return invoke("apply_remote_party_command", {
    request: {
      commandId: command.commandId,
      scope: command.scope,
      expectedRevision: command.expectedRevision,
      operation: {
        action: command.action,
        args: command.args,
      },
    },
  });
}
```

Rust must not trust the WebView merely because BRSP authenticated its peer. It validates exact scope/action, arguments, revision, caller/window policy, current native preconditions, and rate/safety rules again. Return a stable machine-readable error such as `scope_denied`, `revision_conflict`, or `local_precondition_failed`; do not expose a Rust debug chain.

## A narrow Rust boundary

The native request is a product type, not the BRSP JSON object itself and not an arbitrary command:

```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemotePartyCommand {
    command_id: String,
    scope: String,
    expected_revision: Option<u64>,
    operation: PartyOperation,
}

#[derive(serde::Deserialize)]
#[serde(tag = "action", content = "args", rename_all = "kebab-case")]
enum PartyOperation {
    Reset(EmptyArgs),
    SetPosition(SetPositionArgs),
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyArgs {}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SetPositionArgs { x: f32, y: f32 }
```

The command handler should deserialize/bound, call framework-independent domain logic, and serialize a small result. Avoid a generic `serde_json::Value` dispatch if typed variants can express the profile.

For native-to-WebView state, choose the smallest primitive:

- command for a requested snapshot;
- event for low-volume state edges or small periodic snapshots;
- channel for sustained ordered streaming whose lifecycle and queue are explicit.

Do not send one Tauri IPC event per raw device callback without measuring queue behavior. Coalesce native observations to the application profile, and stop the producer when the owning WebView closes.

## Tauri v2 command exposure

Tauri's current capability documentation states that application commands registered with `invoke_handler` are available to every app window/WebView by default unless the application defines its command manifest. For a privileged remote-control bridge:

1. register only typed product commands;
2. list those commands in `tauri_build::AppManifest`;
3. grant the generated permissions only to the exact bundled window label;
4. inspect the generated schema after Tauri/plugin upgrades;
5. test malformed and denied calls in Rust as well as in the frontend.

A build-manifest skeleton is:

```rust
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "party_snapshot",
                "apply_remote_party_command",
            ]),
        ),
    )
    .expect("failed to build the Tauri command manifest");
}
```

Do not guess the resulting permission identifiers. Generate/inspect `src-tauri/gen/schemas`, then reference the identifiers produced by the Tauri version pinned by the app.

If the WebView only listens to a native event, a capability can remain as small as:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "party-settings-window",
  "description": "Receive bounded native party snapshots in the bundled settings window.",
  "windows": ["settings"],
  "permissions": ["core:event:allow-listen"]
}
```

Do not add shell, filesystem, process, global shortcut, arbitrary HTTP, opener, or broad window permissions for BRSP. Capability files combine when attached to the same label, so audit the union rather than reviewing this file in isolation.

Official Tauri references:

- [calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/);
- [calling the frontend from Rust](https://v2.tauri.app/develop/calling-frontend/);
- [capabilities and application command manifests](https://v2.tauri.app/security/capabilities/);
- [Content Security Policy](https://v2.tauri.app/security/csp/).

## Keep the WebView local and bundled

Load the application frontend and pinned VDO SDK from the packaged frontend distribution. Do not navigate a privileged WebView to the phone site or grant Tauri API access to a remote origin. Open ordinary external links in the system browser through a separately validated product operation.

A Tauri v2 CSP for the pinned default VDO adapter can start from:

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src ipc: http://ipc.localhost wss://wss.vdo.ninja https://turnservers.vdo.ninja; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'"
    }
  }
}
```

Why each non-`self` connection appears:

- `ipc:` and `http://ipc.localhost` are Tauri's WebView IPC paths;
- `wss://wss.vdo.ninja` is the pinned SDK's default signaling host;
- `https://turnservers.vdo.ninja` supplies the pinned SDK's runtime TURN list.

STUN and TURN candidate traffic is handled by the WebRTC stack and is not completely described by CSP `connect-src`. The full SDK/version-specific network inventory and firewall caveat is in [14](14-deployment-network-and-csp.md). Do not add `unsafe-eval`, `*`, a runtime CDN, or a remote WebView origin to make setup easier.

Development builds may use a local dev server and need a deliberately separate development CSP/configuration. Never ship the broad development origin or globally exposed Tauri APIs in a release build.

## Desktop target assembly

On an explicit **Enable phone remote** action in the bundled WebView:

1. ask Rust for a normalized current public snapshot if Rust owns state;
2. generate a fresh room/session ID and 192-bit pairing secret in the WebView;
3. construct `VdoNinjaTransport` as target and `BRSPConnection` as target;
4. grant only the advertised application scopes;
5. show the invitation and privacy boundary;
6. publish target state after mutual proof/ready;
7. render every accepted/resulting state locally;
8. make connected controller, route, RTT, freshness, and Stop visible.

The phone opens a separately hosted HTTPS companion route. It does not connect to a port on the desktop. Both endpoints join the same VDO room, and the SDK negotiates the peer path. A same-Wi-Fi path can be direct, but signaling remains Internet-dependent and the selected route must be read back rather than inferred.

## Native snapshot projection

If Rust emits native observations, translate only the approved public fields:

```js
const unlisten = await listen("party-state-v1", ({ payload }) => {
  const snapshot = validateNativePartySnapshot(payload);
  authoritativeState = {
    revision: snapshot.revision,
    scene: {
      x: snapshot.normalizedX,
      y: snapshot.normalizedY,
      active: snapshot.active,
    },
  };
  session?.publishState(authoritativeState);
  renderDesktop(authoritativeState);
});
```

Never place pairing secrets, proofs, peer addresses, participant physiology, private recordings, or raw acquisition samples in the event. Validate native payloads in JavaScript too: process/version mismatch and compromised frontend inputs remain possible.

For an asynchronous listener registration, teardown must await or eventually call the returned `unlisten` handle even if the WebView starts closing while registration is pending.

## Presentation-only return path

A desktop Party view may display a host-authored aggregate without changing native acquisition/control state:

```text
native local snapshot -> desktop guest offer -> remote host aggregate
remote host aggregate -> desktop WebView presentation only
```

Keep the returned aggregate in a presentation store. Do not call Rust setters, persistence, device output, or LSL publication merely because another host placed the desktop participant in the shared scene. If remote mutation of native state is a real product requirement, add a separate scoped command and native reducer with explicit policy.

This boundary is central to the Affect Tracker implementation at [`9e45c4c`](https://github.com/GeorgeFejer91/affect-tracker-web/tree/9e45c4cdc987a91a8cdb00ec3b52cc335ebcf8cb): both desktop-host/phone-guest and phone-host/desktop-guest Party arrangements exist, while returned scene data remains presentation-only in the desktop WebView and cannot mutate Rust/LSL state.

## Hosting the Party on either endpoint

For a bounded scene, either the desktop WebView or phone browser can be host:

- **desktop host** — desktop owns roster/layout/shared visuals and fans one aggregate to each invited guest;
- **phone host** — phone owns that aggregate and sends it back to the desktop through the existing duplex connection;
- **desktop or phone guest** — sends only its own local normalized intent and renders the authenticated host aggregate;
- **all endpoints** — keep view camera/accessibility projection local and reject aggregates that omit their own fresh participant ID.

The same semantic aggregate can render differently in pixels because the desktop and phone have different aspect ratios and local perspective. Equality claims should name the shared fields, not say “pixel-identical.”

BRSP/1's reference session is one target and one controller. A Party host maintains one independently authenticated session per guest. It is not one universal group key or an unbounded peer mesh.

## Desktop lifecycle

Choose and document what happens on window close, hide-to-tray, app quit, sleep, and update restart.

The WebView session owner must, synchronously in intent:

1. enter `stopping` and reject new remote/local offers;
2. abort input/native-event listeners;
3. cancel rAF, heartbeat, stale, quality, and lease timers;
4. close custom channels and clear pending state/commands;
5. clear invitation/session references;
6. then await BRSP/SDK signaling teardown.

The Rust side independently cancels native producers/channels owned by the destroyed window and neutralizes any native momentary lease. A hidden-to-tray application must not imply that a WebView will receive foreground-grade scheduling; qualify the exact window/OS workflow.

Reload or app restart requires fresh explicit activation, a fresh secret, epoch, nonce, proof, and snapshot. Do not persist automatic remote readiness in frontend storage.

## Security delta from the Affect Tracker case study

The case study is useful architecture evidence but is not BRSP conformance:

| Boundary | Affect Tracker experimental Party transport | BRSP production direction |
| --- | --- | --- |
| Discovery | Shared public experimental room/prefix | Fresh invitation/session discovery |
| VDO password | `password:false` | Fresh secret at SDK signaling layer |
| Application authentication | Stream/peer binding and bounded typed packets, but no BRSP transcript proof | Mutual role-bound HMAC proof or product identity/session key |
| Authorization | Narrow Party behavior by implementation | Negotiated scopes plus exact reducer validation |
| Native mutation | Returned scene is presentation-only; no Rust/LSL mutation | Preserve this boundary unless a separately approved native command exists |
| Qualification | Automated/CI evidence; no physical phone↔Tauri session | Publish an explicit native-shell/physical-device matrix |

Do not copy the case study's public/passwordless discovery into a generalized controller. Use it to learn host fan-out, reciprocal desktop/browser topology, projection, stale behavior, CSP, and native isolation.

## Native-shell acceptance gates

- Bundled WebView assets and pinned SDK load without a runtime CDN.
- No connection exists before a current Enable/Connect gesture.
- Exact window label and capability union are reviewed.
- Custom app commands are constrained through the Tauri command manifest where privilege requires it.
- Rust rejects malformed, oversized, out-of-scope, unsupported, stale-revision, and wrong-precondition requests.
- External browser cannot access native IPC or navigate the privileged WebView.
- Native state and BRSP state have explicit authority/translation rules.
- Presentation-only returned Party state cannot mutate Rust, storage, devices, or LSL.
- Stop, page close, hide/quit, and failed Start quiesce all producers before network cleanup.
- Dev and packaged CSP/builds are tested separately.
- Same-machine WebView/browser, physical phone/WebView, direct, forced relay, sleep/wake, and window lifecycle results are separate qualification rows.

Continue with [14 — Deployment, network, and CSP](14-deployment-network-and-csp.md), then record exact evidence using [15 — Current qualification record](15-qualification-record.md).
