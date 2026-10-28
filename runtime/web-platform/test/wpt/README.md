# Shared WPT adapter

Unedited fixtures live at their original WPT paths below this directory, for
example `dom/events/Event-constructors.any.js`. Each area owns a manifest and
README in a separate directory such as `events-abort/`. `versions.json` is the
single authority for directory revisions and each imported file's SHA-256 and
Git blob ID. Area manifests describe selected cases and dependencies by path.
Do not patch a copied case or insert a new header into its bytes.

Each WPT directory has one revision; the most specific directory entry governs
a path. Shared `common/` and `resources/` files exist once, at the newest revision
an imported area requires. When either pin advances, rerun the older areas on
the new support files and record changed results. A genuine incompatibility
requires re-importing the affected test directory at the newer revision.
`check.sh` verifies the complete file inventory before running tests, including
support files no selected case executes. Local adapter code is outside the
upstream directory inventory.

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
  exposeSelf?: boolean;
  close(): void | Promise<void>;
}
```

Supply the canonical classes and objects from this package and an ordinary-node
provider that sends exceptions to that reporter. Each file gets a fresh VM
context containing only those supplied globals plus the harness. Node's web API
globals are never inherited. The factory owns any provider-specific setup and
cleanup; the adapter has no events, streams or cryptography implementation.

Set `exposeSelf: true` when an unchanged helper publishes names through `self`.
This aliases the fixture's actual VM global object; it does not provide a
`Window`, `WorkerGlobalScope`, document or another platform API. Direct harness
users select it with the fourth constructor argument, `{ exposeSelf: true }`.
Package code and fixture code can still execute in distinct JavaScript realms.
Supply genuine implementation-realm ECMAScript constructors when a corpus
compares returned value identities. Cases that require a shared literal,
prototype or global realm need an explicit adapter limitation; constructor
injection does not establish full realm equivalence.

Declare every `META: script` dependency in the manifest's support list and pin
its bytes independently. Absolute WPT script references resolve from this
folder; relative references resolve from the fixture's WPT directory. The
adapter rejects unpinned dependencies. `META: timeout=long` selects the WPT long
timeout; the outer `node:test` suite timeout must also accommodate its corpus.
Selected HTML fixtures may contain ordinary inline scripts, the two WPT
harness/report imports, and pinned classic support scripts. HTML helpers are
declared in the fixture's ordered support list and run where their script tags
occur; the complete dependency plan is checked before any fixture code runs.
External origins, server-processing query parameters, modules and async/defer
script execution fail explicitly and need a reviewed adapter extension or a
real browser environment. `../wpt-html-support.test.ts` controls this path.

The shim implements a checked subset of WPT's harness; unsupported calls fail
instead of pretending to pass. Keep its negative controls in
`../wpt-harness.test.ts` when extending it. No DOM, browser lifecycle, cross-realm
exposure or optional platform API is fabricated. Exclusions must name the exact
case and missing capability, and stale exclusions fail the run.

The shared surface includes `test`, `async_test`, serialized `promise_test`,
test steps, global and test-owned `step_timeout`, FIFO cleanup invocation with
awaited promise cleanups, and `setup(callback?, { explicit_done, explicit_timeout })`.
With `explicit_done`, asynchronous registration stays open until global `done()`.
Otherwise, a pending registered test may register further tests; automatic
registration closes when scripts are loaded and the last registered test completes.
An unrelated background promise does not keep registration open. The adapter's
external VM/test/cleanup deadlines remain active with `explicit_timeout`; global
`timeout()` forces a harness failure only when that option is enabled.
Provider-reported errors retain their test ownership across `await`.
Timeout callbacks preserve their receiver and additional arguments. Global
timer exceptions reach the owning test or the harness, and outstanding global
timers are cleared when the fixture finishes.

Assertions cover exact equality, numeric/bigint `assert_greater_than`, arrays,
`assert_in_array`, enumerable object contents, JavaScript and injected DOM
exception classes, `assert_throws_quotaexceedederror`, and the `promise_rejects_js`,
`promise_rejects_dom` and `promise_rejects_exactly` forms. The genuine assertion
error constructor is exposed to fixture helpers. `assert_implements_optional`
reports unsupported optional features as blocked, never passing; its error still
runs the owning test's cleanup. `promise_setup`, browser/worker aggregation and
other setup options are not implemented; using
them fails explicitly. Extend the adapter with specification controls when a
new corpus requires one, without altering that corpus's cases.

Shared helpers exist once under their original WPT paths. Add new originals
and their hashes to `versions.json`; use the existing directory revision, or
re-pin the directory and rerun its consumers together. The adapter is original
TypeScript, not a modified copy of upstream `testharness.js`.
