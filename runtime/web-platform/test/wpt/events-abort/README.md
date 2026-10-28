# Events and abort: upstream WPT on the source provider

The fixtures in `../dom/events/` and `../dom/abort/` are unedited copies at the
exact directory revisions vendored by Node 24.20.0:

| WPT directory | Revision |
| --- | --- |
| `dom/events` | `0a811c51619b14f78fec60ba7dd1603795ca6a21` |
| `dom/abort` | `dc928169ee38969433af668319a73ed9196ffbee` |

`manifest.json` records each source path, revision, Git blob ID and SHA-256.
The runner verifies both hashes before executing fixtures or support scripts.
Upstream `../LICENSE.md` is copied unchanged. Existing file headers are preserved;
files without a separate header are covered by that BSD-3-Clause licence, rather
than changed to insert a header.

Run from the repository root, using the versions in `.tool-versions` and
`package.json`:

```sh
pnpm install
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/wpt-harness.test.ts runtime/web-platform/test/wpt-events-abort.test.ts runtime/web-platform/test/event-wpt-policy.test.ts runtime/web-platform/test/abort-wpt-policy.test.ts
```

`check.sh` names all four test files. Its broader existing upstream runner also
needs the Node source checkout installed by `tooling/bootstrap/bootstrap.sh`;
this new corpus is self-contained and needs no checkout or network at test time.

## What executes

The driver imports `Event`, `EventTarget`, `CustomEvent`, `AbortController`,
`AbortSignal` and `DOMException` from the canonical package barrel. It installs
the existing ordinary-node provider from `host/node-runtime.ts` for clocks,
timeouts and exception reporting. It does not substitute Node's web classes.

The [shared adapter](../README.md) gives each fixture a fresh VM context.
JavaScript files and their pinned `META: script` dependencies execute unchanged.
For selected HTML files it extracts ordinary inline script text without changing
the file; the WPT harness/report imports are supplied by the node:test adapter.
Other script forms or dependencies fail explicitly.

Callback assertion failures are recorded even when the API catches listener
exceptions. Cleanup and top-level script errors fail the file. Registration
counts and exact excluded names are checked so a missing case cannot silently
become a pass. The shim has its own negative controls.

The imported implementation and VM have distinct ECMAScript realms. Error
assertions recognize the exact corresponding host/VM intrinsic error classes,
not arbitrary same-name values or subclasses. This adaptation does not claim
browser cross-realm coverage. Cases with Window, worker or ShadowRealm META
variants execute once in this host environment; this does not claim those
globals' exposure or lifecycle behavior.

## Coverage and explicit gaps

The 16 fixture files register 89 cases: 82 execute and seven are capability
blocks. Blocks are emitted as named Node test skips and never counted as passes:

- Six cases require `Document.createEvent` or real element targets, including
  all three cases in `CustomEvent.html`. CustomEvent construction and dispatch
  still execute through the constructor and subclassing `.any.js` fixtures.
- One calls `globalThis.removeEventListener`, which needs the provider's global
  event bootstrap. Binding a dummy EventTarget would test the harness instead.

Every other HTML/JavaScript path at these directory revisions is listed in the
manifest's excluded inventory with a reason. Exclusions include DOM propagation
trees, browser globals/realms, input and layout, iframe lifetime, crash-test
infrastructure and their support files. The ShadowRealm-only absence check for
`AbortSignal.timeout` cannot execute in an ordinary host global.

The manifest also records Node's `test/wpt/status/dom/events.json` and
`test/wpt/status/dom/abort.json`. Node lists `Event-isTrusted` as an expected
failure; it remains a normal nts test. Node's runner selects JavaScript tests,
so absence of an HTML file from its status file is not evidence that Node passes
it. Two excluded scrolling files differ in Node's vendor tree; their recorded
upstream hashes refer to original WPT, and no selected fixture has that issue.

The pull request reports per-file before/after counts and a sabotage run against
the package's source implementation, followed by restoration and a passing run.
Source-policy regressions absent from the selected upstream cases live in
separate local test files with specification links. They are not presented as
upstream WPT cases.

Those controls cover listener ordering and mutation, private interface state and
brands, callback invocation, event initialization, signal sequence conversion,
and composite-signal retention. They are included in the strict test TypeScript
project. They do not establish complete prototype independence for every abort
operation: controller-triggered dispatch still uses existing symbol-keyed hooks.

The descriptor-only control for Event interface constants is deferred. The
constructor uses plain `static readonly` declarations because nts compiles
classes to fixed layouts and does not yet support property descriptors. This
removes the descriptor extension introduced by this PR; pre-existing prototype
surface initialization remains outside that change. The deferred local control
is reported as a skip, separately from the seven upstream capability blocks.
