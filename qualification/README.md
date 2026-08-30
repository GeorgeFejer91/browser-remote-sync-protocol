# Qualification artifacts

Qualification is evidence-bound. Keep these layers separate:

1. `npm run check` proves the deterministic protocol, adapter mocks, repository contract, and application-profile tests.
2. [`browser-smoke.html`](browser-smoke.html) runs the real ES modules, Web Crypto handshake, semantic command, replaceable intent, authoritative state return, and teardown in a browser without contacting a signaling service.
3. Attended VDO.Ninja runs prove signaling, ICE, direct/relay routing, and service interoperability for the pinned SDK.
4. Physical-device records prove touch, backgrounding, WebView behavior, and supported phone/desktop combinations.

Passing a lower layer never implies that a higher layer passed. Do not record an emulated viewport as a physical phone, or a mocked/in-process transport as a VDO.Ninja route.

Serve the repository, then open the smoke page:

```sh
npm run serve
```

<http://127.0.0.1:4173/qualification/browser-smoke.html>

The page is deliberately local and deterministic. It opens no signaling or peer connection and transmits no pairing secret to a third party.
