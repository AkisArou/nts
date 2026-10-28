# Performance and User Timing source conformance

Stacked on [PromiseRejectionEvent PR #37](https://github.com/AkisArou/nts/pull/37),
`chatgpt/promise-rejection-event` at `63bc421083ccd61706105752ee1915119a646c49`.
This is item B7, after A5 and B6 in the corrected handoff.

## Scope and specifications

This change implements the assigned `Performance`, `PerformanceEntry`,
`PerformanceMark` and `PerformanceMeasure` source surface: `now`, `timeOrigin`,
`toJSON`, marks, measures, timeline queries and clearing. It targets a non-Window
environment. Its evidence is ordinary-node execution, not compiled nts behavior.

The algorithms follow:

- [High Resolution Time Level 3, Performance interface and time origin](https://www.w3.org/TR/hr-time-3/#the-performance-interface).
- [User Timing, extensions to Performance](https://www.w3.org/TR/user-timing/#extensions-performance-interface),
  [PerformanceMark construction](https://www.w3.org/TR/user-timing/#the-performancemark-constructor)
  and [timestamp conversion](https://www.w3.org/TR/user-timing/#processing).
- [Performance Timeline, filtering the entry buffer](https://w3c.github.io/performance-timeline/#filter-buffer-map-by-name-and-type).
- [Web IDL dictionary conversion](https://webidl.spec.whatwg.org/#es-dictionary)
  and [union conversion](https://webidl.spec.whatwg.org/#es-union).

Runtime bootstrap is a separate change. This PR neither exports global properties
through `web-platform-runtime.ts` nor assigns to `globalThis`.

## Implementation and required provider capabilities

`createPerformance(runtime, capabilities)` installs one instance for a runtime.
It must run before a direct `new PerformanceMark(...)`; there is no lazy
initialization that could preempt bootstrap capability selection. A duplicate
installation throws. The factory and capability interfaces are internal provider
seams, not Web methods.

`now()` makes one captured call to `runtime.monotonicMilliseconds()` and subtracts
a fixed origin offset. Its source path allocates nothing. Deterministic controls
verify clock-call counts and that wall time is never read. This is a source-level
hot-path property, not a compiled speed measurement.

Two capabilities remain unavailable in the ordinary provider:

1. **Correlated environment origin.** Existing `PlatformPrimitives` promises a
   provider-relative monotonic clock, not the selected environment's epoch origin
   or cross-context agreement. `PerformanceTimeOrigin` therefore supplies both
   the epoch milliseconds and the value of that same instant in the runtime's
   monotonic domain. The provider must establish this correlation; sampling
   `Date.now() - now()` is not substituted. Without it, `now()` keeps the existing
   provider-relative origin and `timeOrigin`/`toJSON()` explicitly throw
   `NotSupportedError`. This is an exposed dependency, not full HR Time origin
   conformance. `Event.timeStamp` currently reads the provider clock directly:
   to keep the two APIs in the same domain, the eventual provider should use the
   selected environment origin for that clock (offset zero), or coordinate Event
   timestamp conversion separately. That integration is not verified here.
2. **Object detail serialization.** `PerformanceDetailCloner.clone` must implement
   HTML StructuredSerialize followed by StructuredDeserialize in the relevant
   environment. It returns success or a failure value; source throws the failure
   unchanged before inserting an entry. Immutable primitive detail needs no
   storage operation, and uncloneable functions/symbols throw `DataCloneError`.
   An object without the capability explicitly throws `NotSupportedError`; it is
   never retained as an identity clone. The provider does not have this capability
   yet. Two focused source controls inject genuine host `structuredClone` only to
   verify delegation, snapshotting/shared cycles and getter-error propagation.
   That test adapter is not installed in the WPT driver and does not satisfy the
   native dependency.

Marks and measures retain immutable internal attributes, preserve entry identity,
return fresh query arrays ordered by `startTime`, and resolve repeated mark names
by the most recently added occurrence. Dictionary members are converted in Web
IDL order before algorithm checks. The measure algorithm computes end before
start, permits negative computed duration/start, and performs the specified
argument-combination and negative-input checks. Reserved navigation-timing names
throw for measure conversion in this non-Window environment. Clearing removes
only the requested entry type and preserves entries already returned to callers.

## Corpus provenance and adapter

`performance-manifest.json` pins all selected files, helpers and the retained
upstream BSD-3-Clause LICENSE by source path, revision, SHA-256 and Git blob ID.
All selected files are byte-identical to upstream; no header or case is changed.
The 22 fixtures, one helper and LICENSE were fetched at their recorded pins and
compared byte-for-byte. These are Node 24.20.0's directory revisions:

| Directory | WPT revision |
| --- | --- |
| `hr-time` | `34cafd797e58dad280d20040eee012d49ccfa91f` |
| `user-timing` | `5ae85bf8267ac617833dc013dee9774c9e2a18b7` |
| `performance-timeline` | `94caab7038b27c16d605fa3547dacbee3a2fde4e` |

Each file runs in a fresh `node:vm` context populated with this package's classes
and instance. The ordinary host provider supplies the clock; Node's competing
Performance classes and object are not injected into the fixture global. This
includes the actual monotonic provider operation, whose host implementation uses
Node's existing high-resolution clock. No `node:perf_hooks` import is added.

The shared adapter changes are additive:

- **`assert_approx_equals` in `harness.ts`:** implements the pinned testharness
  assertion's inclusive finite epsilon comparison, numeric actual-value check,
  expected-value coercion, and exact equality when both operands are non-finite.
  Its separate controls exercise six passing assertions and detect seven intended
  assertion failures. No clock or timer behavior is changed.
- **`tsconfig.json`:** adds the Performance WPT driver, source-policy tests and
  assertion controls to strict checking.

`runner.ts` is unchanged. `check.sh` adds those three files to its explicit list.
The manifest also lists excluded paths from Node's vendored directories, with
reasons. This is an inventory of that vendor subset, not a claim to cover every
upstream WPT path at those revisions.

## Results

Evidence was collected on Node **24.20.0** and pnpm **10.15.0**. The baseline uses
an archive of PR #27 source and host paths at
`5a9aef5d5f50341d09b1b76ef8b9778d303e7e8f`, with the same new corpus, adapter and
named exclusions. No Performance replacement is supplied when the base lacks it.
The reviewed source is pinned in `performance-results.json`; it is not a claim
that later stack commits or compiled artifacts have the same measurements.

Counts below are actual WPT cases, in **pass / fail / blocked** order. Node's
outer suite and per-file wrapper subtests are excluded from these counts.

| File | Before | After | Caveat |
| --- | --- | --- | --- |
| `hr-time/basic.any.js` | 0 / 5 / 0 | 5 / 0 / 0 |  |
| `hr-time/monotonic-clock.any.js` | 0 / 2 / 0 | 2 / 0 / 0 |  |
| `performance-timeline/performanceentry-tojson.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |  |
| `user-timing/clear_all_marks.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |  |
| `user-timing/clear_all_measures.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |  |
| `user-timing/clear_non_existent_mark.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |  |
| `user-timing/clear_non_existent_measure.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |  |
| `user-timing/clear_one_mark.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |  |
| `user-timing/clear_one_measure.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |  |
| `user-timing/entry_type.any.js` | 0 / 2 / 0 | 2 / 0 / 0 |  |
| `user-timing/mark-entry-constructor.any.js` | 0 / 4 / 2 | 4 / 0 / 2 |  |
| `user-timing/mark-errors.any.js` | 0 / 10 / 0 | 10 / 0 / 0 |  |
| `user-timing/mark-l3.any.js` | 0 / 0 / 1 | 0 / 0 / 1 |  |
| `user-timing/mark-measure-feature-detection.html` | 0 / 2 / 0 | 2 / 0 / 0 |  |
| `user-timing/mark-measure-return-objects.any.js` | 0 / 5 / 0 | 5 / 0 / 0 |  |
| `user-timing/mark.any.js` | 0 / 2 / 0 | 22 / 0 / 0 | 20 further checks do not register before the API exists |
| `user-timing/measure-l3.any.js` | 0 / 3 / 0 | 3 / 0 / 0 |  |
| `user-timing/measure-with-dict.any.js` | 1 / 0 / 1 | 1 / 0 / 1 | Before: incidental TypeError pass plus a separate cleanup failure |
| `user-timing/measure_syntax_err.any.js` | 0 / 5 / 0 | 5 / 0 / 0 |  |
| `user-timing/structured-serialize-detail.any.js` | 0 / 2 / 7 | 2 / 0 / 7 |  |
| `user-timing/user-timing-tojson.html` | 0 / 2 / 0 | 2 / 0 / 0 |  |
| `user-timing/user_timing_exists.any.js` | 0 / 4 / 0 | 4 / 0 / 0 |  |
| **Total registered** | **1 / 55 / 11** | **76 / 0 / 11** | Before: 67 registered; after: 87 |

Two baseline caveats are necessary:

- `mark.any.js` populates `expectedTimes` in its two initial tests, then registers
  ten further checks per populated entry. The missing base API prevents both
  entries being populated. Those twenty checks **never register** on the base;
  they are not counted as failures or exclusions.
- The invalid-argument test in `measure-with-dict.any.js` appears to pass on the
  base because reading `self.performance.measure` itself throws the expected
  `TypeError` when `performance` is absent. Its cleanup then raises
  `ReferenceError: performance is not defined`, recorded separately as a harness
  error. That baseline pass provides no conformance evidence.

Additionally, `mark-errors.any.js` extracts an unbound `performance.mark`. An
illegal-receiver `TypeError` can satisfy some checks before their intended input
validation. The source-policy suite separately tests bound calls and the direct
constructor with those inputs.

The final targeted command reports **30 passing source-policy tests**, **two
passing adapter controls**, and the WPT counts above. Its raw `node:test` totals
are 142 tests, 131 pass, zero fail, 11 skipped; these include the suite/file
wrappers. Both strict TypeScript projects pass.

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test \
  runtime/web-platform/test/wpt-performance.test.ts \
  runtime/web-platform/test/wpt-performance-adapter.test.ts \
  runtime/web-platform/test/performance-policy.test.ts
```

### Sabotage control

The actual source `Performance.now()` was temporarily replaced with `return 0`.
The unchanged `hr-time/monotonic-clock.any.js` then reported one pass and one
failure: **“self.performance.now() returns a positive number”** failed. The test
process exited nonzero. The source was restored byte-for-byte, and the same file
reported two passes and exited zero. `performance-results.json` records the
restored source SHA-256 and the case counts.

```sh
NTS_WPT_PERFORMANCE_FIXTURE=hr-time/monotonic-clock.any.js \
  node --expose-gc --test runtime/web-platform/test/wpt-performance.test.ts
```

## Named dependencies and deliberately omitted surface

The eleven named exclusions remain visible in the manifest and test output:

- Two constructor cases in `mark-entry-constructor.any.js` supply object `detail`.
- Seven cases in `structured-serialize-detail.any.js` require cloning an object,
  including detecting a nested uncloneable Symbol and preserving a copied value.
- `mark entries' detail and startTime are customizable.` in `mark-l3.any.js`, and
  `measure entries' detail and start/end are customizable` in
  `measure-with-dict.any.js`, need `PerformanceObserver` delivery and object
  cloning. The Observer API is outside the assigned surface; it is not fabricated.

Whole-file omissions are named individually in the manifest: browser/navigation
and worker lifecycle, `importScripts`, PerformanceObserver and broader timeline
entry kinds, full IDL/descriptor exposure, and security/coarsening tests. Node's
`v24.20.0` User Timing status also skips the worker `importScripts` cases. Its
Performance Timeline status names `id`/`navigationId` IDL failures; the latest
entry-ID extensions are not implemented or claimed here. Node's own Performance
implementation was not rerun in this change.

Descriptor flags and prototype-reflection tests are deliberately left out under
the current cloud-agent fixed-layout rules. The selected constructor, attributes,
brands, JSON and algorithm tests remain independent of those flags. Epoch-origin
cross-context accuracy, sleep behavior and browser isolation/coarsening are
**not verified**. Compiled nts execution and the maintainers' full gate are
**not verified**. Global exposure and provider bootstrap are separate work.

## Integration validation on the published stack

The public API barrel exports the four canonical classes and public option/JSON
types; the provider barrel exports the internal factory and typed capability
contract. Global exposure remains in the separate small bootstrap PR.

Both strict TypeScript projects pass on this stack. The complete ordinary-node
gate exits zero: **4,277 tests; 3,955 passed, 0 failed, 322 skipped**. Its broader
upstream runner records **2,772 passed, 0 failed, 45 not applicable**. The
compiled axis explicitly skips because no nts compiler is available. These are
new measurements on the B6 stack; the archived #27 baseline and the original
sabotage evidence above retain their own source identities.

Shared-file overlap with PR #10 and the other conformance tasks is additive:
`assert_approx_equals`, three strict-test registrations, and three check.sh
entries. The maintainers merge those shared changes; there is no runner or
timer change in this PR.
