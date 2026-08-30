# Contributing

Read the documentation in `docs/` in lexical order before changing protocol behavior. `docs/03-protocol-specification.md` is the normative BRSP/1 contract; code and examples must not silently diverge from it.

## Local gate

```sh
npm run check
npm run serve
```

Then open `http://127.0.0.1:4173/examples/two-browser-demo/`. Verify the idle page, target role, controller role, narrow phone layout, keyboard access, and reduced-motion behavior. A real-network qualification requires two fresh browser instances and the matrix in `docs/08-testing-and-qualification.md`.

## Protocol change rules

- Preserve explicit, user-gesture-owned activation.
- Preserve the separate reliable control and replaceable state lanes.
- Add a version or capability for an incompatible wire change; do not reinterpret an existing field.
- Add strict positive and negative tests for new message types, scopes, bounds, sequencing, deduplication, and teardown.
- Update the threat model, implementation guide, problem ledger, roadmap, and source ledger when affected.
- Never add arbitrary code evaluation or generic DOM/event injection to the reference protocol.
- Keep third-party source, license, version, hashes, and modification status explicit.

No live secret, participant identity, IP address, private signaling receipt, or credential belongs in an issue, fixture, screenshot, or commit.
