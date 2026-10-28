# Explicit source-global bootstrap

## What the new entry point does

`WebPlatformRuntime.bootstrapGlobals(capabilities)` prepares the canonical
source API bindings once for one runtime/environment. It returns two typed
objects:

- `globals`: the canonical PromiseRejectionEvent, Performance,
  PerformanceEntry, PerformanceMark, PerformanceMeasure, Navigator and
  URLPattern constructors; one `performance` and `navigator` instance; the
  `reportError` callable; and backing accessors for `onerror`,
  `onunhandledrejection` and `onrejectionhandled`.
- `hooks`: the internal `reportException`, `hostPromiseRejectionTracker` and
  `notifyRejectedPromises` entry points for the engine/provider.

The method returns the same objects when called again with the same capability
configuration object. It refuses a different configuration or a closed runtime.
It calls `createPerformance` once, creates one Navigator, and installs the
runtime's URLPattern primitive capability before returning the constructors.
It refuses to replace a Performance already created through the standalone
factory.

All top-level capability references, the origin/cloner references and both
origin scalars are read once before registration. Validation and construction
use those stable snapshots. Navigator and error-policy construction precede
Performance registration; the original configuration object is retained only
for the idempotent-call identity check. A source getter that throws during
configuration does not leave a partially installed Performance behind.

Ordinary `new WebPlatformRuntime(...)` remains unchanged: it does not install
Performance or these globals. Existing providers/tests can continue to call
`createPerformance` explicitly. The new global bootstrap is an opt-in entry
point requiring the complete capability set.

## Capability requirements

| Capability | Provider obligation |
| --- | --- |
| `performance.timeOrigin` | Supply the correlated epoch origin, with `monotonicMilliseconds` equal to zero at this global-bootstrap boundary. |
| `performance.detailCloner` | Supply the native structured serialization/deserialization operation; failure crosses as a value. |
| `navigator` | Return this environment's configured default User-Agent value, without throwing into source. |
| `urlPattern` | Supply the explicit URL component canonicalization and opaque-path operations. Unsupported operations remain explicit refusal values. |
| `errors` | Supply the full global-error contract: actual-global identity and listeners, metadata and canonical initialized ErrorEvent fields, captured callback settings and invocation cleanup, native Promise slots, the DOM task source and reporting sinks. |

Missing capability groups and Performance requirements are rejected before
initialization; each typed capability's methods remain provider obligations.
The bootstrap neither
invents a User-Agent nor substitutes Node globals, a detached EventTarget,
public Promise observation, exposed stack parsing, or a Date-based estimate of
the time origin.

### One clock domain for the actual global

The existing Event implementation takes `timeStamp` directly from
`runtime.monotonicMilliseconds()`. Performance can separately subtract a
configured origin offset. Exposing both at one global while allowing a
nonzero Performance offset would give them different time domains.

This new bootstrap therefore requires an already environment-relative runtime
clock and rejects `timeOrigin.monotonicMilliseconds !== 0` before any
installation. The provider still owns selection of the real environment
origin, epoch correlation and clock coarsening. The general standalone
`createPerformance` factory retains its existing nonzero-offset support.
`Performance.now()` retains its existing allocation-free source path: one
captured monotonic-provider call and subtraction of the fixed zero offset.

## Actual installation remains a provider operation

The source factory does not assign to `globalThis`, create a global realm or
install property descriptors. The native provider must first associate the
runtime with its environment and expose the values from `bootstrap.globals`
at the actual global. Canonical constructors use that environment association;
they are not wrappers tied to the binding-holder object.

The native global's handler getters/setters forward to the corresponding
`globals` accessors. Those accessors read/write only the private
GlobalErrorRuntime's backing slots. Source handler processing subsequently
reads the actual `globalThis` handler once, without recursive forwarding.
The supplied error capability captures incumbent settings at assignment and
performs callback preparation/cleanup before returning the invocation result;
the bootstrap passes that contract through unchanged.

`globals.reportError` is the original receiver-aware source function. Extract
it for installation as the actual global callable. Calling it as
`globals.reportError(value)` uses the binding holder as its receiver and is
invalid; the holder is not a global. A bare extracted call defaults to its
owning global, and a method borrowed onto another real global uses the native
receiver-resolution boundary.

The engine calls the methods on `bootstrap.hooks` for the appropriate
environment and at the actual checkpoint. These hooks are deliberately
separate from public global properties. Returning the hooks does not install
automatic Promise rejection tracking.

The source module exports `WebPlatformGlobalBindings` and the types
`WebPlatformGlobalCapabilities`, `WebPlatformGlobalHooks` and
`WebPlatformGlobalBootstrap`. Provider-barrel routing is handled by the stack's
integration owner; this small change does not edit that barrel or unrelated
API implementations.

## Focused evidence

`global-bootstrap-policy.test.ts` contains 16 controls for this binding layer.
The exact source/dependency pins, command, totals and hashes are recorded in
`global-bootstrap-results.json`.

The controls check canonical identity, one-time construction and retained
Performance state, explicit capability refusal/retry, the zero-offset
requirement, matching Event/Performance clock domains, thin `now()` calls,
deferred Navigator reads, structured-clone forwarding, URLPattern installation
and refusal, unchanged host globals, nonrecursive handler backing and callback
cleanup order, the extracted `reportError` receiver, explicit rejection hooks,
runtime-specific instance state, existing standalone Performance and closed
runtimes. Ordinary configuration getters are covered explicitly, including a
failed-read retry and origin values that change across reads.

Measurements use Node `v24.20.0`:

| Run with the final 16 controls | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| Dependency-only runtime, before the bootstrap entry point exists | 1 | 15 | 0 |
| Initial local bootstrap, with the two new getter regressions | 14 | 2 | 0 |
| Snapshot-corrected implementation | 16 | 0 | 0 |
| Temporary removal of the zero-offset guard | 15 | 1 | 0 |
| Exact committed source restored | 16 | 0 | 0 |

The initial source passed the original 14 controls. Review then found two
ordinary-getter defects: a repeated `errors` read could throw after Performance
registration and poison a retry, and a changing origin could pass the zero
check but later install a nonzero offset. Both new controls failed before the
snapshot correction. The corrected implementation passes them, including a
genuine configuration-read failure followed by successful retry.

The final sabotage temporarily removed the zero-offset guard from committed
source. Exactly the nonzero-offset refusal control failed. A `finally` block
restored the source, whose before/restored SHA-256 values both equal
`7b3ea80aab2eab053352997c878d69face596dda127a7e68c866ccc58da1a50f`.
All 16 controls passed again after restoration. No sabotage is committed.

The deterministic global-error driver is a test contract, not a production
native global or Promise implementation. Test-only descriptor glue exposes
handler forwarders on Node's actual global and restores every original
descriptor afterward. The clone control uses Node's actual structuredClone as
an injected test capability. The URL control deliberately returns
`unsupported` for nonempty components; it proves the bootstrap preserves the
native boundary instead of supplying a pretend URL canonicalizer.

These are specification-derived integration controls over the previously
reviewed APIs. No additional upstream WPT files or feature skips are needed.

```sh
node --expose-gc --test --test-reporter=tap \
  runtime/web-platform/test/global-bootstrap-policy.test.ts

pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
```

Both strict TypeScript projects exit successfully on the corrected source.

The test is registered in the explicit `check.sh` list and shared test
tsconfig. No harness/runner algorithm change belongs to this bootstrap PR.
The stacked full gate belongs to the integration owner. Actual native global
installation, callback/settings machinery, Promise hooks, epoch correlation,
native coarsening and compilation with nts remain **not verified** by these
source-host controls.
