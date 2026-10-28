# Shared WPT adapter

Unedited fixtures live at their original WPT paths below this directory, for
example `dom/events/Event-constructors.any.js`. Each area owns a manifest and
README in a separate directory such as `events-abort/`. The manifests record the
exact revision, SHA-256 and Git blob ID of each fixture, support file and licence.
Do not patch a copied case or insert a new header into its bytes.

## Reuse from another specification area

`harness.ts` supplies the `testharness.js` adaptation. `runner.ts` supplies
`runWptFixtures(suite, root, manifest, createEnvironment)`, which verifies the
pinned files, loads their declared support scripts and reports each result as a
`node:test` subtest. The events/abort driver is a complete example at
`../wpt-events-abort.test.ts`.

The environment factory receives an exception reporter and returns:

```ts
interface WptEnvironment {
  globals: Record<string, unknown>;
  close(): void | Promise<void>;
}
```

Supply the canonical classes and objects from this package and an ordinary-node
provider that sends exceptions to that reporter. Each file gets a fresh VM
context containing only those supplied globals plus the harness. Node's web API
globals are never inherited. The factory owns any provider-specific setup and
cleanup; the adapter has no events, streams or cryptography implementation.

Declare every `META: script` dependency in the manifest's support list and pin
its bytes independently. Absolute WPT script references resolve from this
folder; relative references resolve from the fixture's WPT directory. The
adapter rejects unpinned dependencies. `META: timeout=long` selects the WPT long
timeout; the outer `node:test` suite timeout must also accommodate its corpus.
Selected HTML fixtures may contain ordinary inline scripts and the two WPT
harness/report imports. Other HTML script forms fail explicitly and need a
reviewed adapter extension or a real browser environment.

The shim implements a checked subset of WPT's harness; unsupported calls fail
instead of pretending to pass. Keep its negative controls in
`../wpt-harness.test.ts` when extending it. No DOM, browser lifecycle, cross-realm
exposure or optional platform API is fabricated. Exclusions must name the exact
case and missing capability, and stale exclusions fail the run.

Node 24.20 pins harness `resources` to
`6a2f32237615d7ea9c1eb1e30453066b5555c603` and `common` to
`dbd648158d337580885e70a54f929daf215211a0`. Use those revisions when importing
helpers from those directories. The adapter is original TypeScript, not a
modified copy of upstream `testharness.js`.
