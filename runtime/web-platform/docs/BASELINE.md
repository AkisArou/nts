# Integration baseline

## Inputs

- NTS implementation-start commit: `31f15a0d87ecc6d20640bec73dba0563d31b4894`.
- Governing contract: `docs/web-platform-integration-plan.md` at that commit.
- External source directory:
  `/home/akisarou/Projects/nts-web-platform-integration/runtime/web-platform`.
- External provenance snapshot recorded by the delivery:
  `bf5a6824c9bfd76fb3a30006fc4fea0665fe25dd`.
- SHA-256 of the delivered `MANIFEST.sha256`:
  `151f06d8d3dac257f7637b9e754bc9b6ce1a5b4844aa932a9d742b2cd37a5747`.

`sha256sum -c MANIFEST.sha256` passed for all 77 delivered files before import. The
mechanical copy of the 29 shared TypeScript algorithm files was checked byte-for-byte
against the delivery before repository formatting and the reviewed realm removal
were applied. `src/realm.ts` and the old barrel that exported it were intentionally
omitted. Android source is owned and imported by the JVM session; it is not copied
through the Node lane.

The original manifest, provenance, claims, and raw host evidence are retained under
`docs/external`. Their paths describe the external archive, not the layout of the
integrated tree.

## Reproduced Node-host evidence

These commands were run unchanged in the external source directory on 2026-09-06,
using Node `v24.20.0` and the delivery's TypeScript `5.8.3` / `@types/node` `25.1.0`.
Dependencies were installed with `npm install --ignore-scripts --no-package-lock`;
the source manifest remained unchanged.

| Command                 | Result                                                 |
| ----------------------- | ------------------------------------------------------ |
| `npm run check`         | pass                                                   |
| `npm run audit`         | 31 shared TypeScript files, zero structural violations |
| `npm test`              | 80/80 pass, zero skipped                               |
| `npm run test:upstream` | expected nonzero exit; 8/9 pass                        |

The visible WPT failure remains the dictionary initializer in
`headers-normalize.any.js`: `TypeError: entries is not iterable`. It is not converted
to a pass. These are Node-host tests of the delivered source, not compiled NTS or
mobile-provider evidence.

The repository toolchain at start is TypeScript `7.0.2`, `@types/node` `24.13.3`,
and Node `v24.20.0`. The integrated project uses those repository versions rather
than retaining the delivery's package-local versions.

## Compiler baseline

The signed integration contract records 179 primary lowering refusals, 52 cascades,
and zero additional JVM-backend refusals for the delivered shared source with the
synthetic realm entry excluded. Including `realm.ts` produces invalid HIR with
`BrokenBase` for `RealmRequest -> Request` and `RealmResponse -> Response`.

After importing the 29 shared files, removing the subclass-injection hooks used only
by the rejected realm design, and making the new root project authoritative, this
command completed without invalid HIR:

```sh
NTS_TSGO="$PWD/target/tsgo" NTS_BACKEND=jvm \
  ./target/release/nts check runtime/web-platform/tsconfig.json
```

It reported 178 primary lowering refusals, 52 cascades, and zero `NTS4xxx`
JVM-backend refusals. This is the implementation-start refusal baseline. A refusal is
not counted as implementation progress, and an exit-zero `check` does not mean the
source can execute: the command reported that no exported scalar function was
available to run. Diagnostics remain grouped by underlying feature as the governing
plan requires.

An earlier temporary exclusion config in the external directory still reached
`realm.ts` despite TypeScript's resolved file list excluding it. That invocation is
not used as evidence. The canonical root project removes the rejected file rather
than relying on an exclusion, and no source workaround was introduced.

## Integrated Node-host evidence

The ordinary-Node provider and its host tests live under
`tooling/conformance/web-platform`, not under the shared runtime. This is deliberate:
the provider imports Node TCP, TLS, timer, random and compression primitives and is
host-level conformance infrastructure. It is neither the native Node-compatible
provider under `runtime/node` nor an implementation used by the mobile targets.

At the initial integrated tree, using the repository's TypeScript `7.0.2`, Node
declarations `24.13.3`, and Node `v24.20.0`:

| Command                                                   | Result                   |
| --------------------------------------------------------- | ------------------------ |
| `tooling/conformance/web-platform/check.sh`               | 80/80 pass, zero skipped |
| `node tooling/conformance/web-platform/test-upstream.mjs` | 9/9 pass                 |

The 80-test corpus is adapted only where removal of the external synthetic realm
changed construction: it creates the same canonical `Request`, `Response`, and
`WebSocket` classes through an explicit test runtime. Host `fetch` and `WebSocket`
remain replaced by throwing values. The WPT fixtures are unchanged and hash-checked;
the integrated implementation now passes the previously failing dictionary
initializer without modifying the upstream test.

## Current integration evidence

At `9779ffb`, the repository TypeScript build passes, the Node-host suite passes
98/98 with zero skipped, and the unchanged WPT slice passes 39/39. The additional
local cases cover protocol parsing, Web IDL conversion, MIME/body behavior,
cancellation, pool shutdown, TLS, canonical event initialization, and Blob
view/slice behavior; they do not turn host execution into evidence for a compiled
provider.

The WPT expansion reuses five complete FileAPI fixtures and their support script
from Node's existing pinned WPT checkout instead of creating another source copy.
The manifest verifies Node's FileAPI revision and every consumed Git blob before
execution. These fixtures cover `Blob.arrayBuffer()`, `Blob.bytes()`, `Blob.text()`,
fresh result identity, concurrent reads, and slice overflow. The complete
`Blob-slice.any.js` file is not in this applicable slice because it mixes those
behaviors with calls rejected by the TypeScript API itself, including `null` for a
`string` parameter and numbers in `BlobPart[]`. Fractional Web IDL slice conversion,
view copying, and immutability therefore remain focused typed differential tests;
they are not substitutes for an otherwise applicable whole upstream file.

The WPT slice also consumes the complete unchanged
`streams/readable-streams/floating-point-total-queue-size.any.js` fixture from
Node's pinned Streams checkout. Its four cases preserve the specification's exact
double-precision queue arithmetic: subtraction clamps a negative total to zero but
does not erase a small positive residue merely because the queue became empty. The
manifest verifies the independent Streams revision and the fixture's Git blob.

`tooling/conformance/web-platform/check.sh` performs one fresh host emit before both
the local and upstream suites. Direct execution of `test-upstream.mjs` performs its
own emit. This prevents stale generated JavaScript from making an upstream run look
green: an intentional `Blob.text()` sabotage produced eight awaited failures and a
nonzero exit after the fresh emit.

The shared source now uses `Promise.withResolvers()` directly instead of retaining
the external `Deferred` substitute. At `0304954`, the NTS check reports 186 primary
lowering refusals, 40 cascades, and zero `NTS4xxx` JVM-backend refusals. Seventy-three
emitted primary messages mention an unrepresentable `PromiseWithResolvers` property;
that count includes repeated specialized layouts and is one compiler/runtime feature
blocker, not 73 independent missing features. The final-form source remains in place
while that prerequisite is implemented.

At `1b91c18`, after the canonical Blob began accepting every `ArrayBufferView` and
using final Web IDL `[Clamp] long long` slice conversion, the same command reports
187 primary lowering refusals, 38 cascades, zero `NTS4xxx` JVM-backend refusals, and
no invalid HIR. That was the Blob integration baseline. The changed
count reflects intended source reaching a different diagnostic frontier; it is not
itself progress or regression.

At `d79e9e7`, the production HTTP/1 parser replaced regular-expression status and
`Content-Length` parsing, generic `Number.parseInt`, comma-list callbacks, and a
temporary `Headers` object per wire field with explicit bounded parsing. The live
check reports 183 primary refusals, 39 cascades, zero JVM-backend refusals, and no
invalid HIR. Four primary messages disappeared while one additional dependent path
became reachable; this is a changed diagnostic frontier caused by the intended
parser architecture, not evidence that four general language features were closed.

At `9779ffb`, the default readable-stream state machine uses a head-indexed pending
read queue rather than quadratic `Array.shift()` delivery. Strategy size callbacks
are invoked without an accidental stream receiver, tee branches use the standard
one-chunk demand, and source close/error is observed even when no branch currently
has a read pending. A branch canceled before its source errors now fulfills its
cancellation promise while the active branch receives the source error. The
original tee and Fetch-transfer streams deliberately remain locked after terminal
state, matching Node; releasing those readers as cleanup is observably wrong. The
live NTS check reports 195 primary refusals, 39 cascades, zero JVM-backend refusals,
and no invalid HIR. As above, the changed refusal count is a diagnostic frontier
for final-form source, not a completed-feature count.

At `2112af4`, Node URL percent decoding uses the canonical shared UTF-8 writer and
both `URL` and `URLSearchParams` use the shared typed scalar-value-string
normalizer. Untyped JavaScript coercion remains explicit at public Node boundaries;
passing a `symbol` still throws instead of slipping through a TypeScript annotation.
The Node URL suite passes 44/44 applicable files with three precisely documented
Section 13 exclusions, and the pinned URL WPT runner passes 892/892. `nts emit-c`
for the URL project exits successfully, and the HIR verifies all 292 functions left
after pruning; 212 constructs in the wider imported dependency graph remain refused
and are not claimed as implemented. The complete URL source directory was also
normalized with the repository formatter rather than leaving mixed imported style.

At `2bda8af`, `TextEncoder.encodeInto()` no longer carries a second UTF-8 state
machine. The canonical bounded writer optionally fills the progress object that
`encodeInto()` must return, while its ordinary Node Buffer and URL callers retain a
number return and allocate no progress object. A mutation forcing the consumed
code-unit count to zero makes the focused differential fail with `{ read: 0,
written: 1 }` versus `{ read: 1, written: 1 }`. The local Node-host suite passes
99/99. Two complete unchanged Encoding WPT files from Node's pinned checkout add
thirteen surrogate/default-input cases, bringing the immutable WPT slice to 52/52;
the VM context explicitly installs the integrated `TextEncoder` and `TextDecoder`,
not the host globals. The live NTS check reports 196 primary refusals, 40 cascades,
zero JVM-backend refusals, and no invalid HIR. The additional diagnostics are the
current final-source frontier, not evidence of either implemented features or a
compiler regression.

The common C runtime now has an `NtsEnvironment` and scoped current-environment ABI,
but shared TypeScript cannot yet obtain its environment-owned Web dependencies.
Consequently the explicit context arguments still visible on `Request`, `Response`,
`WebSocket`, and `AbortSignal.timeout` are transitional and are not the intended
public signatures. Removing them requires the typed current-environment/constructor
entry seam; process-global mutable state is not an acceptable substitute.

At `2c92fae`, the non-tree `EventTarget` implements the DOM listener options that
affect standalone networking semantics: an already-aborted signal prevents
registration, later abort removes the exact listener, duplicate registration does
not let a second signal take ownership of the original listener, and passive
listeners cannot cancel an event. Removal and one-shot delivery both detach the
abort algorithm, and post-dispatch compaction is linear rather than repeated array
splicing. The Node-host suite passes 100/100 and the unchanged WPT slice remains
52/52. A mutation that retained the listener after signal abort failed the focused
differential with two calls where Node and the implementation require one. The live
NTS check reports 198 primary refusals, 41 cascades, zero JVM-backend refusals, and
no invalid HIR; this is another final-source frontier, not a claim that its language
dependencies are implemented.

At `61b2b5c`, `Event` carries the complete state needed by a non-tree event target:
the four standard phase constants on the constructor and instances, read-only state
accessors, `srcElement`, `composedPath()`, `cancelBubble`, `returnValue`,
`initEvent()`, and the distinct propagation, immediate-propagation, passive and
canceled flags. Ordinary propagation stopping still permits later listeners on the
same target; immediate stopping does not. Dispatch clears both propagation flags
and the path while retaining cancellation and the target, and initialization resets
the mutable initialization state without changing `composed`. This follows the DOM
dispatch state machine where Node's deliberately smaller host `Event` differs. The
environment-relative `timeStamp` remains blocked on the typed current-environment
clock seam; assigning a process-global host clock here would violate the integration
contract. The Node-host suite passes 101/101 and the unchanged WPT slice remains
52/52. A mutation that failed to retire the immediate-stop flag made the focused
redispatch assertion fail with zero calls instead of one. The live NTS check reports
200 primary refusals, 41 cascades, zero JVM-backend refusals, and no invalid HIR. The
two additional primaries are the already-planned general class-value dependency
exposed by canonical `Event` constant references, not a backend regression.

At `8d7d448`, `DOMException` exposes all 25 legacy constants on both the canonical
constructor and its instances, and its `code` getter implements all 22 names that
still have nonzero codes. The three obsolete names (`DOMStringSizeError`,
`NoDataAllowedError`, and `ValidationError`) retain their constants while correctly
producing code zero, matching Node. The Node-host suite passes 102/102 and the
unchanged WPT slice remains 52/52. Removing the `HierarchyRequestError` mapping made
the focused differential fail with zero where Node returns three. The live NTS check
reports 204 primary refusals, 41 cascades, zero JVM-backend refusals, and no invalid
HIR. Compared with the preceding check, no new diagnostic kind appeared; four more
reachable occurrences carry the existing general class-value refusal. The frontier
remains a dependency inventory, not a progress metric.

The upstream evidence now includes Node's pinned, unchanged
`dom/events/EventTarget-add-remove-listener.any.js` fixture. Both Node's recorded
`dom/events` WPT revision and the fixture's Git blob hash are verified before it
runs, and the VM context installs the shared `Event` and `EventTarget` classes
rather than the host globals. This raises the immutable WPT slice to 53/53 while
the Node-host suite remains 102/102.

`FormData` and `URLSearchParams` now compact their ordered entry lists in place
for `set()` and `delete()` instead of allocating replacement arrays. Differential
tests cover mutation through already-live iterators so the allocation change cannot
silently alter Web collection traversal. The Node-host suite passes 103/103 and the
pinned WPT slice remains 53/53. The live NTS check reports 208 primary refusals, 40
cascades, zero JVM-backend refusals, and no invalid HIR. Four primaries are the exact
compiler dependency introduced by the final-form algorithm: assigning the compacted
length back to the private array is not lowered yet. That blocker was reported to the
compiler lane; rebuilding a second array would hide it by restoring the avoidable
allocation this change removes.

`EventTarget` now accepts the standard statically typed listener-object form in
addition to callback functions. It resolves `handleEvent` for each dispatch, calls
it with the listener object as receiver, and retains object identity for duplicate
registration and removal; callable listeners still take precedence over a property
of the same name. The public boundary also observes listener-option dictionaries at
the Web IDL-defined time, including when `addEventListener()` receives a null
callback, while `removeEventListener()` with a null callback does not inspect its
options. Two more complete unchanged DOM Events WPT fixtures raise the pinned slice
to 58/58, and the Node-host suite passes 105/105. A mutation that used the event
target as the listener-object receiver made the focused differential fail. The live
NTS frontier remains 208 primary refusals, 40 cascades, zero JVM-backend refusals,
and no invalid HIR; this final-form listener union adds no new refusal.

The complete unchanged DOM Events `AddEventListenerOptions` passive and signal
fixtures are now pinned and run with the shared `AbortController`, `Event`, and
`EventTarget`. They cover option observation, truth-value conversion, passive
cancellation, duplicate equivalence, nested once dispatch, abort-driven removal,
and explicit null-signal rejection. The deliberately small harness gained only the
assertion and bounded `async_test` primitives those fixtures require. The immutable
upstream slice passes 74/74 and the Node-host suite remains 105/105. The live NTS
check reports 209 primary refusals, 40 cascades, zero JVM-backend refusals, and no
invalid HIR. The additional primary says `subscribe` is absent from
`EventListenerSignal` even though that interface declares it; it is recorded as a
frontend dependency rather than hidden by weakening the typed signal contract.

The canonical event family now includes typed `CustomEvent<T>` construction,
identity-preserving `detail`, and `initCustomEvent()`. The legacy initializer shares
`Event`'s initialization state transition, so it cannot change either base event
state or detail during dispatch. Constructor and detail behavior are differential
against Node 24; initializer behavior follows the DOM standard because Node 24 does
not expose that legacy member. The complete unchanged EventTarget constructibility
fixture now runs as delivered, including subclassing, taking the pinned WPT slice to
77/77. The Node-host suite passes 106/106. The live NTS check reports 212 primary
refusals, 40 cascades, zero JVM-backend refusals, and no invalid HIR. The three new
primaries are members of generic `CustomEvent<T>`, whose class representation is an
already-planned compiler prerequisite; the class is not made untyped to hide them.

The remaining event subclasses now store their Web IDL state behind read-only
accessors. `CloseEvent` applies default unsigned-short modulo conversion and
USVString conversion, `ErrorEvent` applies unsigned-long and filename USVString
conversion, and `MessageEvent` copies its ports and implements the specified legacy
initializer without allowing reinitialization during dispatch. Node 24's negative
`CloseEvent.code` behavior is deliberately not used as an oracle where it diverges
from the WebSockets IDL; valid close-state construction is still differential. The
Node-host suite passes 107/107, the pinned WPT slice remains 77/77, and the live NTS
frontier remains 212 primary refusals, 40 cascades, zero JVM-backend refusals, and
no invalid HIR. A mutation using 65,535 rather than 65,536 as the unsigned-short
modulus made the focused constructor test fail on the `-1` case.

`AbortSignal.any()` now follows the DOM dependent-signal state machine instead of
building ordinary strong parent subscriptions. Composite signals retain weak links
to their original sources, flatten nested composites, and use source-owned
finalization registries to retire dead dependency records. A source keeps a
composite strongly reachable only while that composite has an active `abort`
listener or internal abort algorithm; removing the last observer releases it. A
bounded forced-collection test proves both halves: unobserved composites disappear,
while an observed composite survives collection and receives the abort. All direct
dependents are marked before any abort steps run, so source events precede dependent
events, nested dependents already expose their final reason during reentrant
listeners, and a second source cannot replace the first reason. Cancellation
algorithms use an intrusive list, making removal constant-time and eliminating the
abort-time snapshot allocation. Abort events created by the runtime are trusted,
while `dispatchEvent()` continues to clear trust for script dispatch. The actual
ECMAScript-private EventTarget dispatch helper also prevents a subclass method named
`dispatch` from intercepting internal dispatch; the unchanged upstream subclass
fixture caught the ordinary-private-method collision during development.

Two complete unchanged `dom/abort` fixtures from Node's pinned WPT checkout add 18
tests, taking the immutable upstream slice to 95/95; the Node-host suite passes
110/110. A mutation that fired the source event before marking dependents made the
focused ordering test fail with `1234` instead of `01234`. The live NTS check reports
236 primary refusals, 36 cascades, zero JVM-backend refusals, and no invalid HIR.
Twenty-eight primary messages name the not-yet-representable `WeakRef` signal state,
and one names the iterable Web IDL sequence boundary. Both are planned compiler and
runtime dependencies; replacing them with strong links or an array-only API would
restore a leak or narrow the final API. The unchanged `AbortSignal.timeout` fixture
is not claimed yet: the public one-argument signature still depends on the typed
current-environment scheduler/clock seam, and a process-global timer is not an
acceptable substitute.

Readable stream chunk queues and pending-read queues now retain stable backing
arrays. Emptying either queue shortens it in place, and crossing the existing
1,024-entry compaction threshold moves only the live suffix before releasing stale
references; neither path allocates a replacement array. A 2,050-entry test drives
both chunk and pending-capability compaction and proves FIFO values and terminal
state on each path. Mutating the chunk source offset by one makes the focused test
fail at expected value 1,026 with 1,027. The Node-host suite passes 111/111, the
pinned WPT slice remains 95/95, and the live NTS frontier remains 236 primary
refusals, 36 cascades, zero JVM-backend refusals, and no invalid HIR. The compiler
already classifies the stream's capability arrays under the planned
`PromiseWithResolvers` representation dependency; the allocation-stable source did
not introduce another diagnostic category.

`EventTarget` dispatch no longer allocates a listener-array snapshot. Each dispatch
captures its starting length, so listeners added by a callback remain invisible to
that dispatch while a nested dispatch sees the then-current list. Removals leave
tombstones only while some dispatch is active; the outermost dispatch compacts once,
and a removal outside dispatch compacts immediately instead of retaining the dead
listener indefinitely. A forced-collection assertion verifies that ordinary
add/remove releases the callback. Replacing the fixed dispatch boundary with the
live array length makes the focused test invoke the newly added listener too early,
producing `outer,nested,late` rather than `outer,nested`. The Node-host suite passes
112/112 and the pinned WPT slice remains 95/95. The live NTS frontier is 237 primary
refusals, 36 cascades, zero JVM-backend refusals, and no invalid HIR; the one
additional primary is the already-reported in-place array-length assignment gap.
Restoring the snapshot allocation merely to suppress that diagnostic would regress
the intended final implementation.

The HTTP/1 connection pool now keeps queued acquisitions in an intrusive FIFO
instead of an array. Each waiter pays three explicit fields (`previous`, `next`, and
`queued`); in return, cancellation and dispatch unlink in constant time without a
replacement `filter()` allocation or a suffix-moving `splice()`. The pump still
walks past a waiter blocked by its per-origin limit, so one saturated origin cannot
head-of-line block another origin while global capacity remains. A 2,050-waiter
test cancels every third acquisition, checks the queue limit and exact pending
count, then proves that every survivor receives one reused connection in FIFO
order. A separate two-origin case protects the skip rule. Corrupting removal of the
queue head strands the stress case until its eight-second timeout; stopping at a
per-origin-blocked waiter likewise times out the independent-origin case. The
Node-host suite passes 114/114 and the pinned WPT slice remains 95/95. The live NTS
frontier is 239 primary refusals, 36 cascades, zero JVM-backend refusals, and no
invalid HIR. Relative to the preceding 237/36 inventory, the only primary-message
movement is one fewer hierarchy diagnostic for `unsubscribe` and three additional
observations of the existing unrepresentable `PromiseWithResolvers.result`
property; the queue introduces no new underlying compiler dependency.

WebSocket `send()` now accepts the complete `ArrayBufferView` branch of the
standard `BufferSource` union rather than only `Uint8Array`. It snapshots exactly
the view's `byteOffset`/`byteLength` range, so `DataView` and non-byte typed arrays
cannot expose unrelated prefix/suffix bytes or later backing mutation. Text and
close-reason sizing now call the canonical allocation-free `utf8Length()` routine
instead of allocating a byte array that the transport would immediately encode a
second time. The exact same-task `bufferedAmount` assertion is 10 for `hello 💙`,
not its eight UTF-16 code units. A wrong-zero-offset mutation sends
`99,1,2,3`/`99,99,5,6` instead of the two expected four-byte view ranges, and a
code-unit-count mutation reports 8 instead of 10. The Node-host suite passes
115/115 and the pinned WPT slice remains 95/95. The live NTS frontier remains 239
primary refusals, 36 cascades, zero JVM-backend refusals, and no invalid HIR. The
broader final signature replaces an `instanceof`-representation refusal with the
already-planned `ArrayBufferView` union-representation refusal; it adds no new
underlying compiler dependency.
