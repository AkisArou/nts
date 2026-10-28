# Global errors and rejection notifications: source policy

This change implements the source-owned parts of HTML's `reportError()`,
`onerror`, `onunhandledrejection` and `onrejectionhandled`. The native binding
for the actual global event target, error metadata and Promise host hooks is
still required. The executable conformance claims below cover source policy
over an explicit test contract, not an existing production global binding.

## Specification and implementation

The relevant HTML Living Standard algorithms are:

- [Runtime script errors](https://html.spec.whatwg.org/multipage/webappapis.html#runtime-script-errors),
  including [report an exception](https://html.spec.whatwg.org/multipage/webappapis.html#report-an-exception)
  and [`reportError`](https://html.spec.whatwg.org/multipage/webappapis.html#dom-reporterror).
- [Event handlers](https://html.spec.whatwg.org/multipage/webappapis.html#event-handlers),
  including registration position, deactivation, and the event handler
  processing algorithm.
- [Unhandled promise rejections](https://html.spec.whatwg.org/multipage/webappapis.html#unhandled-promise-rejections)
  and [HostPromiseRejectionTracker](https://html.spec.whatwg.org/multipage/webappapis.html#hostpromiserejectiontracker).

`src/core/global-errors.ts` owns the reporting guard, event creation,
cancellation rules, handler slots, rejected-promise list and outstanding weak
set. `src/provider/global-errors.ts` describes the infallible operations it
needs from the engine. It does not inspect `.then`, attach Node process
listeners, parse an exposed stack, or read a supplied exception's properties.

The source dispatcher reads the current handler through `globalThis` once for
each invocation. Changing a non-null handler preserves its listener position;
clearing it removes the listener, and reactivation registers at the new
position. A global `ErrorEvent` named `error` invokes `onerror` with five
arguments; exactly `true` cancels. Ordinary events use one argument; exactly
`false` cancels. Callback exceptions re-enter the reporting algorithm, whose
per-global guard suppresses recursive error-event dispatch.

The promise policy snapshots the about-to-be-notified list at the checkpoint,
checks the native handled state again when the queued task executes, and
keeps outstanding promises in a `WeakSet`. It checks handled state after the
event dispatch as well. Handling a pending promise suppresses its notification;
handling an outstanding one queues a non-cancelable `rejectionhandled` event.
Canceling `unhandledrejection` suppresses the optional console report and does
not remove an otherwise unhandled promise from the outstanding set.

## Provider and bootstrap contract

Construct one `GlobalErrorRuntime` per provider global. It needs:

| Boundary | Required behavior |
| --- | --- |
| `globalObject`, `resolveGlobalReporter` | Identify the actual global or WindowProxy and resolve a borrowed global method's receiver. |
| `extractErrorInformation` | Supply implementation-defined message, filename, line, column and the selected script's muted-errors flag without script-visible input reads or coercion. |
| `addGlobalEventListener`, `removeGlobalEventListener` | Add and remove internal non-capture listeners in the actual global's listener list. |
| `dispatchGlobalEvent` | Dispatch a trusted canonical event at that actual global; preserve target/currentTarget identity, callback realm, HTML callback cleanup and listener-exception reporting. Apply scripting and active-document checks when relevant. |
| `enqueueGlobalTask` | Queue the DOM manipulation task source; never run the task inline. |
| `promiseIsHandled`, `promiseResult` | Read real Promise internal slots; never public properties or a thenable. |
| Console sinks | Perform the embedder's optional reporting without throwing into source. |
| Optional `dedicatedWorkerOwner` | Queue owner-realm dispatch at the real Worker object, including terminated/disentangled-worker rules. Source constructs the sanitized error event and performs further propagation with `omitError`. |

All these operations are infallible capability operations. A provider must
not advertise the capability until those boundaries are real. The source
does not use a detached `EventTarget` as a substitute for the global, and it
does not fabricate script positions or location URLs.

The later bootstrap PR exposes `runtime.reportError` on the actual global.
It is an ordinary receiver-aware callable: a bare call defaults to the
owning global; a method borrowed onto another real global is resolved by the
capability. Calling it as `runtime.reportError(value)` gives the runtime
object as its receiver and is not how the global API is exposed.

Bootstrap's handler accessors must forward to the runtime's backing accessors
(`runtime.onerror`, `runtime.onunhandledrejection` and
`runtime.onrejectionhandled`). Those backing getters do not read `globalThis`,
so the forwarders do not recurse. Source code never assigns to `globalThis`.
The actual handler callback must execute in the owning global's environment;
an imported source function in a different Node VM does not acquire a new
lexical global merely by changing its `this` value.

The compiler calls `hostPromiseRejectionTracker` for the correct script/settings
global, with the actual reject/handle operation and muted-errors state. After
the real microtask checkpoint it calls `notifyRejectedPromises`. No source
observer can supply these automatic engine hooks. The current deterministic
tests invoke these entry points explicitly.

## Upstream corpus and exclusions

The unchanged file is
[`html/webappapis/scripting/reporterror.any.js`](https://github.com/web-platform-tests/wpt/blob/2b38ea1cb920a2d0f91bf140d0e1eba73db8e742/html/webappapis/scripting/reporterror.any.js)
at WPT revision `2b38ea1cb920a2d0f91bf140d0e1eba73db8e742`, Git blob
`b9e7ba25bc6a3938783f7bf32472ba422e815ae2`. Its inherited BSD licence is retained
in `LICENSE.md`; the upstream file has no per-file licence header to modify.
`global-errors-manifest.json` records the source URL, SHA-256, registration
inventory and exact named blocks. `global-errors-results.json` records the
measured output, source hashes, commands and source commit.

The fixture runs in the shared runner's fresh `node:vm` context with the
canonical source callable. Its two source-only cases use a deterministic
capability contract. That driver is test infrastructure: it records dispatch
and reporting, and gives the source opaque Promise state in local tests. It
is not an ordinary-node production implementation of the missing capability.

These three registrations remain named `provider-capability` blocks:

- `self.reportError(1)`
- `self.reportError(TypeError)`
- `self.reportError(undefined)`

They require actual-global event dispatch and native extraction of script
filename/line/column, which this source PR cannot supply. No fake `location`,
`Window`, `Document` or `URL` is installed to make those cases pass.

The manifest also inventories 19 excluded upstream paths with exact revision,
blob and reason. These include real Window/cross-realm and detached-Window
cases; automatic rejection/checkpoint integration; worker lifecycle and
cross-origin muted-error cases. The PromiseRejectionEvent constructor case
already belongs to B1 and is recorded rather than duplicated. Support files
are included in that path count; it is not a count of failed test cases.

## Results

Measurements use Node `v24.20.0`. They apply to the source and adapter hashes
recorded in `global-errors-results.json`.

| Per-file WPT run | Pass | Fail | Named blocks |
| --- | ---: | ---: | ---: |
| Same corpus and final adapter with the new API absent | 1 | 1 | 3 |
| Implemented source policy | 2 | 0 | 3 |
| Sabotage: read the exception's public `message` first | 1 | 1 | 3 |
| Exact source bytes restored | 2 | 0 | 3 |

The API-absence run is an explicit baseline model, not a historical full-gate
checkout. Its required-argument case is a false-positive pass: calling an
absent method also throws `TypeError`. The focused controls additionally
require a callable with the correct name, arity and receiver behavior. The
getter case fails in that baseline because the API is missing.

The focused source-policy file passes all 34 controls, covering argument and
receiver handling, value identity, synchronous dispatch, metadata
non-observation, handler ordering and cancellation, nested errors, muting,
worker propagation, and rejected-promise timing/retention policy. The five new
adapter controls and all 22 unchanged adapter controls pass. The combined
Node test command reports **68 entries: 65 pass, 0 fail, 3 skipped**. That
aggregate includes the WPT file and suite containers; the per-file table
counts only the five upstream registrations.

```sh
node --expose-gc --test --test-isolation=none --test-reporter=tap \
  runtime/web-platform/test/global-errors-policy.test.ts \
  runtime/web-platform/test/global-errors-harness-policy.test.ts \
  runtime/web-platform/test/wpt-global-errors.test.ts \
  runtime/web-platform/test/wpt-harness.test.ts

pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
```

Both strict TypeScript projects exit successfully. Compilation with nts and
actual-global/native Promise integration are **not verified** here. The
stacked full suite and compiled checks belong to the integration gate, and
are not claimed by this report.

### Shared adapter changes

`harness.ts` adds `allow_uncaught_exception` only when the environment opts
into `uncaughtExceptionChannel`. Its new `reportUncaughtException` path is
separate from assertion, registration, cleanup and ordinary error failures.
`runner.ts` supplies that distinct callback and forwards the environment's
opt-in. `tsconfig.json` and `check.sh` register the new tests. Existing users
need no opt-in and retain the unsupported-option refusal.

The first adapter attempt accepted the option without a connected channel.
That broke the existing “unsupported setup options and missing explicit
done” control: its combined run had 63 pass, 1 fail and 3 skipped. Requiring
the explicit channel fixed that concrete regression without editing or
skipping the existing control. The final combined count above includes it.

These changes do not modify `finish()` or registration draining, and can be
merged additively with the URLPattern task's bounded asynchronous-registration
drain and inventory option. They do not modify the existing adapter test file
owned by the event task.

### Sabotage evidence

The temporary mutation read `exception.message` immediately before native
metadata extraction. The untouched WPT case
`self.reportError() doesn't invoke getters` failed with its `get message`
assertion. Source was restored in a `finally` block; the clean and restored
SHA-256 values both equal
`a89e3a5689c72886437bc905c26c54c00a282c123c170fc5f725ea3659332885`.
The restored fixture returns to 2 pass, 0 fail and the same 3 named blocks.
No sabotage remains in the committed source.

## Scope retained for maintainers

Global exposure is left for the small provider-bootstrap PR. This change does
not edit `web-platform-runtime.ts`, the existing EventTarget implementation,
host tooling, compiler code, native runtime code or package barrel exports.
The source imports B1's canonical PromiseRejectionEvent.

The FileReader dependencies remain unchanged: native base64 for
`readAsDataURL`, native codecs for legacy encodings, and a native microtask
checkpoint for the two event-order cases. The known load-sensitive 100 ms
adapter control is unchanged; its injected-clock replacement belongs to the
maintainers.
