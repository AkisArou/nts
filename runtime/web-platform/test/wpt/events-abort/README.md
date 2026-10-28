# Events and abort: upstream WPT on the source provider

The fixtures in `upstream/` are unedited copies from
[web-platform-tests at fd3d5e4c393a0ee7ff29b7e6c2281e486f7699ee](https://github.com/web-platform-tests/wpt/tree/fd3d5e4c393a0ee7ff29b7e6c2281e486f7699ee).
`manifest.json` records each source path, revision, Git blob ID and SHA-256.
The runner checks both hashes before executing a fixture or support script.
Upstream `LICENSE.md` is copied unchanged. Existing file headers are preserved;
files without a separate header are covered by that BSD-3-Clause licence, rather
than changed to insert a header.

Run from the repository root, using the versions in `.tool-versions` and
`package.json`:

```sh
pnpm install
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/wpt-harness.test.ts runtime/web-platform/test/wpt-events-abort.test.ts
```

`check.sh` names both test files. Its broader existing upstream runner also needs
the Node source checkout installed by `tooling/bootstrap/bootstrap.sh`; this new
corpus is self-contained and needs no checkout or network access at test time.

## What executes

The harness imports `Event`, `EventTarget`, `CustomEvent`, `AbortController`,
`AbortSignal` and `DOMException` from the canonical package barrel. It installs
the existing ordinary-Node provider from `host/node-runtime.ts` for clocks,
timeouts and exception reporting. It does not substitute Node's web classes.

Each fixture receives a fresh VM context. JavaScript files and their pinned
`META: script` dependencies execute unchanged. For the selected HTML files,
the harness extracts ordinary inline script text without changing the file;
only the two WPT harness/report script references are replaced by the Node
test adapter. Other script forms or dependencies fail the harness.

The small `testharness.js` shim implements only the surface used by these files:
`test`, `async_test`, explicit `done`, the eight assertions, test steps, cleanup
and timeout helpers. Unsupported harness functions fail instead of acting as
no-ops. Callback assertion failures are recorded by their owning test even when
the API catches listener exceptions. Cleanup and top-level script errors fail
the file. Registration counts and exact excluded names are checked so a missing
case cannot silently become a pass. The shim has its own negative controls.

The imported implementation and VM have distinct ECMAScript realms. The shim's
`assert_throws_js` recognizes only the exact corresponding host/VM intrinsic
error constructors (including the error's name), not arbitrary same-name values
or subclasses. This adaptation does not claim browser cross-realm coverage.
The `global=window,dedicatedworker` cases run once in this host environment;
the runner does not claim either browser global's exposure or lifecycle behavior.

## Coverage and explicit gaps

The 18 fixture files register 92 cases: 84 execute and eight are capability
blocks. Blocks are emitted as named Node test skips, with reasons, and never
counted as passes:

- Six cases require `Document.createEvent` or real element targets, including
  all three cases in `CustomEvent.html`. CustomEvent construction and dispatch
  still execute through the constructor and subclassing `.any.js` fixtures.
- One requires the package's `Performance` EventTarget, which is a separate API
  contribution.
- One calls `globalThis.removeEventListener`, which needs the provider's global
  event bootstrap. Binding a dummy EventTarget would test the harness instead.

Every other HTML/JavaScript path in the two upstream directories is listed in
the manifest's `excluded` inventory with a reason. The exclusions include DOM
propagation trees, browser globals/realms, input and layout, iframe lifetime,
crash-test infrastructure and their support files. No DOM, Window, Worker or
Performance implementation is fabricated to execute those cases.

The output includes a pass/fail/blocked line for every selected fixture. The
pull request records those lines before and after source fixes. Source-policy
regressions not covered by these upstream cases live in separate local test
files, with specification links; they are not presented as upstream WPT cases.
