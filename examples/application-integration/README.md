# Application target integration

These two model adapters exercise the same target-side receiver boundary with
different application shapes:

- `affect-target.js` has reliable commands plus high-rate replaceable X/Y
  intent and excludes local LSL diagnostics from its public projection.
- `runner-target.js` has only reliable state-gated experiment commands and
  excludes a private participant path from its public projection.

The application-specific code declares only initial authority state, a public
projection, exact `(scope, action)` reducers, and optional intent reducers.
`BRSPApplicationTarget` derives the callbacks, capabilities, and explicitly
selected grants consumed by `BRSPConnection`:

```js
const application = createAffectTarget();
const connection = new BRSPConnection({
  transport,
  role: "target",
  sessionId,
  sharedSecret,
  ...application.connectionOptions({
    grantedScopes: ["affect.control"],
  }),
});
```

Local application input can use `dispatchLocalCommand()` or
`dispatchLocalIntent()` so local and authenticated remote entrypoints share the
same reducer. The adapter remains transport-independent; it contains no VDO,
WebRTC, WebSocket, Tauri, DOM, filesystem, or process behavior.

These are deliberately small integration examples rather than shipped Affect
Tracker or PPS Runner implementations.
