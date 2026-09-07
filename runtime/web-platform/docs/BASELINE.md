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

The canonical Blob constructor now consumes the Web IDL sequence as an
`Iterable<BlobPart>` exactly once instead of exposing an array-only substitute.
`Blob.text()` feeds each immutable stored chunk through one streaming decoder and
joins the resulting text, avoiding the previous full-size byte materialization
before decoding. A split `E2 82 AC` fixture proves decoder state crosses three Blob
parts; disabling streaming yields `���!` instead of `€!`. The Node-host suite passes
116/116 and the pinned WPT slice remains 95/95. The live NTS frontier is 238 primary
refusals, 36 cascades, zero JVM-backend refusals, and no invalid HIR. Compared with
the preceding inventory, two array-of-union parameter refusals become two additional
instances of the planned `Iterable` representation dependency, while one generic
method-call refusal disappears; there is no new underlying dependency.

This is not yet the canonical Blob reconciliation promised by the integration plan.
The richer `runtime/node` Blob still owns provider-backed readers, native line-ending
conversion, fuller stream types, and the Node object-URL registry. Shared ownership
must absorb the provider-neutral storage and semantics without losing those Node
capabilities; Node keeps only filesystem/native-ending/object-URL provider edges.
That move remains sequenced behind the typed current-environment provider lookup and
the full Streams/BYOB surface, rather than introducing another global constructor or
narrowing Node's existing API to the current default-reader subset.

`Headers.set()` and `Headers.delete()` now compact the exclusively owned ordered
field list in place. A replacement remains at the first matching field's wire
position, later duplicates disappear, and deletion truncates the live suffix without
allocating a second list. `Headers.get()` keeps the allocation-free single-value path
and gathers an array only after finding a duplicate, then joins once instead of
successively rebuilding the combined string. A 2,050-field test exercises duplicate
replacement and deletion, preserves the exact first position, and checks the final
cardinality. Mutating the replacement branch to rewrite every duplicate leaves 683
`target` entries instead of one, so the test proves the compaction rather than merely
the final lookup value. The Node-host suite passes 117/117 and the pinned WPT slice
remains 95/95. The live NTS frontier is 240 primary refusals, 36 cascades, zero
JVM-backend refusals, and no invalid HIR. The two additional primaries are the two
intentional `list.length = write` truncations, both instances of the existing
array-length/property-assignment lowering gap; retaining replacement arrays merely to
hide that temporary compiler limitation would regress the intended final form.

`URLSearchParams` now implements all three standard initializer branches: strings,
outer iterables whose inner objects are consumed as exactly two-item iterables, and
records in Web IDL property order. Inner generators work, values are converted to
USV strings at the public boundary, and zero-, one-, or three-item entries throw
rather than being truncated by tuple destructuring. The typed input names the inner
requirement as `Iterable<string> & object`, so primitive strings are rejected without
discarding custom iterable pairs. A mutation that accepts extra items makes the
focused test fail with a missing expected `TypeError`.

The form codec no longer builds a regex-replaced input or repeatedly appends encoded
fragments to a growing string. Decoding maps `+` while scanning the UTF-8 bytes;
encoding counts once, fills one exact ASCII byte buffer using a constant uppercase
hex table, and decodes that buffer once. Collection serialization gathers its final
pieces and joins once. This is an allocation-shape result, not a measured throughput
claim; the differential includes an 8,200-code-unit mixed long value as well as lone
surrogates, malformed escapes, iterable/record construction, and runtime coercion.
The Node-host suite remains 117/117 and the pinned WPT slice remains 95/95. The live
NTS frontier is 241 primary refusals, 41 cascades, zero JVM-backend refusals, and no
invalid HIR. Relative to 240/36, the regex literal, numeric `toString`, and one
two-name iteration observation disappear; the final initializer types expose the
planned union/intersection representation work, and correct boundary coercion exposes
five downstream cascades behind the existing `unknown` conversion and text-encoding
dependencies. One additional typed-array `subarray` observation is an existing
typed-memory dependency, not a new semantic category.

`FormData` now selects its Web IDL overload at runtime rather than treating every
non-string input as a file. Values such as numbers, booleans, null-like host inputs,
and ordinary objects take the string path; Blob values retain the file path. The
public overloads remain statically precise. Their implementation uses a rest-tuple
arity (`[] | [string | undefined]`) because explicit third-argument `undefined`
still selects the Blob overload: a string value must throw, while a Blob uses its
default filename and a File keeps its identity. This expresses observable arity
without the `arguments` object, which is a permanent language non-goal. Renaming a
File produces a distinct File but preserves its media type and `lastModified`.
Names, values, and supplied filenames use the shared USV-string boundary, and the
entry list is now explicitly owned while its live iterator uses ordinary iteration
without indexed-access assertions.

A differential covers primitive and object coercion, a numeric filename, File
identity and metadata, and both explicit-`undefined` overload outcomes. Weakening
the arity check makes it fail with a missing expected `TypeError`. The Node-host
suite passes 118/118 and the pinned WPT slice remains 95/95. The live NTS frontier
is 242 primary refusals, 42 cascades, zero JVM-backend refusals, and no invalid HIR.
Relative to 241/41, two rest parameters with a currently unrepresentable tuple-union
element and their length access replace the earlier array-property assignment and
the old `FormData#convert` method refusal. Two correct boundary-coercion cascades
replace that method cascade. `Date.now` no longer appears because the enclosing
top-level helper is refused earlier; provider-owned current time is still required
for a newly wrapped Blob and has not been removed or worked around.

`Headers` now applies the Fetch IDL's `ByteString` conversion at every public name
and value boundary and validates every sequence element as an object iterable with
exactly two converted items. Primitive names and values therefore coerce once,
characters through U+00FF remain valid input to later HTTP validation, higher code
units and symbols throw during `ByteString` conversion, inner generators work, and
one-, three-, or primitive-string entries can no longer be silently destructured.
The shared `DOMString` conversion is the single first stage for both `ByteString`
and `USVString`; its string fast path allocates nothing and keeps their distinct
post-conversion rules explicit.

A differential covers public-method coercion, an inner generator, every malformed
pair length, a primitive inner string, the U+00FF boundary, and symbol rejection.
Weakening the exact pair check to accept a third item makes the focused test fail
with a missing expected `TypeError`. The Node-host suite passes 119/119 and the
pinned WPT slice remains 95/95. The live NTS frontier is 243 primary refusals, 53
cascades, zero JVM-backend refusals, and no invalid HIR. Relative to 242/42, the one
new primary is the intended `Iterable<string> & object` representation that excludes
primitive strings statically. Eleven new cascades are the visible call graph from
header users through the shared boundary conversion; they are not eleven separate
features. The source remains in final form and depends on the planned intersection
and boundary-string-conversion lowering rather than weakening either contract.

`Response` now applies Web IDL conversion before semantic validation. Status values
use the default `unsigned short` conversion before the 200..599 range check, so
fractional, string-like, wrapped, null-like, non-finite, BigInt, and Symbol inputs
take the specified conversion or failure path rather than being validated as if they
were already TypeScript numbers. Status text uses the shared `ByteString` boundary
before the HTTP reason-phrase validation, and a null or undefined init dictionary is
empty while primitive dictionaries fail. `BodyInit` now names the complete
`ArrayBufferView` family instead of the `Uint8Array` special case. Runtime scalar
bodies take the union's USV-string fallback and acquire
`text/plain;charset=UTF-8`; symbols still fail string conversion.

A differential covers fractional, string, wrapped, null-like, non-finite, BigInt,
Symbol, and object-conversion cases against the Node host. Removing the scalar
body's content type makes the focused test fail with `null` instead of
`text/plain;charset=UTF-8`, proving that the assertion observes the conversion
branch. The Node-host suite passes 120/120 and the pinned WPT slice remains 95/95.
The live NTS frontier is 245 primary refusals, 53 cascades, zero JVM-backend
refusals, and no invalid HIR. Relative to 243/53, the two additional primaries are
the two shared numeric helpers now using JavaScript `ToNumber` (`+value`) before
their typed Web IDL conversion. That operator support is a compiler dependency;
validating pretyped numbers or using `Number()` would change BigInt semantics and
is not an acceptable source workaround.

`Request` and `Response` now separate Web IDL conversion from their constructor
algorithms. Request input is converted to a USV string before its init dictionary;
the dictionary then reads and converts `body`, `credentials`, `duplex`, `headers`,
`method`, `redirect`, and `signal` in lexicographic member order before parsing the
URL. Response converts its body first and then `headers`, `status`, and `statusText`.
Header iterables are consumed at the member's conversion point, and every property
is read exactly once. Null or undefined dictionaries are empty; primitive
dictionaries fail. Methods use `ByteString` before token/forbidden-method checks,
and supported enums use `DOMString` before membership checks. Request inputs and
scalar bodies use `USVString`, while a non-null signal is branded as the canonical
`AbortSignal`.

Body conversion does not consume streams or copy buffer sources. Materialization is
a distinct internal operation, so a long scalar string is normalized exactly once
rather than rescanned merely to preserve argument ordering. The differential covers
input and method conversion, invalid dictionaries, one-shot property access, eager
header-iterator consumption, body content type, and the exact observable order on
both constructors. Moving Response status conversion ahead of headers makes the
focused test report `body,status,headers,...` instead of the specified sequence.

The Node-host suite passes 121/121 and the pinned WPT slice remains 95/95. The live
NTS frontier is 247 primary refusals, 57 cascades, zero JVM-backend refusals, and no
invalid HIR. Relative to 245/53, the net two-primary increase consists of three
final-form body-union/nullability observations replacing one now-concrete converted
Headers property. The four new cascades are the visible calls from the three enum
converters into `DOMString` conversion and from public method normalization into
`ByteString` conversion. They expose the planned union and boundary-conversion work;
they are not separate runtime features and were not hidden with altered source
semantics.

The canonical event constructors and `EventTarget` methods now perform their Web IDL
boundary conversion explicitly. Required arguments are distinguished from explicit
`undefined` with typed rest tuples rather than the permanently unsupported
`arguments` object. Constructor arguments convert left to right; inherited event
dictionaries read `bubbles`, `cancelable`, and `composed` before each derived
dictionary's lexicographically ordered members. Every property and iterable is
consumed once. `MessageEvent` converts `lastEventId` as `DOMString`, `origin` as
`USVString`, and copies its ports sequence. `CloseEvent.reason` and
`ErrorEvent.filename` are `USVString`; `ErrorEvent.message` remains `DOMString`, and
a missing `ErrorEvent.error` remains `undefined`. Legacy initializer methods perform
all argument conversion before the dispatch-state guard, including rejecting an
explicit null ports sequence.

`EventTarget` converts `type`, callback, and options before applying null-callback or
duplicate-listener semantics. Its dictionary order is inherited `capture` followed
by `once`, `passive`, and `signal`. The `(ListenerOptions or boolean)` union sends
objects through dictionary conversion and other primitive values through Web IDL
boolean conversion. This deliberately differs from pinned Node 24.20.0, which
rejects numeric and symbol options. Pinned Node also reads the native `Event` init
dictionary before `type`, splits `CustomEvent` conversion around `type`, and reads
`CloseEvent.code` before inherited `composed`; the shared implementation follows the
normative DOM/Web IDL order rather than copying those host deviations.

Listener signals now use the public canonical `AbortSignal` type and an internal
unique-symbol brand shared through a cycle-free contract module. A merely structural
object with `aborted` and `subscribe` members is rejected. Converted constructor
dictionaries and listener options do not allocate transient result records: values
are held in typed locals and committed only after conversion completes. This is an
allocation-shape result, not a measured throughput claim.

Swapping `once` and `passive` conversion made the focused mutation fail with
`capture,passive,once` instead of `capture,once,passive`. The Node-host suite passes
123/123 and the unchanged pinned WPT slice remains 95/95. The live NTS frontier is
253 primary refusals, 57 cascades, zero JVM-backend refusals, and no invalid HIR.
Relative to 247/57, eight final-form rest-tuple boundaries, one iterable/intersection
ports boundary, and the computed unique-symbol brand check replace four older
diagnostics for the structural signal and event-init types, a nullability case, and
an erased-value use. The net six-primary increase is therefore an exact compiler
dependency inventory, not a runtime regression and not a reason to weaken the final
API.

Provider exception-report callbacks no longer leak through the public constructors.
`EventTarget` has its specified zero-argument construction surface, extra JavaScript
arguments are ignored, and specialized targets bind their provider reporter only
after base construction. `AbortController` likewise ignores extra arguments, while
direct `AbortSignal` construction throws `TypeError` behind an unexported
construction key. Static abort factories, controllers, and internal request signal
creation retain canonical `AbortSignal` identity. The request path uses an internal
module-level factory rather than allocating and immediately discarding a controller.
WebSocket listener exceptions still reach its owning scheduler through the protected
provider seam. The remaining explicit scheduler parameter on
`AbortSignal.timeout()` is the already-recorded current-environment dependency; this
change does not replace it with process-global state.

Restoring the old reporter-taking `EventTarget` constructor made the focused mutation
fail with one reported exception instead of zero. The Node-host suite passes 124/124
and the unchanged pinned WPT slice remains 95/95. The live NTS frontier is 254
primary refusals, 57 cascades, zero JVM-backend refusals, and no invalid HIR. The
single additional primary is another occurrence of the existing unrepresentable
`WeakRef[]` signal-state dependency reached through the internal fresh-signal
factory; it is not a new feature or a backend refusal.

The Encoding API now applies its complete Web IDL boundary before the existing UTF-8
algorithm. `TextEncoder.encodeInto()` enforces both required arguments, converts its
source to `USVString` before validating the destination, and accepts only a
`Uint8Array`, including one backed by shared storage. This intentionally differs
from pinned Node 24.20.0, which rejects non-string sources despite the normative
`USVString` declaration. `TextDecoder` converts its `DOMString` label before the
lexicographically ordered `fatal` and `ignoreBOM` dictionary members, supports every
specified UTF-8 label, and exposes readonly attributes rather than writable public
fields. Decode options are converted before decoder state can change.

`TextDecoder.decode()` accepts the complete `AllowSharedBufferSource` boundary:
`ArrayBuffer`, `SharedArrayBuffer`, and every `ArrayBufferView`, while reading exactly
the view's byte range. Its streaming state now distinguishes whether the preceding
call requested no flush. A fatal call rolls BOM serialization state back to the
start of that call, so output discarded by the exception is not remembered while
BOM state established by an earlier successful streaming call is retained. The
zero-input flush path reuses a private empty view instead of allocating one per
call. Required-argument and dictionary checks now live in the shared Web IDL module
and are reused by Events and Fetch rather than maintained as divergent copies.

Removing `USVString` conversion from `encodeInto()` makes the focused mutation fail
on explicit `undefined` before any bytes can be reported. The Node-host suite passes
127/127. Three additional complete, unchanged files from the pinned Node WPT checkout
cover `encodeInto`, optional decoder arguments, and decoder input copying, expanding
the immutable upstream slice from 95 to 211 tests; all 211 pass. The WPT harness
installs one coherent typed-memory constructor family into its VM so the tested Web
values and WebAssembly-created shared buffers belong to the same host environment.

The live NTS frontier is 260 primary refusals, 58 cascades, zero JVM-backend
refusals, and no invalid HIR. Relative to 254/57, the six new primaries are the
final-form `AllowSharedBufferSource` union, its `SharedArrayBuffer` brand check, and
four required/optional rest-tuple representation observations. The one net cascade
is the now-explicit decoder-label call into shared `DOMString` conversion. These are
the typed-memory and boundary-conversion prerequisites already owned by the plan;
the source does not narrow the API to what the current lowering can represent.

`Blob` now owns one provider-neutral immutable-storage model for memory-backed and
reopenable externally backed data. Public buffer sources are copied once, while
Blob composition and slicing share immutable stored ranges. External construction,
composition, and slicing remain lazy; every consumer opens an independent exact
range, reads in bounded chunks, and closes it on success, read failure, or stream
cancellation. `bytes()` and `arrayBuffer()` allocate one result buffer rather than
repeatedly concatenating, memory-backed `text()` preserves UTF-8 decoder state
across stored-part boundaries, and memory streams never expose Blob-owned storage.
The internal provider seam preserves already-decided metadata so a target API such
as Node's `fs.openAsBlob` can retain its own media-type behavior without putting a
filesystem into shared code.

The host suite passes 130/130 and the unchanged pinned WPT slice remains 211/211.
A deliberately weakened external-stream bound accepted a 65,537-byte chunk after
requesting 65,536 and made the focused test fail with a missing expected rejection;
the restored implementation rejects the provider violation with `NotReadableError`
and closes the reader. The root TypeScript solution build remains green, and the
source contains no `any`, assertion cast, proxy, reflection, or prototype mutation.

The live NTS frontier is 270 primary refusals, 62 cascades, zero JVM-backend
refusals, and no invalid HIR. Relative to 260/58, the new final-form storage model
exposes ten net lowering refusals and four call-graph cascades around the external
reader interfaces, iterable Blob parts, typed-array views/copies, and asynchronous
cleanup. Those are instances of the plan's existing interface/hierarchy,
iteration, typed-memory, and async representation prerequisites; the storage API
was not weakened or made eager to suppress them.

The File API constructor layer now performs the normative Web IDL conversions in
their observable order. `Blob` consumes its input sequence before reading
`endings` and `type`, converts arbitrary non-buffer parts to `USVString`, and only
then snapshots every buffer source so option getters cannot move the copy before
the binding algorithm says it occurs. `File` converts file bits, name, inherited
Blob options, and `lastModified` in declaration order; `lastModified` uses signed
Web IDL `long long` conversion and obtains its omitted default from the owning
platform runtime's wall clock. Native newline conversion likewise reads the
owning provider's declared line ending rather than consulting host globals from
shared TypeScript. Blob slicing converts `[Clamp] long long` indices and its
`DOMString` media type before operating on shared immutable ranges.

The host suite passes 133/133. Three additional complete, unchanged files from
the pinned Node WPT checkout cover the Blob constructor, Blob slicing, and the
File constructor, expanding the immutable upstream slice from 211 to 483 tests;
all 483 pass. Reversing `endings` and `type` conversion makes the focused mutation
fail with the observed order `type,endings` instead of `endings,type`. The root
TypeScript solution remains green, and the compiled shared source adds no `any`,
assertion cast, proxy, reflection, or prototype-chain workaround. Exact reflective
`File.length === 2` is not claimed: distinguishing an omitted required parameter
from explicit `undefined` while retaining emitted function arity requires the
permanent `arguments`/property-descriptor non-goals. Required-argument behavior,
explicit-`undefined` conversion, and `Blob.length === 0` are covered directly.

The live NTS frontier is 279 primary refusals, 62 cascades, zero JVM-backend
refusals, and no invalid HIR. Relative to 270/62, the nine new primaries are exact
instances of the existing typed-memory/view and union representation work,
iterable/runtime-class recognition, rest-tuple representation, computed `in`, and
the new typed platform wall-clock method. These are dependencies already owned by
the integration plan. The final-form File API surface was not narrowed, and the
host boundary was not moved into compiled TypeScript, to reduce that count.

`FormData` now implements the complete server/mobile Web IDL surface without
exposing an HTML-form substitute. Its constructor accepts omission or explicit
`undefined` and rejects other form values; every named operation performs receiver
branding and required-argument checks before conversion. `append()` and `set()`
select their string/Blob overload from the runtime values, preserve Web IDL
conversion order, keep an existing `File` by identity when no filename is supplied,
and obtain the timestamp for a generated `File` from the owning environment.
`set()` and `delete()` retain the allocation-stable in-place compaction introduced
earlier, while replacement mutates the exclusively owned stored entry rather than
allocating another pair.

The collection now returns one branded `FormData Iterator` implementation for
entries, keys, values, and default iteration. It is live under mutation, returns a
fresh pair only for entry iteration, has no generator-only `return()` or `throw()`,
and inherits the standard `Iterator` prototype so current iterator helpers operate
on it. The stored list and iterator state use ECMAScript private fields, leaving no
enumerable implementation properties. `forEach()` validates its callback even for
an empty form, applies `thisArg`, observes mutation live, and walks stored entries
without allocating transient pairs.

Nine complete unchanged non-DOM `xhr/formdata/*.any.js` WPT fixtures add 40 cases,
expanding the immutable upstream slice from 483 to 523 tests; all 523 pass. The
Node-host suite passes 136/136, and the root TypeScript solution remains green. A
clock mutation made the environment-time assertion observe the host wall clock, a
required-argument mutation accepted an omitted value, a callback-validation
mutation accepted `null`, an iterator-brand mutation exposed `[object Generator]`,
and an iterator-result mutation created `done` before `value`; every focused run
failed before the mutation was restored.
The source contains no `any`, assertion cast, proxy, reflection, or prototype
mutation. Exact reflective method `.length` values are not claimed: the typed rest
tuples that distinguish omission from explicit `undefined` necessarily change the
emitted arity, while `arguments` and function property descriptors are permanent
language non-goals. Call behavior and conversion order are covered directly.

The live NTS frontier is 289 primary refusals, 64 cascades, zero JVM-backend
refusals, and no invalid HIR. Relative to the File API frontier of 279/62, the net
movement exposes the final FormData constructor/operation rest tuples, private
iterator state and standard `IterableIterator` return types, stored-entry property
assignment, and direct environment-clock call graph. Four primaries explicitly name
the `IterableIterator` return representation. These are instances of the plan's
existing class/interface, iteration, absence/arity, property-assignment, and
environment-access prerequisites; the native `Iterator` base did not produce
invalid HIR. The counts are a dependency frontier, not ten newly completed or
regressed language features.

The first full-Streams foundation now provides the Standard's single shared
queue-with-sizes abstraction and the canonical `CountQueuingStrategy` and
`ByteLengthQueuingStrategy` classes. The queue retains the specified running
IEEE-754 total instead of recomputing it, clamps only negative subtraction residue,
and uses a compacting head index so FIFO dequeue does not move the live suffix.
Readable streams now use that same primitive that writable streams will consume.
Strategy extraction reads `size` before `highWaterMark`, applies JavaScript
`ToNumber` behavior, accepts positive infinity only as a high-water mark, and errors
the stream when a size callback fails or returns a non-finite or negative value.
Each built-in strategy exposes one stable, non-constructible, correctly named size
function per environment rather than allocating a closure per instance.

Three complete unchanged fixtures from Node's pinned Streams checkout add 29 cases:
the built-in queuing-strategy surface, readable bad-strategy propagation, and the
constructor's observable conversion order. The immutable WPT slice therefore grows
from 523 to 552 tests, all passing; the complete Node-host suite passes 137/137 and
the root TypeScript solution remains green. The WPT VM harness accepts either the
host realm's injected `TypeError` or the VM intrinsic used by a failed `new` syntax
operation; it does not turn a different error kind into a pass. Removing the
queue-total negative clamp makes two pinned floating-point cases fail, proving that
the shared arithmetic is observed rather than merely exercised.

The source audit finds no `any`, assertion cast, proxy, reflection, descriptor, or
prototype workaround in the Streams source. The live NTS frontier is 302 primary
refusals, 67 cascades, zero JVM-backend refusals, and no invalid HIR. Relative to
289/64, the final queue and strategy classes expose 13 net primary instances and
three cascades in the already-planned class/interface, typed-view, dictionary,
generic collection, and numeric-conversion dependencies. A generic arity helper
now preserves its caller's tuple element type; this removed an invalid-HIR mismatch
without weakening the public strategy types to `unknown`.

The default writable-stream state machine now implements serialized start, write,
close, error, and abort transitions; exact backpressure-promise epochs; sink-owned
abort signaling; close/abort precedence; reentrant size callbacks; and writer lock
and release semantics. Its chunk and request queues are separate because a chunk
remains in the size-accounted queue while its write request is in flight. Both use
head-indexed FIFO storage, clear consumed references immediately, and compact only
after a substantial sparse prefix accumulates. Closing or erroring clears the sink
and size algorithms, and the transient start algorithm is released immediately
after invocation rather than being retained for the stream lifetime.

The public operations have their specified zero runtime arity, including an omitted
write chunk being delivered as `undefined`. Three reachability tests retain the live
stream while proving that its completed sink/strategy, transient start callback,
and already-consumed first chunk can each be collected at the Standard-defined
point. Removing size-algorithm clearing, start-algorithm clearing, or the consumed
queue-slot clear makes the corresponding bounded weak-reference test fail. Removing
the in-flight-write guard invokes the first queued chunk twice and makes the focused
serialization test fail immediately.

All fifteen complete, unchanged `streams/writable-streams/*.any.js` fixtures from
the pinned Streams checkout are now hash-verified and executed, adding 191 upstream
cases to the previous 552. At this checkpoint 742 of 743 pass. The sole visible
failure overwrites each captured sink callback's own `.call` and `.apply` properties:
Web IDL requires the method to be captured once and later invoked with the original
sink as its callback `this` value. Re-reading the sink property, using a forgeable
callback property, `Reflect`, prototype tricks, binding wrappers, or a host-only
adapter would violate either that semantic or the governing integration contract.
The exact missing compiler operation is a typed call through a function value with
an explicit receiver. It has been reported to the compiler lane and remains visible;
the 742 passing cases are not recorded as a green upstream gate. A diagnostic-only
substitution of `Reflect.apply` made all 743 pass, proving the receiver operation is
the only remaining failure, and was then restored rather than retained as a forbidden
dynamic fallback.

The complete local Node-host suite passes 143/143 with zero skipped, and the root
TypeScript solution remains green. After consolidating both writable queues onto the
shared generic FIFO, the live NTS check reports 390 primary lowering refusals, 71
cascades, zero JVM-backend refusals, and no invalid HIR. Two primaries explicitly
identify the existing missing method-call shape for `call`; the other frontier
movement is dominated by final-form writable state, generic class/interface
representation and specialisation, promise capabilities, optional/union values, and
queue storage. These counts are a dependency inventory, not completed compiler work.
This slice remains incomplete while the receiver-aware callback case is red; the
failure stays in the committed evidence instead of being hidden by a forbidden
dynamic fallback.

The default readable-stream core now captures each underlying-source algorithm
exactly once, validates the source dictionary and callback members in Web IDL
order, invokes `start` and `pull` synchronously, and preserves the original source
as the callback receiver. Start exceptions therefore escape the constructor while
pull exceptions error the stream; promise results are observed only after the
algorithm itself has run. Closing or erroring settles `reader.closed` before pending
read requests and releases the captured source and strategy algorithms. Pending
read capabilities use the shared FIFO rather than a second queue implementation.

ReadableStream, its controller, and its default reader now keep observable state in
ECMAScript private fields. Script may add public properties named `source`, `state`,
`controller`, `stream`, or `closedCapability` without shadowing implementation
state. Replacing the private source with the earlier public field makes the focused
local test wedge before producing its first chunk. Independently, the upstream
harness now bounds each promise test and routes asynchronous step failures into its
result, so the equivalent failure in an unchanged fixture becomes a verdict instead
of hanging or crashing the whole gate. Tee also defers source-close propagation
while its final read is being distributed. Removing that guard makes the unchanged
reentrant-strategy fixture lose the final chunk in both branches and changes the
aggregate upstream result from 861/862 to 860/862.

Seven additional complete, unchanged `streams/readable-streams/*.any.js` fixtures
and their upstream `rs-utils.js` support file are pinned by exact Git blob hash.
They add 119 cases covering bad sources, cancellation, default readers, count
strategy integration, garbage-collection reachability, general state/locking, and
reentrant strategies. All 119 readable cases pass. Across the complete pinned Web
slice, 861 of 862 pass; the only failure is still the separately documented
writable callback-receiver operation. The complete local Node-host suite passes
144/144 and the root TypeScript solution remains green. The initial `pipeTo()` and
`pipeThrough()` state transfer is present, but full piping, byte/BYOB, transform,
and async-iteration fixture families are not claimed by this checkpoint.

Against the current compiler frontier, the shared project reports 437 primary
`NTS1001` refusals, 77 dependent `NTS1003` cascades, zero `NTS4xxx` JVM-backend
refusals, and no invalid HIR. Two primaries still name the missing explicit-receiver
`call` operation. One additional `NTS1004` currently treats a type-only
`WebPlatformRuntime` import as a runtime module edge and consequently reports a
false `standardBodyPolicy` temporal-dead-zone cycle. Repository TypeScript erases
that edge, and directly importing the emitted `Response` module succeeds in the
pinned Node runtime. This compiler module-graph defect has been reported; valid
final-form source is retained rather than reorganized to hide a type-only edge.

Readable teeing now represents concurrent demand and terminal observation as one
explicit state machine. While a source read is in flight, another branch request
sets a follow-up-read flag rather than disappearing into the same promise. Source
close or error is held until the in-flight result has been cloned and delivered to
both branches, then applied synchronously before consumer promise continuations can
read stale queued data. This preserves the final chunk for a fast branch while an
error still clears unread chunks from a slower branch. Removing the follow-up flag
makes the pinned emptiest-queue case record one source pull instead of two; delaying
terminal application by one more promise turn makes the error-propagation case
fulfill a read that must reject.

The complete unchanged `streams/readable-streams/tee.any.js` and
`templated.any.js` fixtures, plus `rs-test-templates.js`, add 117 hash-verified
upstream cases. All 117 pass, taking the aggregate pinned result to 978/979. The
remaining failure is still only the writable explicit-receiver compiler dependency.
The local Node-host suite remains 144/144 and the root TypeScript solution is green.
Failure output now retains host error stacks, so an upstream assertion points to its
fixture and promise branch rather than collapsing to a message with no location.
The live NTS frontier is 441 primary `NTS1001` refusals, 77 `NTS1003` cascades, zero
JVM-backend refusals, the same type-only-edge `NTS1004`, and no invalid HIR.

Readable-stream async iteration is now an explicit serialized request state machine
rather than a native async generator. It acquires the default reader synchronously,
orders concurrent `next()` and `return()` requests, releases the lock at the
specified terminal step, waits for cancellation without retaining the lock, and
preserves the stream error only for the request that observes it. The options
dictionary uses Web IDL truth-value conversion, including for direct calls through
`Symbol.asyncIterator`.

`ReadableStream.from()` now opens the async protocol in preference to the sync
protocol, captures iterator methods once with their specified receiver, pulls only
in response to demand, awaits values supplied by a synchronous iterator, and
validates every iterator and iterator-result boundary. Cancellation invokes and
awaits `return(reason)` while normal exhaustion does not close an already-complete
iterator. A mutation changing its high-water mark from zero to one made the focused
local test observe `next()` before any read, proving that the no-prefetch assertion
is live. The complete local Node-host suite passes 146/146.

Two complete unchanged pinned fixtures, `async-iterator.any.js` and `from.any.js`,
add 89 cases. All `ReadableStream.from()` cases and every behavioral async-iterator
case pass, for 88/89 in this tranche. The remaining structural case requires the
Web-IDL-generated iterator prototype to inherit from `%AsyncIteratorPrototype%` and
to own enumerable `next` and `return` methods without `throw`. A TypeScript class
cannot express that reflective prototype/descriptor shape, and the governing
profile explicitly rejects prototype and descriptor manipulation in shared source.
The mismatch therefore remains visible instead of adding `Object.setPrototypeOf`
or `Object.defineProperty` as a host-only workaround. Together with the existing
writable explicit-receiver failure, the aggregate pinned result is 1066/1068.
Because the tested APIs are imported from the host realm while fixtures execute in
a VM realm, the harness installs the host `Object` intrinsic before checking
ordinary iterator-result prototypes; this removes a harness-only realm mismatch but
does not manufacture the missing async-iterator prototype.

The root TypeScript solution remains green and the new Streams source contains no
`any`, assertion cast, proxy, reflection, descriptor, or prototype workaround. The
live NTS frontier is 461 primary `NTS1001` refusals, 79 `NTS1003` cascades, zero
JVM-backend refusals, the same type-only-edge `NTS1004`, and no invalid HIR. The
movement from 441/77 is the final-form iterator protocol, promise capability,
generic class/interface, and explicit-receiver source becoming visible; it is a
dependency inventory rather than implementation progress in the compiler.

The complete unchanged `streams/readable-streams/patched-global.any.js` fixture is
now pinned by its exact upstream blob hash. All five cases pass. Default source,
strategy, reader, pipe, iterator, and tee dictionaries use canonical objects with
own `undefined` members, so omitted arguments never consult a poisoned
`Object.prototype`. Tee's internal branch source likewise owns its `type` member.
Removing that one member makes the upstream prototype-trap case fail and changes
the aggregate from 1071/1073 to 1070/1073, proving that the trap observes the
internal branch construction rather than only the public constructor.

Streams promise observation now uses language-level `await` rather than mutable
`Promise.prototype.then`, `catch`, or `finally` methods. Piping acquires and drives
its reader and writer through module-owned algorithms instead of re-entering their
public prototype methods; the first fresh run before that change passed the
nominal pipe test but later invoked the deliberately patched `releaseLock`, which
terminated the test process. The upstream harness now executes registered cleanup
callbacks even after a rejected promise test and retains cross-realm error stacks,
so prototype mutations cannot poison subsequent fixtures or erase their source
locations.

The five-case tranche is green and the aggregate pinned host result is 1071/1073.
The only two visible failures remain the Web-IDL async-iterator prototype/descriptor
shape and writable callback invocation with an explicit receiver. The complete
local Node-host suite is 146/146 and the root TypeScript solution is green. The
live compiled-source frontier is 508 primary `NTS1001` refusals, 79 `NTS1003`
cascades, zero JVM-backend refusals, the same type-only-edge `NTS1004`, and no
invalid HIR. These counts grew because the final-form internal pipe algorithms and
promise observers are now visible to the compiler; they remain a dependency
inventory rather than a claim of compiler progress.

The complete unchanged `streams/piping/*.any.js` family is now pinned: thirteen
fixtures add 229 cases. The pipe state machine acquires both locks synchronously,
tracks every outstanding write through terminal propagation, honors destination
backpressure without serializing writes that the destination can accept, and waits
for queued writes before applying close, error, cancellation, or abort. Missed
notifications cannot lose the final source chunk: source close and error are held
while a read result is being distributed, then become the next terminal action.
Signal abort, source failure, destination failure, and source/destination close each
retain their distinct `preventAbort`, `preventCancel`, and `preventClose` behavior.

Of those 229 cases, 226 pass. One unchanged test requires a readable byte stream and
BYOB teeing, which belongs to the separately planned byte-controller work. Two
unchanged `then-interception` tests install an inherited `then` on
`Object.prototype`: settling an internal read-result capability through ordinary
ECMAScript promise resolution incorrectly assimilates that property. The Streams
operation is direct promise fulfillment, not `ResolvePromise`; a typed common-runtime
fulfillment primitive is therefore required. Adding an own `then`, changing the
iterator-result prototype, or using descriptor manipulation would make the shared
source observably wrong and is not used.

The complete eleven-file `streams/transform-streams/*.any.js` family adds another
133 pinned cases. The paired state machine implements default identity transform,
readable-side backpressure, writable sequencing, synchronous `start`, asynchronous
`transform`, `flush`, and `cancel`, reentrant strategy calls, controller enqueue,
error and terminate operations, and the Standard's cancellation/error races. It
passes 132 of 133 cases. The one visible miss overwrites captured transformer
callbacks' own `.call` and `.apply` properties and is the same typed
explicit-receiver compiler prerequisite already exposed by WritableStream.

Together the two new families pass 358 of 362 cases, and the aggregate pinned result
is 1429 of 1435. The other two aggregate failures remain the Web-IDL async-iterator
prototype/descriptor shape and the WritableStream explicit-receiver case; none is
hidden behind a host shim. The complete local Node-host suite is 148/148 and the root
TypeScript solution is green. The live compiled-source frontier is 613 primary
`NTS1001` refusals, 79 `NTS1003` cascades, zero JVM-backend refusals, the same
type-only-edge `NTS1004`, and no invalid HIR.

One final-source typing obligation remains deliberately explicit in the current
TransformStream work: when no transform callback is supplied, an arbitrary input
chunk becomes the arbitrary output type. The upstream TypeScript declaration models
that erased boundary with `any`, which this profile rejects. Host conformance is
currently measured with one localized assertion at that exact line; the slice is not
final until the compiler/common-runtime lane supplies the checked erased-value shape
and the assertion is removed. The passing state-machine evidence does not waive the
source audit.

The exported Fetch entry points now obtain their hidden policy and provider state
from the owning `NtsEnvironment`. `new Request(input, init)`, `new Response(body,
init)`, `Response.redirect(url, status)`, and the canonical exported `fetch(input,
init)` have their public signatures; internal transport construction may still pass
the same typed context explicitly. There is no module-global runtime, generated realm
subclass, or host-only constructor wrapper. A local live-network test constructs a
public `Request` and dispatches it through the exported `fetch`, proving that both
look up the runtime installed for the active environment rather than relying on the
old test helper arguments.

Five additional complete, unchanged current WPT fixtures for pure `Headers`
behavior are pinned by Git blob hash. They add 77 source cases for construction,
ByteString validation, casing, combination, `Set-Cookie`, mutation during iteration,
and API structure. One case is explicitly not applicable to the standalone
server/mobile profile: a browser response guard hides `Set-Cookie`, whereas modern
Node/standalone Undici intentionally exposes it through `getSetCookie()`. The
applicability entry names the exact upstream test and its reason, and the runner
fails if the name disappears or is not observed, so this cannot silently become a
stale exclusion.

Of the 76 applicable new cases, 73 pass. The three failures inspect the immediate
prototype and enumerable method descriptors of `Headers` iterators and are the same
canonical Web-IDL iterator-object compiler prerequisite already exposed by readable
stream async iteration; shared source does not manufacture that shape with prototype
or descriptor operations. Across the complete pinned slice, 1502 of 1511 applicable
cases pass, with one separately reported not-applicable case. The other six failures
remain the byte/BYOB tee case, two direct-promise-fulfillment cases, two typed
explicit-receiver callback cases, and the async-iterator structural case. The local
Node-host suite remains 148/148 and the root TypeScript solution is green.

The live NTS check at this checkpoint reports 616 primary `NTS1001` refusals, 78
dependent `NTS1003` cascades, zero JVM-backend diagnostics, zero `NTS1004` module
diagnostics, and no invalid HIR. The previously visible type-only-import cycle is no
longer present. These counts are the current final-source dependency frontier, not
compiled-provider completion.
