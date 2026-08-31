# 12 — Application target reference architecture

## Decision

Use `BRSPApplicationTarget` as the optional thin boundary between
`BRSPConnection` and application-specific target logic. It centralizes the
receiver work that every application otherwise repeats while leaving the
BRSP/1 wire protocol and transport adapters unchanged.

```text
VDO.Ninja / another transport
              |
              v
       BRSPConnection
 authentication, lanes, wire bounds,
 sequencing, command IDs, snapshots
              |
              v
    BRSPApplicationTarget
 exact registry, public projection,
 revisions, reducer commit/observability
              |
              v
 application-owned domain operations
```

The class is a JavaScript reference model. A Tauri/Rust or Python target may
reproduce the same interface while keeping its native runtime authoritative.
It is not a requirement to move native application state into JavaScript.

## Scope

The target adapter owns:

- a bounded JSON model of authoritative application state for the reference
  implementation;
- one monotonically increasing application revision;
- an exact developer-defined `(scope, action)` command registry;
- at most one complete replaceable-intent reducer per registered scope;
- application argument/control validation;
- defensive copies at reducer and projection boundaries;
- a public state projection that can exclude native/private fields;
- compare-and-set command revision checks;
- serialization of local and remote reliable commands;
- commit guards that prevent a slower intent result from overwriting newer
  accepted intent or a newer application revision;
- local diagnostic events for applied, rejected, superseded, and failed work.

It derives the narrow callbacks and capabilities consumed by
`BRSPConnection`, but requires the caller to select `grantedScopes`
explicitly for every connection.

## Non-scope

The adapter does not own:

- signaling, discovery, ICE, STUN, TURN, or WebRTC;
- VDO.Ninja SDK lifecycle or data-channel backpressure;
- BRSP hello, proof, ready, envelopes, wire sequencing, or command dedupe;
- UI generation, DOM access, native IPC, Tauri capabilities, files, shell, or
  operating-system input;
- accounts, controller identity, invitation approval, or durable policy;
- target-side momentary-control timers/leases;
- native thread, process, device, or experiment lifecycle safety.

Those remain separate owners. In particular, a successful transport send is
not an application commit, and an `applied` response remains the reliable
command confirmation.

## Application interface

An application defines initial authority state, a public projection, command
descriptors, and optional intent descriptors:

```js
const application = new BRSPApplicationTarget({
  profile: "example-app.v1",
  initialState: {
    value: 0,
    privateDiagnostic: "never projected",
  },
  projectState: ({ revision, value }) => ({ revision, value }),
  commands: [{
    scope: "example.write",
    action: "reset",
    reduce: ({ state }) => ({
      state: { ...state, value: 0 },
      result: { value: 0 },
    }),
  }],
  intents: [{
    scope: "example.write",
    validate: ({ controls }) => Number.isFinite(controls.value),
    reduce: ({ state, controls }) => ({
      state: { ...state, value: controls.value },
    }),
  }],
});
```

The target connection then contains no application dispatch switch:

```js
const connection = new BRSPConnection({
  transport,
  role: "target",
  sessionId,
  sharedSecret,
  ...application.connectionOptions({
    grantedScopes: ["example.write"],
  }),
});
```

`connectionOptions()` always includes command acknowledgement, state snapshot,
and latest-state capabilities. It adds `latest-intent` only when at least one
granted scope has an intent reducer. It rejects implicit, duplicate, or
unregistered grants.

## Reducer contract

Command and intent validators receive copied state/payloads and return exactly
`true` to accept. Commands without a validator accept only an empty object,
which makes no-argument actions concise without silently accepting unexpected
fields.

Reducers return:

```js
{
  state: nextAuthoritativeState,
  result: optionalBoundedResult,
  changed: true
}
```

`changed: false` acknowledges an idempotent no-op without increasing the
revision. A state-machine precondition can return:

```js
rejectApplicationAction("command_rejected")
```

Reducer exceptions become the generic wire result `command_failed`; the
specific bounded message is emitted only as a local `applicationerror` event.
This prevents native exception details from becoming remote protocol data.

The adapter replaces any reducer-supplied `revision` with its own revision.
Returned state is copied before commit. Public projection is copied again
before it reaches `BRSPConnection`.

## One reducer for local and remote entrypoints

Local application handlers may use:

```js
await application.dispatchLocalCommand("example.write", "reset");
await application.dispatchLocalIntent("example.write", { value: 0.5 });
```

Authenticated BRSP requests use the same registered reducer through the
connection callbacks. This makes the application operation—not a network or
UI handler—the authority seam.

For a native shell, the equivalent design is:

```text
local native UI --------+
                        +--> native reducer/runtime --> native state
BRSP target adapter ----+
```

The local packaged WebView may host the VDO SDK as a transport shim, but an
external page must not be loaded into a privileged WebView and remote action
strings must not become dynamic Tauri invocation names.

## Two independent consumers

The model examples deliberately exercise different application shapes:

- [Affect-style target](../examples/application-integration/affect-target.js):
  two reliable commands, one high-rate X/Y intent scope, and a projection that
  excludes a local LSL diagnostic;
- [Runner-style target](../examples/application-integration/runner-target.js):
  four reliable state-gated commands, no intent capability, and a projection
  that excludes a private participant path.

Both use the same BRSP connection, transport fixture, revision owner, and
adapter contract. Neither application adapter imports VDO.Ninja, WebRTC,
WebSocket, Tauri, DOM, filesystem, or process APIs.

## Why this improves adaptation

Before this layer, each consumer had to repeat five connection callbacks and
their associated policy:

```text
capabilities + grantedScopes + getState + applyCommand + applyIntent
```

After this layer, connection wiring is one explicit projection:

```text
...application.connectionOptions({ grantedScopes })
```

New application behavior changes a descriptor and its reducer tests; it does
not change VDO connection establishment, BRSP authentication, wire decoding,
or acknowledgement behavior. Replacing VDO with another conforming transport
does not change the application registry.

This is an intrinsic cohesion/coupling improvement, not a network-performance
claim. It removes duplicated receiver policy and makes two independent
consumers testable against the same authority boundary. It adds one module and
one explicit application descriptor layer.

## Observability

`BRSPApplicationTarget` emits bounded local events:

- `statechange`;
- `commandapplied`;
- `commandrejected`;
- `applicationerror`;
- `intentapplied`;
- `intentrejected`;
- `intentsuperseded`.

The events contain profile, scope/action where relevant, source, revision, and
public state where relevant. They do not contain the shared secret, proof,
private authoritative state, transport address, or raw high-rate history.

## Validation

The deterministic suite proves:

- connection options derive only registered, explicitly granted scopes;
- `latest-intent` appears for the Affect-style target and is absent for the
  command-only Runner target;
- public projection prevents local diagnostic/path fields from crossing the
  protocol boundary;
- local intent and commands use the same reducer/revision authority;
- Affect-style intent and reliable reset pass through a complete authenticated
  target/controller BRSP session and return authoritative state;
- Runner state-machine rejection returns an `applied` failure without changing
  revision/state;
- a slow old asynchronous intent cannot overwrite a newer accepted intent;
- duplicate descriptors and implicit scope grants fail closed.

Run:

```sh
npm test
npm run check
```

These tests prove reference-code modularity and deterministic protocol
integration. They do not prove public VDO service behavior, browser lifecycle,
Tauri IPC, Rust/Python interoperability, native background stability, physical
phones, direct/relay route, or application-specific safety.

## Mitigation map

| Risk | Boundary |
| --- | --- |
| Generic remote dispatch | Exact registered `(scope, action)` descriptors |
| Accidental broad grant | Explicit subset-only `grantedScopes` |
| Private native state leak | Required public projection plus defensive copy |
| Stale command overwrite | Expected revision and serialized command reducer |
| Slow intent overwrite | Latest sequence and base-revision commit guard |
| Exception disclosure | Generic wire error; bounded local diagnostic event |
| Transport/application coupling | Application adapter has no transport APIs |
| Framework growth | No UI, identity, signaling, native IPC, or dynamic plugins |

## Next slice

Use the Affect-style model for the first native-shell proof because it exercises
both lanes. Keep VDO.Ninja in a packaged local transport surface, translate
only bounded transport events across native IPC, and implement the same
registry/revision/public-projection contract in Rust. Publish shared canonical
JSON/HMAC fixtures before claiming cross-language BRSP conformance.
