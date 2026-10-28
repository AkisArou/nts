# Streams WPT conformance

Item A2 is stacked on the events/abort adapter in PR #2, at
`437c4fdc45c1125da2f5142063c75dc32d416fcf`. It targets that PR's
`chatgpt/wpt-events-abort` branch until the adapter lands. The maintainer has
authorized stacking and concurrent additions to the explicit `check.sh` test
list. No other API area, provider bootstrap, compiler or native code changes.

## Provenance and execution

The pins are those recorded by [Node v24.20.0's versions.json](https://github.com/nodejs/node/blob/71b8b174857e25106d39b61a9e6f30d927da8b01/test/fixtures/wpt/versions.json):

| Directory | WPT revision |
| --- | --- |
| `streams` | `f8f26a372f357370846226ff64db1f9cc98a1edb` |
| Harness `resources` reference | `6a2f32237615d7ea9c1eb1e30453066b5555c603` |
| `common` helper | `dbd648158d337580885e70a54f929daf215211a0` |

All 72 non-IDL standalone `.any.js` fixtures and five required helpers are
copied unedited. Existing headers and the shared upstream BSD-3-Clause licence
are preserved; no header is inserted into upstream bytes. The
[manifest](streams-manifest.json) records source paths, revisions, SHA-256 and
Git blob IDs, exact case registrations and exclusions. The loader verifies the
hashes on every run. The complete Streams inventory comprises 72 fixtures,
four helpers, 36 excluded HTML/JS or support paths, and ten metadata paths;
the fifth selected helper is `common/gc.js` from its separate pin. Every Node
vendor file in this Streams revision matches upstream.

`../wpt-streams.test.ts` supplies this package's stream, reader, controller,
queuing-strategy, abort and DOMException classes. It creates the ordinary-node
provider and a fresh `node:vm` context per fixture. Node's competing Web API
classes are never supplied. Genuine host ECMAScript constructors align ordinary
promise and buffer identity checks with the imported implementation. `self`
aliases the actual fixture global; no Window/Worker interface is fabricated.
The exposed host GC hook exercises source behavior on Node, not nts native
memory management. META global variants execute once in this host environment.

The shared adapter adds global `step_timeout`, timeout callback arguments and
`assert_greater_than`, with negative controls. It also corrects the legacy
`assert_object_equals` adaptation to match the [pinned assertion](https://github.com/web-platform-tests/wpt/blob/6a2f32237615d7ea9c1eb1e30453066b5555c603/resources/testharness.js#L1652-L1686).
That deprecated assertion compares enumerable contents and can accept an empty
typed array against `undefined`; the shim preserves this upstream weakness
instead of changing an unchanged test's meaning. Ten positive/negative
comparison cases were checked against the actual pinned function. The expanded
harness controls finish at 22 pass / 0 fail.

## Before and after

These are WPT leaf counts, excluding `node:test` suite/file wrappers. Before
uses source at the PR #2 base with this final adapter and selection. After uses
the three source fixes below. The applicable pinned cases already pass at the
base; the separately authored controls establish the source defects.

The initial diagnostic run was **1,152 pass / 10 fail / 26 blocked**. Four
failures call missing `structuredClone` through the unedited
`transferArrayBufferView` helper, five cover the nonstandard owning-stream
proposal, and one exposed the adapter's object-comparison mismatch. The final
selection explicitly records the nine capability/proposal exclusions and fixes
the adapter. This classification is not presented as nine source bug fixes.

| WPT path | Before: pass / fail / blocked | After: pass / fail / blocked |
| --- | ---: | ---: |
| `streams/piping/abort.any.js` | 33 / 0 / 0 | 33 / 0 / 0 |
| `streams/piping/close-propagation-backward.any.js` | 16 / 0 / 0 | 16 / 0 / 0 |
| `streams/piping/close-propagation-forward.any.js` | 30 / 0 / 0 | 30 / 0 / 0 |
| `streams/piping/error-propagation-backward.any.js` | 35 / 0 / 0 | 35 / 0 / 0 |
| `streams/piping/error-propagation-forward.any.js` | 32 / 0 / 0 | 32 / 0 / 0 |
| `streams/piping/flow-control.any.js` | 5 / 0 / 0 | 5 / 0 / 0 |
| `streams/piping/general-addition.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `streams/piping/general.any.js` | 14 / 0 / 0 | 14 / 0 / 0 |
| `streams/piping/multiple-propagation.any.js` | 9 / 0 / 0 | 9 / 0 / 0 |
| `streams/piping/pipe-through.any.js` | 43 / 0 / 0 | 43 / 0 / 0 |
| `streams/piping/then-interception.any.js` | 0 / 0 / 2 | 0 / 0 / 2 |
| `streams/piping/throwing-options.any.js` | 8 / 0 / 0 | 8 / 0 / 0 |
| `streams/piping/transform-streams.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `streams/queuing-strategies.any.js` | 20 / 0 / 0 | 20 / 0 / 0 |
| `streams/readable-byte-streams/bad-buffers-and-views.any.js` | 24 / 0 / 0 | 24 / 0 / 0 |
| `streams/readable-byte-streams/construct-byob-request.any.js` | 16 / 0 / 0 | 16 / 0 / 0 |
| `streams/readable-byte-streams/crashtests/tee-locked-stream.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `streams/readable-byte-streams/enqueue-with-detached-buffer.any.js` | 0 / 0 / 1 | 0 / 0 / 1 |
| `streams/readable-byte-streams/general.any.js` | 98 / 0 / 3 | 98 / 0 / 3 |
| `streams/readable-byte-streams/non-transferable-buffers.any.js` | 0 / 0 / 4 | 0 / 0 / 4 |
| `streams/readable-byte-streams/patched-global.any.js` | 0 / 0 / 1 | 0 / 0 / 1 |
| `streams/readable-byte-streams/read-min.any.js` | 23 / 0 / 1 | 23 / 0 / 1 |
| `streams/readable-byte-streams/respond-after-enqueue.any.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `streams/readable-byte-streams/tee.any.js` | 39 / 0 / 0 | 39 / 0 / 0 |
| `streams/readable-byte-streams/templated.any.js` | 34 / 0 / 0 | 34 / 0 / 0 |
| `streams/readable-streams/async-iterator.any.js` | 40 / 0 / 1 | 40 / 0 / 1 |
| `streams/readable-streams/bad-strategies.any.js` | 8 / 0 / 0 | 8 / 0 / 0 |
| `streams/readable-streams/bad-underlying-sources.any.js` | 22 / 0 / 0 | 22 / 0 / 0 |
| `streams/readable-streams/cancel.any.js` | 11 / 0 / 0 | 11 / 0 / 0 |
| `streams/readable-streams/constructor.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `streams/readable-streams/count-queuing-strategy-integration.any.js` | 4 / 0 / 0 | 4 / 0 / 0 |
| `streams/readable-streams/crashtests/garbage-collection.any.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `streams/readable-streams/default-reader.any.js` | 29 / 0 / 0 | 29 / 0 / 0 |
| `streams/readable-streams/floating-point-total-queue-size.any.js` | 4 / 0 / 0 | 4 / 0 / 0 |
| `streams/readable-streams/from.any.js` | 48 / 0 / 0 | 48 / 0 / 0 |
| `streams/readable-streams/garbage-collection.any.js` | 5 / 0 / 0 | 5 / 0 / 0 |
| `streams/readable-streams/general.any.js` | 38 / 0 / 0 | 38 / 0 / 0 |
| `streams/readable-streams/owning-type-message-port.any.js` | 0 / 0 / 2 | 0 / 0 / 2 |
| `streams/readable-streams/owning-type-video-frame.any.js` | 0 / 0 / 5 | 0 / 0 / 5 |
| `streams/readable-streams/owning-type.any.js` | 0 / 0 / 5 | 0 / 0 / 5 |
| `streams/readable-streams/patched-global.any.js` | 1 / 0 / 4 | 1 / 0 / 4 |
| `streams/readable-streams/reentrant-strategies.any.js` | 10 / 0 / 0 | 10 / 0 / 0 |
| `streams/readable-streams/tee.any.js` | 26 / 0 / 0 | 26 / 0 / 0 |
| `streams/readable-streams/templated.any.js` | 91 / 0 / 0 | 91 / 0 / 0 |
| `streams/transferable/transform-stream-members.any.js` | 0 / 0 / 4 | 0 / 0 / 4 |
| `streams/transform-streams/backpressure.any.js` | 14 / 0 / 0 | 14 / 0 / 0 |
| `streams/transform-streams/cancel.any.js` | 11 / 0 / 0 | 11 / 0 / 0 |
| `streams/transform-streams/errors.any.js` | 21 / 0 / 0 | 21 / 0 / 0 |
| `streams/transform-streams/flush.any.js` | 6 / 0 / 0 | 6 / 0 / 0 |
| `streams/transform-streams/general.any.js` | 26 / 0 / 0 | 26 / 0 / 0 |
| `streams/transform-streams/lipfuzz.any.js` | 20 / 0 / 0 | 20 / 0 / 0 |
| `streams/transform-streams/patched-global.any.js` | 0 / 0 / 2 | 0 / 0 / 2 |
| `streams/transform-streams/properties.any.js` | 6 / 0 / 0 | 6 / 0 / 0 |
| `streams/transform-streams/reentrant-strategies.any.js` | 11 / 0 / 0 | 11 / 0 / 0 |
| `streams/transform-streams/strategies.any.js` | 10 / 0 / 0 | 10 / 0 / 0 |
| `streams/transform-streams/terminate.any.js` | 6 / 0 / 0 | 6 / 0 / 0 |
| `streams/writable-streams/aborting.any.js` | 65 / 0 / 0 | 65 / 0 / 0 |
| `streams/writable-streams/bad-strategies.any.js` | 7 / 0 / 0 | 7 / 0 / 0 |
| `streams/writable-streams/bad-underlying-sinks.any.js` | 14 / 0 / 0 | 14 / 0 / 0 |
| `streams/writable-streams/byte-length-queuing-strategy.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `streams/writable-streams/close.any.js` | 26 / 0 / 0 | 26 / 0 / 0 |
| `streams/writable-streams/constructor.any.js` | 13 / 0 / 0 | 13 / 0 / 0 |
| `streams/writable-streams/count-queuing-strategy.any.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `streams/writable-streams/crashtests/garbage-collection.any.js` | 5 / 0 / 0 | 5 / 0 / 0 |
| `streams/writable-streams/error.any.js` | 5 / 0 / 0 | 5 / 0 / 0 |
| `streams/writable-streams/floating-point-total-queue-size.any.js` | 4 / 0 / 0 | 4 / 0 / 0 |
| `streams/writable-streams/garbage-collection.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `streams/writable-streams/general.any.js` | 16 / 0 / 0 | 16 / 0 / 0 |
| `streams/writable-streams/properties.any.js` | 8 / 0 / 0 | 8 / 0 / 0 |
| `streams/writable-streams/reentrant-strategy.any.js` | 7 / 0 / 0 | 7 / 0 / 0 |
| `streams/writable-streams/start.any.js` | 8 / 0 / 0 | 8 / 0 / 0 |
| `streams/writable-streams/write.any.js` | 13 / 0 / 0 | 13 / 0 / 0 |
| **Total** | **1,153 / 0 / 35** | **1,153 / 0 / 35** |

## Source-policy fixes

Each fix is a separate commit with its specification link. The new
`../streams-wpt-policy.test.ts` contains locally authored controls, not edited
or relabeled WPT cases. Its complete baseline at `437c4fdc` is **5 pass / 6
fail**; the corrected source is **11 pass / 0 fail**.

1. [ReadableByteStreamControllerPullInto](https://streams.spec.whatwg.org/#readable-byte-stream-controller-pull-into),
   step 16.2: reject a queued BYOB underfill after close even when it contains
   whole typed-array elements. Previously such reads could remain pending
   forever. Controls cover Uint8Array and Uint16Array underfill, shared error
   identity and reaction ordering, and a successful final chunk that meets its
   minimum. These three controls improve from 1 pass / 2 fail to 3 / 0.
2. [ReadableStreamCancel](https://streams.spec.whatwg.org/#readable-stream-cancel):
   close a byte stream before invoking its underlying cancellation callback.
   Save the source and callback first because closing clears the algorithms.
   The callback observes the closed controller; its own error rejects
   cancellation without erroring already-closed reads. Both added controls
   fail at the base and pass after the fix.
3. [Web IDL dictionary conversion](https://webidl.spec.whatwg.org/#es-dictionary):
   get the required `highWaterMark` value once, reject `undefined`, and convert
   the captured value. Both strategy constructors previously accepted a
   present member returning `undefined` as NaN. The controls also preserve
   getter/coercion order and exact getter exceptions. Both required-member
   controls fail before and pass after the fix; four positive/error-order
   controls pass on both versions.

These changes introduce no descriptor, Proxy or Reflect mechanism. Existing
source surface initialization remains outside this PR.

## Sabotage evidence

Temporarily changed the package's `CountQueuingStrategy.size` result from `1`
to `2`. Ran the unchanged `streams/queuing-strategies.any.js` through the same
driver and package imports. It failed with exit status 1: **19 pass / 1 fail /
0 blocked**. The failing case was
`CountQueuingStrategy: size behaves as expected with strange arguments`.

Restored the source byte-for-byte and verified its SHA-256
`f592807dc8ac8ea9718deb8de77e28a05755f77ef9121fc1e7b5d52c9914e245`.
The final full WPT run restores that file to **20 pass / 0 fail / 0 blocked**.
The sabotaged package method would not affect Node's own competing class.

## Validation

Exact tools: Node **24.20.0**, pnpm **10.15.0**, unchanged lockfile, no new npm
dependencies. Both new test files are in `check.sh` and the strict test project.

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/wpt-streams.test.ts
node --expose-gc --test runtime/web-platform/test/streams-wpt-policy.test.ts
sh tooling/conformance/web-platform/check.sh
```

Both TypeScript projects pass. The prescribed isolated test execution passes
inside `check.sh`. Detailed leaf TAP was also recorded with
`--test-isolation=none --test-reporter=tap`, running one test file per process;
each WPT fixture still has its own VM context.

| Check | Observed result |
| --- | --- |
| Streams WPT leaf cases | 1,153 pass / 0 fail / 35 blocked |
| Supplemental Streams source controls | 11 pass / 0 fail |
| Shared adapter controls | 22 pass / 0 fail |
| Full `check.sh` Node suite, including wrappers | 2,376 tests: 2,333 pass / 0 fail / 43 skipped |
| Existing broader upstream runner | 2,817 cases: 2,772 applicable and passed / 0 failed / 45 not applicable |
| Compiled axis | Explicitly skipped: no nts compiler |

The 43 host-suite skips are 35 Streams exclusions, seven inherited events/abort
capability blocks, and the inherited descriptor-only Event control. The broad
upstream runner requires the Node v24.20.0 fixture checkout installed by the
repository's bootstrap procedure. The new committed Streams corpus needs no
network or external fixture checkout. No nts compilation, native execution or
performance result is claimed.

## Deliberately left out

The manifest names each of the 35 excluded cases and its reason. Stale case
names fail the run; Node's status file is compatibility context rather than an
automatic skip list. In particular its known recursive-abort failure remains a
normal runnable package test.

| Category | Cases | Limitation |
| --- | ---: | --- |
| Adapter realm | 10 | VM literals, async-generator prototypes and modified globals differ from the host realm of the imported implementation. Their identity or intrinsic-interception assertions cannot be evaluated faithfully by this adapter. |
| Compiler capability | 13 | `structuredClone`, transferable-stream support, or WebAssembly.Memory fixture inputs are not provided by this source package's host driver. |
| Provider capability | 7 | Real MessageChannel/MessagePort or VideoFrame inputs are absent. |
| Nonstandard proposal | 5 | `ReadableStream` type `owning` is absent from the current Streams Standard. |

The [underlying source API](https://streams.spec.whatwg.org/#underlying-source-api)
has only `bytes` in `ReadableStreamType` as checked on 2026-10-28. The manifest
records the [standard snapshot used for that check](https://streams.spec.whatwg.org/commit-snapshots/312b67e396a8511a2a984eb90ce4b2e00283c366/).
Node v24.20.0 also lists those five proposal cases as expected failures. No
nonstandard API is added to satisfy them. Proposal cases involving message
ports or video frames are already counted under their unavailable capabilities,
not counted twice.

The separate 36-path exclusion inventory covers IDL/global exposure,
Window/Worker/ShadowRealm behavior, iframe realms and teardown, browser task
ordering, storage access, transfer integration and their support files. It is
not counted as executed tests. Existing getter/brand/method-shape tests remain
enabled; no additional descriptor-only exclusion was justified in this corpus.
No fake browser globals or Node Web API replacements conceal these limits.
