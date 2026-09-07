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

The canonical `Request` now carries the complete Fetch object-model metadata rather
than only method, headers, signal, redirect, and credentials. Cache, mode, referrer,
referrer policy, integrity, keepalive, priority, destination, navigation flags, and
duplex are converted and validated in Web IDL dictionary order. Public attributes
are getter-backed read-only values; internal priority remains unexposed. Constructor
validation covers forbidden and no-CORS methods, `only-if-cached`, `navigate`, the
nullable window member, stream duplex, keepalive with a stream body, and referrer
normalization against an explicitly configured environment origin. All validation
precedes transfer of an inherited body. Supplying a replacement body consequently
leaves even a locked or consumed source body alone, while a failed method validation
cannot disturb an otherwise usable source.

Eight complete current WPT Request fixtures and their two META support scripts are
pinned by exact Git blob hash. They add 97 source cases. Of the 96 applicable cases,
all 96 pass. One exact case is recorded as not applicable: the fixture itself marks
its expectation that an empty `FormData` body serialize to an empty string as
unclear, while the multipart serializer and standalone Undici emit the closing MIME
boundary required to make the payload structurally complete. The harness now
applies named applicability entries to both synchronous and promise tests, injects
the canonical `URLSearchParams`, and resolves relative Request URLs through a
declared environment base URL. It still fails if an exclusion is stale or unobserved.

The full pinned host result is now 1598 of 1607 applicable cases, with two named
not-applicable cases. The same nine documented failures remain: three Headers
iterator-shape cases, one readable byte/BYOB tee case, two direct-promise-fulfillment
cases, two explicit-receiver callback cases, and one readable async-iterator shape
case. The local Node-host suite passes 151/151 and the root TypeScript solution is
green. The live compiled-source frontier is 618 primary `NTS1001` refusals, 82
`NTS1003` cascades, zero JVM-backend diagnostics, zero `NTS1004` module diagnostics,
and no invalid HIR. The changed frontier is final Request source reaching existing
compiler dependencies; it is not compiled-provider progress.

The canonical `Response` now carries its complete standalone Fetch object shape.
Its `statusText` and `headers` attributes are getter-backed read-only values, and
the `type` union covers every Fetch response type. `Response.redirect()` performs
Web IDL argument conversion before its algorithm, resolves relative locations
against the owning environment's base URL, validates the converted unsigned-short
status, and returns an immutable header list. `Response.json()` likewise converts
the complete initializer before serializing its data, so observable conversion and
serialization failures occur in the specified order. The body consumer now
validates every stream chunk at runtime as a `Uint8Array`; TypeScript's static
`ReadableStream<Uint8Array>` annotation is not trusted at a JavaScript boundary.

Twelve complete, unchanged current WPT Response fixtures and their support script
are pinned by exact Git blob hash. They add 118 source cases covering constructor
initialization, static factories, locked and disturbed streams, error propagation,
invalid stream chunks, empty bodies, and stream cancellation. All 113 applicable
cases pass. Five exact cases are named not applicable to this standalone harness:
four require the WPT HTTP server, which the harness deliberately does not replace
with host `fetch`, and one assumes an empty multipart body has no wire bytes even
though a structurally complete multipart body contains its closing boundary.

Across the complete pinned slice, 1711 of 1720 applicable cases pass, with seven
named not-applicable cases. The same nine visible failures remain: three Headers
iterator-shape cases, one readable byte/BYOB tee case, two direct-promise-fulfillment
cases, two explicit-receiver callback cases, and one readable async-iterator shape
case. The local Node-host suite passes 152/152 and the root TypeScript solution is
green. The live NTS frontier remains 618 primary `NTS1001` refusals, 82 dependent
`NTS1003` cascades, zero JVM-backend diagnostics, zero `NTS1004` module diagnostics,
and no invalid HIR. Host conformance remains evidence for the shared algorithms;
it does not claim that the pending compiler and provider prerequisites are complete.

The Fetch scheme dispatcher now implements the Fetch Standard's `data:` URL
processor without entering a host networking stack. Percent decoding uses the same
canonical UTF-8 byte writer as the Node URL implementation, forgiving Base64 is a
shared allocation-bounded primitive, and MIME parsing plus serialization preserves
the specified parameter order and quoting. `Request` construction accepts
non-network schemes as the Fetch API requires; unsupported schemes are rejected
asynchronously by fetch dispatch rather than synchronously by the constructor.
Data responses have immutable headers, omit fragments from their response URL,
preserve exact abort reasons, and apply the specified null-body behavior for
`HEAD`.

Two complete current WPT data-URL fixtures and their JSON resources are pinned by
exact Git blob hash. All 154 registered cases pass: 81 in `base64.any.js` and 73 in
`processing.any.js`. These fixtures register most of their cases after an
asynchronous support-resource fetch, which exposed a false-green harness shape: a
single snapshot of pending tests observed only the setup cases. The runner now
drains registrations to quiescence and ratchets the exact per-fixture counts, so
restoring the snapshot behavior fails with 1/81 or 1/73 instead of appearing green.

Across the complete pinned slice, 1865 of 1874 applicable cases pass, with seven
named not-applicable cases. The same nine visible failures remain. The local
Node-host suite passes 153/153, the root TypeScript solution is green, and the
pinned URL constructor/origin and setter corpora remain 892/892 and 278/278. The
live NTS frontier is 619 primary `NTS1001` refusals, 83 dependent `NTS1003`
cascades, zero JVM-backend diagnostics, zero `NTS1004` module diagnostics, and no
invalid HIR. The one-primary, one-cascade movement is newly reachable final source,
not a provider-completion claim.

The environment-owned Blob URL store and Fetch's `blob:` scheme algorithm are now
shared rather than delegated to a host network stack. Object URLs carry RFC 4122
version-4 identifiers, retain the Blob until exact revocation or environment
teardown, resolve with the fragment excluded, and are captured when a `Request` is
constructed. Consequently, revoking after constructing or cloning a `Request`, or
immediately after calling `fetch`, cannot invalidate that request. A second runtime
cannot resolve the first runtime's entry. Providers may select an
implementation-defined opaque-origin serialization such as Node's `blob:nodedata:`
without changing storage or Fetch semantics.

Blob Fetch accepts only `GET`, returns immutable `200 OK` responses with the Blob's
length and type, and implements the Fetch Standard's single byte-range parser and
`206 Partial Content` response. The local oracle covers omitted endpoints, HTTP
tab/space, invalid units and multiple ranges, an endpoint beyond `2^53`, a start at
or beyond the Blob length, zero-length Blobs, oversized suffixes, and zero suffixes.
The last two intentionally preserve the Standard's unusual serialized ranges
(`bytes -14-5/6` and `bytes 6-5/6` for a six-byte Blob); Node `v24.20.0` produced
the same values in a direct comparison.

The complete local Node-host suite passes 155/155 and the root TypeScript solution
is green. The pinned upstream result remains 1865/1874 applicable cases with the
same nine visible failures and seven named not-applicable cases; this tranche does
not relabel unrelated failures. The live NTS frontier is 621 primary `NTS1001`
refusals, 84 dependent `NTS1003` cascades, zero JVM-backend diagnostics, zero
`NTS1004` module diagnostics, and no invalid HIR. The two-primary, one-cascade
movement is new final source reaching existing compiler dependencies.

The exact File API `url-with-fetch.any.js` fixture is not counted yet because it
tests the public `URL.createObjectURL` and `URL.revokeObjectURL` statics. The Node
runtime currently has a separate URL class and Blob URL registry; exposing a
test-only partial `URL` would hide that duplicate identity. This shared storage and
scheme-fetch substrate lands first, while the Node-owned URL implementation is
being reconciled with the canonical Web `URL`. The fixture must be pinned unchanged
when that public identity-preserving surface lands.

## Readable byte streams and BYOB

The shared `ReadableStream` implementation now has a distinct byte-controller state
machine rather than treating byte streams as ordinary streams with `Uint8Array`
chunks. It implements default and BYOB readers, `autoAllocateChunkSize`, transferred
buffer ownership, every current typed-array and `DataView` view kind, `read({ min })`,
partial-element handling, `respond()` / `respondWithNewView()`, reader release with a
still-live BYOB request, and byte-preserving tee and Fetch-body transfer. Byte tee
switches the source between default and BYOB readers according to branch demand and
keeps cloning, cancellation aggregation, close/error propagation and the explicit
NTS backlog limit intact.

Ten complete, unchanged readable-byte-stream WPT fixtures are pinned by exact Git
blob hash. They register 247 cases; all 246 applicable cases pass. The one named
not-applicable case comes from the shared default-reader template: it expects
`value: undefined` from a BYOB read issued after cancellation, while the current
Streams algorithm and pinned Node reference return a new zero-length transferred
view. Dedicated byte-stream cases still cover the distinct rule that a BYOB read
which was already pending when cancellation began settles with `undefined`.
`general.any.js` is 101/101 and `tee.any.js` is 39/39; the adversarial fixtures cover
detached and non-transferable buffers, patched promise observation, minimum fills,
replacement views and response-after-enqueue ordering.

The complete local Node-host and real-socket suite passes 159/159. Across the full
pinned upstream slice, 2112 of 2120 applicable cases pass, with eight named
not-applicable cases. The eight visible failures are outside the byte-stream slice:
three Headers iterator-shape cases, two promise-fulfillment observability cases, two
explicit-receiver callback cases, and the Web-IDL async-iterator prototype/object
shape case. They remain failures rather than being relabeled by this tranche.

At `ee0e8daf`, the live compiled-source frontier is 716 primary `NTS1001` refusals,
92 dependent `NTS1003` cascades, zero JVM-backend diagnostics, zero `NTS1004` module
diagnostics, and no invalid HIR. The increase is the complete final byte-stream and
BYOB source reaching existing compiler dependencies; it is not compiled-provider
progress.

## EventSource

The canonical environment-owned `EventSource` now runs over the shared Fetch and
Streams implementations. It implements the HTML event-stream state machine,
incremental UTF-8 and CR/LF/CRLF parsing, BOM handling, named events, comments,
`data`/`event`/`id`/`retry` fields, incomplete-EOF discard, trusted `open`/`message`/
`error` events, reconnect timing, `Last-Event-ID`, fatal status and MIME handling,
abort, close, environment teardown, and independent line/event buffer limits. A
reconnect inherits the previous last-event-ID buffer when a later response has no
`id` field. Non-ASCII IDs are UTF-8 encoded into Fetch's internal ByteString header
representation, preserving the required wire bytes without weakening the public
`Headers` conversion boundary.

Thirty-one complete, unchanged EventSource WPT fixtures and their four server
resources are pinned by exact Git blob hash at WPT commit
`b89af32bc8f42d678f444eb0703bca015ddcf240`. All 31 cases pass. The deterministic
suite additionally covers fragmented input, buffer limits, cancellation and runtime
shutdown, while the real HTTP test covers split UTF-8, reconnect and header delivery.

At `9f6016c4`, the complete local Node-host and real-socket suite passes 165/165.
Across the full pinned upstream slice, 2143 of 2151 applicable cases pass, with eight
named not-applicable cases. The same eight pre-existing failures remain visible:
three Headers iterator-shape cases, two promise-fulfillment observability cases, two
explicit-receiver callback cases, and the Web-IDL async-iterator prototype/object
shape case. EventSource introduces no upstream failure or exclusion.

The live compiled-source frontier is 724 primary `NTS1001` refusals and 106 dependent
`NTS1003` cascades, with zero JVM-backend diagnostics, zero `NTS1004` module
diagnostics, and no invalid HIR. Relative to the readable-byte-stream checkpoint, the
additional final EventSource source exposes eight primary dependencies and fourteen
dependent call-site cascades; this is a source frontier, not compiled-provider
progress.

## Cookies

The shared runtime now implements the standalone Undici cookie helper shape and an
explicit RFC6265bis cookie policy. The living references were pinned for this tranche
to `draft-ietf-httpbis-rfc6265bis-22` (published 2025-12-01) and standalone Undici
`8.10.2`, git tree `5e541e0b9df7563e5766bbd469fbfe383d9ae6ca`, npm integrity
`sha512-/y4/bH9YNU5hi9NIrpOuvGXFcxrj3CMrV+/AYpowAYTpHn8gX/XPFjNy766FPoYY0miQhdW977JFWKGNhBdwyQ==`.
The repository's bundled Node reference remains Undici `7.29.0`; it is a second
compatibility point and not the standalone ceiling.

`parseCookie`, `serializeCookie`, `getSetCookies`, `setCookie`, and `deleteCookie`
follow the pinned standalone helper behavior where it is compatible with the newer
RFC. A seeded 20,000-case ASCII Set-Cookie parser differential against the exact
standalone package found zero differences. A seeded 5,000-case valid serializer
differential likewise found zero differences. Three deliberate differences are
recorded rather than hidden: the shared serializer emits epoch zero when explicitly
requested, enforces `__Host-` and `__Secure-` case-insensitively as the current RFC
requires, and reports invalid producer input with `TypeError`. The shared static API
returns typed ordered `CookiePair` values from `getCookiePairs`; Undici's dynamic
record-returning `getCookies` belongs to the separate Node compatibility facade and
must preserve this shared implementation rather than introduce a second parser.

`CookieJar` implements domain and path matching, host-only state, Secure and
HttpOnly restrictions, SameSite receipt and retrieval, the prefix rules, the
400-day lifetime ceiling, Max-Age precedence, expiry, creation-order-preserving
replacement, secure-cookie overlay protection, request-header ordering, current-PSL
rechecking, deterministic RFC-priority eviction, session retirement, and atomic
persistent-snapshot replacement. Operations serialize through escaping
`Promise.withResolvers` waiters so concurrent Fetch responses cannot lose updates;
a failed persistent save does not commit partial in-memory state or strand the next
waiter. Store snapshots are cloned, validated and de-duplicated before becoming live.
Eviction is bounded by sorting one candidate set rather than repeatedly rescanning the
whole jar.

Automatic Fetch use is opt-in through `FetchCookiePolicy`. Every redirect response is
stored before following it, the outbound Cookie field is recomputed for every hop,
`omit` and `same-origin` credentials are enforced, cross-origin redirects cannot leak
same-origin jar state, and an explicit caller Cookie field is never overwritten.
`ServerCookiePolicy` deliberately supplies same-site context because the
server/mobile profile has no browser document principal. Applications that have a
different site policy inject it explicitly; no ambient browser cookie store is
invented.

The shared layer exposes provider seams rather than embedding platform policy: a
pinned Public Suffix List checker and an atomically replacing durable store remain
Node/mobile provider obligations. The runtime does not own or close an injected jar.
The in-memory store is complete for session use and deterministic tests, but is not
misrepresented as durable production storage.

At `63d09fc4`, all 11 focused cookie tests and all 176 local Node-host/real-socket
tests pass. The full unchanged upstream slice remains 2143/2151 applicable cases,
with eight named not-applicable cases and exactly the same eight visible failures:
three Headers iterator-shape cases, two Promise-observation cases, two typed
explicit-receiver cases, and the Web-IDL async-iterator prototype/object-shape case.
The cookie tranche introduces no WPT failure or exclusion. The live compiled-source
frontier is 754 primary `NTS1001` refusals and 105 dependent `NTS1003` cascades, with
zero `NTS1004` module diagnostics, zero JVM-backend diagnostics, and no invalid HIR.
This is the final-source dependency frontier, not evidence that cookies execute on a
compiled provider yet.

## HTTP cache policy core

At `fedfa74e`, Fetch can be given an environment-owned `HttpCache` whose policy is
implemented once in shared TypeScript rather than delegated to a platform HTTP
client. The normative inputs are RFC 9111, the Fetch Standard's HTTP-network-or-cache
algorithm, RFC 9110 date/list grammar, and RFC 5861. Standalone Undici `8.10.2` is a
compatibility and provider-shape reference, not the policy authority. That version is
newer than the `8.9.0` fix for `GHSA-jr45-8vmc-qm54`; the focused corpus separately
proves that optional whitespace around the `=` in qualified `private` and `no-cache`
directives cannot discard the protected field list.

The shared core implements strict `Cache-Control`, `Age`, and all three HTTP-date
wire forms; corrected age and freshness; private/shared storage rules; Authorization
constraints; `Vary` selection; Fetch cache modes; fresh and stale reuse; ETag and
Last-Modified validation with 304 metadata merge; unsafe-method target invalidation;
qualified-field stripping; `stale-if-error`; per-variant coalesced
`stale-while-revalidate`; and corrected `Age` emission. Request `no-store` bypasses
both lookup and storage, and legacy `Pragma: no-cache` is recognized as an exact
comma-list member rather than by substring.

The storage interface is streaming and transactional: a response becomes visible
only after end of body and successful commit. Cancellation, source failure, entry
limits, and store failure abort the partial transaction without failing or replacing
the network response. The in-memory implementation copies chunks, is replayable,
and enforces entry-count, total-byte, and per-entry-byte bounds with deterministic
least-recently-used eviction. Persistent crash-safe storage remains a provider
obligation over this same byte/metadata contract; it is not claimed by this
checkpoint. The separate public `Cache`/`CacheStorage` API, same-origin
`Location`/`Content-Location` invalidation, and request collapsing also remain
future work and are not hidden behind the RFC 9111 label.

All 23 focused cache tests and all 199 local Node-host/real-socket tests pass. The
complete pinned upstream slice remains 2143/2151 applicable cases with eight named
not-applicable cases and the same eight visible structural/common-compiler failures;
the cache tranche introduces no WPT failure or exclusion. The live NTS check reports
782 primary `NTS1001` refusals, 116 dependent `NTS1003` cascades, zero `NTS1004`
module diagnostics, zero JVM-backend diagnostics, and no invalid HIR. This increase
is the final cache source reaching existing compiler dependencies, not compiled-cache
execution evidence.

## Public `Cache` and `CacheStorage`

The Service Worker `Cache` and `CacheStorage` surface is now implemented separately
from the RFC 9111 HTTP cache. Named caches preserve insertion order and stable opaque
handles: deleting a name removes it from `CacheStorage`, while an already-open
`Cache` continues to address its old request/response list and reopening the name
creates a new list. Query matching implements method, search and exact `Vary`
semantics; fragments do not participate. Returned requests, responses, headers and
bodies are independent immutable snapshots, including internal Fetch metadata that
is not exposed as a new public property.

`put()` consumes and validates the response before an atomic compare-and-exchange
commit. `addAll()` validates every request before network dispatch, aborts the other
fetches after a failure, materializes every successful response, rejects duplicate
operations symmetrically across their `Vary` responses, and either commits the whole
batch or leaves the prior list intact. Cache algorithms call their internal steps
directly rather than redispatching through overridable public methods. The memory
provider enforces cache-count, entry-count and body-byte quotas and is explicitly a
volatile reference provider. Production Node and mobile providers must inject a
durable, quota-managed `CacheStorageStore`; one injected store is one storage-key
and isolation namespace. The store contract exposes stable handles plus revisioned
read/compare-exchange operations so persistence does not replace shared semantics.

Eight complete CacheStorage WPT fixtures and five support resources are pinned
unchanged by exact Git blob hash at WPT commit
`b89af32bc8f42d678f444eb0703bca015ddcf240`. They register 128 cases: all 122
applicable cases pass, and six are named not applicable because they require browser
filtered opaque/CORS responses or `FileReader`. Those exclusions do not remove any
Cache algorithm: the affected byte consumption is covered by the local suite and the
pinned Blob/Streams fixtures. The focused suite passes 15/15 and the complete local
Node-host/real-socket suite passes 214/214.

The unchanged full upstream slice now passes 2265/2273 applicable cases, with 14
named not-applicable cases and exactly the same eight visible failures: three Headers
iterator-shape cases, two Promise-observation cases, two typed explicit-receiver
cases, and the Web-IDL async-iterator prototype/object-shape case. The upstream
`Cache.put()` fixture found two independent pre-existing Web-surface defects during
this tranche: body consumption incorrectly released the reader lock after reaching
EOF, and `Headers`, `Request`, and `Response` lacked their Web IDL class strings.
Both are fixed in the canonical implementations rather than patched in the harness.

The Cache query sabotage inverted `ignoreSearch`; after rebuilding the host tree the
focused suite fell from 15/15 to 14/15 at the matching assertion, then returned to
15/15 after restoration. The runner also verifies every imported fixture and support
resource against its recorded Git blob hash before executing it.

The live compiled-source frontier is 805 primary `NTS1001` refusals and 128 dependent
`NTS1003` cascades, with zero `NTS1004` module diagnostics, zero JVM-backend
diagnostics, and no invalid HIR. One visible Cache-specific primary says that
`owner`, reached after narrowing a `CacheStorageHandle`, is not declared by the
interface; this is kept in final source for the compiler lane rather than hidden by
a cast or alternate architecture. These counts measure newly reachable final source,
not compiled-provider completion.

RFC 9111 Section 4.4 invalidation is now complete for the shared cache policy. A
successful unsafe request invalidates its target plus unambiguous `Location` and
`Content-Location` references resolved by the environment's canonical URL parser,
but only when the resolved origin equals the request target's origin. Malformed or
duplicate reference fields are ignored without weakening target invalidation, and a
storage failure is reported diagnostically without replacing the successful network
response. The focused HTTP-cache suite passes 25/25 and the complete local suite
passes 216/216. Removing the origin check makes the focused suite fail 24/25 by
deleting an attacker-selected cross-origin entry; restoring it returns 25/25. The
live source frontier is 806 primary `NTS1001` refusals and 128 dependent `NTS1003`
cascades, with zero module or JVM-backend diagnostics and no invalid HIR.

## Content-coding policy and host reference codecs

Shared Fetch now owns the complete content-coding policy around provider codec
primitives. The request advertises exactly the lower-case HTTP tokens declared by
the installed decoder, preserves an explicit caller `Accept-Encoding`, and falls
back to `identity` when the provider declares no decoder. Response codings are
decoded in reverse application order while one outer budget counts original wire
bytes and final decoded bytes across the whole stack. The default server/mobile
safety policy caps one decoded response at 256 MiB and caps expansion at 100:1 after
a 1 MiB grace allowance; both limits are explicit provider configuration and may be
raised or set to `Infinity`. They are resource policy, not limits attributed to the
Fetch Standard.

The budget is pull-driven and cancels the decoder stack with the same `LimitError`
as soon as either bound is crossed. It does not trust `Content-Length`, intermediate
decoder sizes, or a provider's estimate. A direct transport test proves the cancel
reason reaches the decoder input. Removing the ratio predicate makes the ordinary
compressed-bomb test fail with a missing rejection and makes the open-input
cancellation test time out, so neither a stale build nor an unobserved guard can
report the sabotage as green.

The ordinary-Node reference provider streams through native zlib/Brotli primitives.
Gzip trailer/CRC and zlib Adler corruption are rejected, truncated Brotli is
rejected, and HTTP `deflate` accepts both its zlib-wrapped form and the deployed raw
DEFLATE fallback. The raw-form probe remains incremental when its first two wire
bytes arrive separately. Codec availability is data on the provider interface,
preventing Fetch from advertising an implementation merely because another target
has it; format/checksum/trailer validation remains an obligation of every provider
that declares a token.

The ten focused coding cases pass 10/10, all local Node-host and real-socket tests
pass 222/222, and the repository TypeScript solution builds. The unchanged full
upstream slice remains 2265/2273 applicable cases with 14 named not-applicable cases
and the same eight visible structural/common-compiler failures; this tranche adds no
WPT failure or exclusion. The live NTS frontier is 812 primary `NTS1001` refusals
and 128 dependent `NTS1003` cascades, with zero `NTS1004` module diagnostics, zero
JVM-backend diagnostics, and no invalid HIR. The six additional primaries are the
final policy/stream source reaching existing lowering gaps, not compiled-provider
evidence.

## `WebSocketStream` and environment-owned WebSocket construction

At `21b5fd2b`, the shared runtime exposes the canonical public `WebSocket`
constructor and Chromium's experimental `WebSocketStream`/`WebSocketError` surface
through the environment-owned `WebPlatformRuntime`. Both APIs share URL,
subprotocol and close conversion and use the same `WebSocketSession`; the stream API
does not translate through DOM events. Its readable side has a one-chunk high-water
mark and permits only one transport read at a time, while writable promises settle
only after provider acceptance. Writer close waits for the peer close frame,
handshake abort is detached after opening, abnormal-close identity is shared by the
readable, writable and `closed` promise, and runtime close retires every registered
socket and stream. Forbidden ports are rejected through the asynchronous connection
path rather than being turned into a constructor exception.

The unchanged WPT `websockets/stream/tentative/websocket-error.any.js` fixture is
pinned at Git blob `b114bbb3e3495d2ae4ce0c75454539d4b2fddea7` from the repository's
existing WPT revision and passes 10/10. The complete local Node-host and real-socket
suite passes 229/229, including exact pull backpressure, byte snapshotting, pending
write failure, close/cancel/abort paths, environment shutdown, forbidden-port timing,
and real text/binary exchange. The repository TypeScript solution builds. The full
upstream slice passes 2275/2283 applicable cases with 14 named not-applicable cases
and the same eight visible structural/common-compiler failures as the preceding
checkpoint; this tranche adds no WPT failure or exclusion.

A sabotage changed the readable high-water mark from one to two. Its focused
precondition failed 0/1 because the transport performed a second `next()` while the
first unread message still occupied the queue; restoring the specified value returned
the test to 1/1. The live compiled-source frontier is 1007 primary `NTS1001` refusals
and 144 dependent `NTS1003` cascades, with zero `NTS1004` module diagnostics, zero
JVM-backend diagnostics, and no invalid HIR. These counts expose the complete
final-form stream state machine to existing compiler dependencies; they are not
compiled-provider execution evidence.

## RFC 7692 `permessage-deflate`

At `5063fea5`, the portable raw WebSocket transport implements the RFC 7692
extension above provider-owned raw-DEFLATE contexts. The shared layer owns the
opening offer, strict response parsing, duplicate/unknown/unsolicited parameter
rejection, RSV1 placement, compress-before-fragment and gather-before-inflate
ordering, the four-byte synchronous-flush tail transformation, context takeover,
negotiated no-context resets, server window limits, text validation after inflation,
and wire/decompressed message limits. The fixed unconstrained client offer does not
offer `client_max_window_bits`, so a response containing it is correctly rejected;
the remaining legal response parameters for that offer are supported. A server may
also decline compression without changing the connection.

The ordinary-Node conformance provider supplies stateful zlib raw-DEFLATE contexts,
not WebSocket policy. It caps retained output incrementally, while the shared layer
independently checks the returned size. Compression contexts close with their
session. The integration corpus proves context reuse across two messages,
no-context reset in both directions, compressed fragmentation with interleaved ping/
pong, empty messages, a negotiated ten-bit server window, inflation-bomb closure
with code 1009, malformed DEFLATE closure with 1002, invalid post-inflate UTF-8 with
1007, and an uncompressed fallback. It also corrects the pre-existing handshake rule
so a server may decline every offered subprotocol and still open with an empty
`protocol`.

All five focused negotiation/compression tests pass, the complete local Node-host and
real-socket suite passes 235/235, the repository TypeScript solution builds, and the
full pinned WPT slice remains 2275/2283 applicable cases with 14 named
not-applicable cases and the same eight visible structural/common-compiler failures.
Removing the outgoing no-context reset makes its focused precondition fail 0/1 at
the independent peer decoder with `invalid distance too far back`; restoring it
returns 1/1. Disabling both the provider's incremental expansion cap and the shared
postcondition makes the bomb case time out 0/1 instead of producing its 1009 close;
restoring both returns 1/1.

The live compiled-source frontier is 1015 primary `NTS1001` refusals and 147
dependent `NTS1003` cascades, with zero module diagnostics, zero JVM-backend
diagnostics, and no invalid HIR. Relative to the WebSocketStream checkpoint,
the eight-primary and three-cascade increase is final RFC 7692/provider-contract
source reaching existing lowering dependencies, not compiled execution evidence.

## RFC 7541 HPACK

The shared HTTP/2 layer now contains one stateful HPACK encoder and decoder rather
than relying on a provider's header codec. It implements RFC 7541's complete static
table, dynamic indexing and eviction, all integer and string representations, the
257-symbol Huffman alphabet and EOS padding rules, the required ordering and count
of table-size updates, and the distinction between incremental, without-indexing,
and never-indexed literals. `authorization`, `proxy-authorization`, `cookie`, and
`set-cookie` default to never-indexed representation unless the caller deliberately
selects another policy. Header names and values are preserved as HTTP ByteStrings;
the codec does not silently reinterpret arbitrary octets as UTF-8.

The decoder rejects zero or out-of-range indexes, truncated and oversized integers,
EOS inside a string, invalid or excessive padding, late or excessive table-size
updates, omitted required minimum updates, advertised-capacity overflow, oversized
encoded strings, oversized decoded strings, and oversized header lists. Encoded
string and decoded header-list budgets are independent. The encoder uses Huffman
coding only when it shortens a field and emits the smallest and final pending table
size when multiple peer-setting changes precede the next block.

All six RFC request and response sequences pass in their plain and Huffman forms.
The complete `http2jp/hpack-test-case` decoding corpus, pinned to commit
`8a1406e7d14bfcb6c046021f13cc15cfb162726d`, passes 47,142/47,142 cases from 14
independent encoders. A separate deterministic randomized run encoded 2,000
stateful header blocks here and decoded all 2,000 with Python `hpack`; it found no
interoperability mismatch. This is measured here against the final codec, not a
prediction from instruction shape.

The focused HPACK suite passes 13/13 and the complete local Node-host/real-socket
suite passes 248/248. The unchanged pinned WPT slice remains 2275/2283 applicable
cases, with 14 named not-applicable cases and the same eight visible
structural/common-compiler failures. No HPACK case is excluded from that count; the
47,142-case interoperability corpus is an explicit offline runner because its
external checkout is intentionally not downloaded by the ordinary gate.

A sabotage replaced the mandated all-one Huffman tail padding with zero bits. The
focused precondition fell from 1/1 to 0/1 while decoding the all-256-octet round trip,
then returned to 1/1 after restoration. The live compiled-source frontier is 1019
primary `NTS1001` refusals and 149 dependent `NTS1003` cascades, with zero `NTS1004`
module diagnostics, zero JVM-backend diagnostics, and no invalid HIR. The four new
primaries and two cascades are the final HPACK table/codec source reaching existing
lowering dependencies, not compiled-provider or HTTP/2-session evidence.

## RFC 9113 frame and header-block codec

At `082d6be6`, the shared HTTP/2 layer parses and serializes the nine-byte frame
envelope under both the negotiated and absolute frame-size limits. Every standard
frame kind has its stream-zero/nonzero, fixed-length, padding, priority-dependency,
setting-value, window-progress, and reserved-bit rules checked before a connection
state machine consumes it. Unknown frame kinds remain extensible and are preserved
rather than rejected. Unsigned setting and error-code values survive the TypeScript
number representation without signed bitwise truncation.

The header-block assembler enforces the connection-wide CONTINUATION invariant: once
a HEADERS or PUSH_PROMISE block is open, no other frame type or stream may intervene
before END_HEADERS. Compressed bytes have an independent limit before HPACK decoding,
and padding bytes never enter the header block. Stream-scoped wire failures retain
their stream identifier while connection failures do not, so the next layer can
choose RST_STREAM or GOAWAY without guessing from an error message.

All eight focused frame tests and all 256 local Node-host/real-socket tests pass. The
full pinned WPT slice remains 2275/2283 applicable cases with 14 named
not-applicable cases and the same eight visible structural/common-compiler failures.
A sabotage weakened the continuation guard from “wrong type **or** wrong stream” to
“wrong type **and** wrong stream”; the wrong-stream CONTINUATION precondition fell
from 1/1 to 0/1, then returned to 1/1 after restoration.

The live compiled-source frontier is 1020 primary `NTS1001` refusals and 150
dependent `NTS1003` cascades, with zero module diagnostics, zero JVM-backend
diagnostics, and no invalid HIR. The one-primary and one-cascade increase is final
frame/reader source reaching existing lowering dependencies; it is not evidence that
an HTTP/2 connection, multiplexed stream, or provider transport executes yet.

## RFC 9113 HTTP/2 client connection

At `207db600`, the shared HTTP/2 layer has a multiplexed client connection state
machine over the provider-neutral `ByteConnection`. Startup emits the client preface
and bounded local settings, refuses any peer whose first frame is not initial
SETTINGS, acknowledges settings, applies later changes to active streams, and keeps
write serialization independent from request concurrency. Request streams use odd
identifiers, respect the peer's concurrent-stream limit, fragment header blocks at
the negotiated frame size, and reserve connection and stream flow-control credit
synchronously before any writer can yield.

Responses preserve informational blocks, duplicate regular fields and trailers.
Inbound flow-control credit returns only when the application consumes or discards
body bytes, so a stalled body cannot turn into unbounded hidden buffering. Abort
keeps exact reason identity and sends `CANCEL`; content-length/body rules, forbidden
response bodies, stream and connection window failures, reset semantics, PING,
GOAWAY retry boundaries, draining, and extended-CONNECT negotiation have explicit
state transitions. A malformed stream is reset without killing unrelated streams,
while connection-scoped framing and compression failures send the corresponding
GOAWAY.

Header validation is separate from HPACK and implements the HTTP/2 pseudo-header,
ordering, required-field, lowercase-name, field-value, connection-field, TE,
content-length, trailer, CONNECT and extended-CONNECT rules. Compressed header blocks
also carry a fragment-count limit, so unlimited zero-length CONTINUATION frames cannot
bypass the byte budget. A stream-scoped priority error on fragmented HEADERS is held
until the complete block has been consumed and decoded; this preserves the
connection-wide HPACK state before the stream is reset.

The focused frame, header and connection suites pass 27/27. Six connection cases use
a real Node HTTP/2 server and cleartext socket to exercise multiplexing, tiny inbound
and outbound windows, peer concurrency, exact cancellation and PING. Six deterministic
peer cases cover GOAWAY retry boundaries, initial-frame protocol failure, stream-local
flow failure, compression failure, aborted concurrency waiters, and a malformed
fragmented header block followed by a valid stream that depends on the dynamic-table
state established by the malformed block. The complete local Node-host/real-socket
suite passes 275/275.

The pinned WPT slice remains 2275/2283 applicable cases with 14 named not-applicable
cases and the same eight visible structural/common-compiler failures. A sabotage
removed the assembler's deferred handling for the fragmented stream error. The
HPACK-continuity precondition fell from 1/1 to 0/1 with `Unexpected HTTP/2
CONTINUATION frame`, then returned to 1/1 after restoration.

The live compiled-source frontier is 1081 primary `NTS1001` refusals and 151
dependent `NTS1003` cascades, with zero module diagnostics, zero JVM-backend
diagnostics, and no invalid HIR. The increase from the frame checkpoint is the final
shared session and validation source reaching already-visible language prerequisites;
it is not evidence that the provider transport, ALPN selection or connection pool is
complete.

## HTTP/2 prior-knowledge Fetch transport

At `43643ce1`, the shared HTTP/2 connection is integrated as a provider-neutral
`FetchTransport`. Requests are grouped by origin and multiplexed over one active
connection, concurrent opens for the same origin are coalesced, the total connection
count is bounded, and idle connections are the only connections eligible for
capacity eviction. The transport maps Fetch request fields to HTTP/2 pseudo-headers,
preserves duplicate response fields such as `set-cookie`, validates declared body
length before opening a socket, and enforces the produced request-body length while
streaming.

Response headers and every response-body pull have separate deadlines. Header
timeout and body-idle timeout both preserve the exact `TimeoutError` class and cancel
the affected stream rather than the connection. A response body that Fetch semantics
hide is still consumed so its flow-control credit and stream lifetime are returned.
A bodyless request refused by GOAWAY or `REFUSED_STREAM` is retried once on a new
connection; a streaming request is never guessed to be replayable. Graceful drain
rejects new work, waits for active streams, and reaches an empty pool. Abrupt close
also interrupts a drain and outstanding connection attempts rather than leaving a
promise waiting on a connection that cannot complete.

This class is deliberately a prior-knowledge transport, not the final protocol
dispatcher. Its connector must already yield an HTTP/2 byte connection, selected by
TLS ALPN or explicit h2c configuration. It does not infer HTTP/2 from a URL, silently
send the cleartext preface to an HTTP/1.1 peer, or pretend that origin grouping is
certificate- and DNS-aware connection coalescing. Those require the negotiated
provider boundary and dispatcher named in the integration plan.

The focused connection, header and transport suites pass 27/27, including real h2c
multiplexing, shared Fetch redirect and gzip decoding over HTTP/2, GOAWAY replay,
independent header and body-idle timeouts, request-length validation, and graceful
drain. The complete local Node-host/real-socket suite passes 283/283. The pinned WPT
slice remains 2275/2283 applicable cases with 14 named not-applicable cases and the
same eight visible structural/common-compiler failures.

A sabotage inverted the bodyless replay predicate. The GOAWAY retry precondition
fell from 1/1 to 0/1 with `Peer GOAWAY did not process this stream`, then returned to
1/1 after restoration. The live compiled-source frontier is 1096 primary `NTS1001`
refusals and 153 dependent `NTS1003` cascades, with zero `NTS1004` module diagnostics,
zero JVM-backend diagnostics, and no invalid HIR. The 15-primary and two-cascade
increase is the transport and its final request/session guards reaching existing
language prerequisites; it is not compiled-provider or ALPN evidence.

## Typed MockAgent transport

At `eb014d2f`, deterministic request mocking is implemented as a shared typed
`FetchTransport`, rather than by delegating matching or replay to host JavaScript.
`MockAgent`, `MockPool`, and `MockClient` own interceptors with path, method, query,
header, and bounded body matching. Interceptors provide sequential replies, stable
error identity, abortable delay, finite or persistent use, default headers and
trailers, and calculated content length. A direct pool dispatch searches only that
pool even when another pool has an overlapping origin matcher.

An unmatched request may be replayed to an explicit fallback transport. Request
bodies are captured once under a configurable byte limit and reconstructed before
fallback, so matching cannot silently consume the body the network path receives.
Network permission is explicit and independently supports allow-all, deny-all, and
host matchers. Call history is opt-in, immutable at its public boundary, and bounded
by an explicit drop-oldest limit with a visible dropped-entry count. Graceful close
rejects new work, is shared by concurrent callers, and waits for replies already in
flight.

The focused mock corpus passes 9/9 and the complete local Node-host/real-socket suite
passes 292/292. The pinned WPT slice is unchanged at 2275/2283 applicable cases with
14 named not-applicable cases and the same eight visible structural/common-compiler
failures. This is host evidence for the shared behavior; the exact dynamic Undici
package facade and compiled-provider execution remain separate obligations in the
API ledger.

A sabotage changed the body bound from strictly greater-than to greater-than-or-equal.
The exact-boundary precondition fell from 1/1 to 0/1 with `LimitError`, while the
over-limit case still failed as expected; restoring the predicate returned 1/1.
The live compiled-source frontier is 1133 primary `NTS1001` refusals and 166
dependent `NTS1003` cascades, with zero `NTS1004` module diagnostics, zero JVM-backend
diagnostics, and no invalid HIR. The increase from the HTTP/2 checkpoint is final
mocking source reaching existing language prerequisites; it is not compiled mock
execution evidence.

## Deterministic SnapshotAgent

At `71484249`, the shared transport implements bounded snapshot record, playback,
and update modes. Matching has a collision-free canonical key over method, normalized
URL/query, selected headers, and optionally normalized request bytes. Header
exclusion is applied before persistent storage and matching, so configured credential
fields do not leak into either the recorded request or response. URL exclusions pass
the original stream directly to the real transport without loading or mutating the
snapshot store.

The recorder preserves sequential responses and repeats the final one after the
sequence is exhausted. Request bodies, response bodies, response counts, snapshot
counts, and estimated total stored bytes have independent limits. Recording captures
the complete response before exposing its replayable body; exceeding the body limit
cancels the live reader rather than retaining a prefix as a valid snapshot. Old
snapshots are evicted deterministically when the configured count or total-byte
budget needs room, but an individual response sequence is never partially evicted to
hide its own overflow.

Persistence crosses one typed `SnapshotStore` boundary whose `replaceAll` operation
is atomic by contract. Saves are serialized, so a slow older write cannot overwrite a
newer collection; auto-flush uses the injected environment scheduler. Loaded and
replaced collections are copied and checked for duplicate or forged keys, invalid
statuses and call counts, and every configured resource bound before becoming
observable. `MemorySnapshotStore` is the bounded reference implementation; the exact
Node path/JSON/base64 facade and a production durable provider remain separate ledger
obligations.

The focused SnapshotAgent corpus passes 8/8, the combined mock corpus passes 17/17,
and the complete local Node-host/real-socket suite passes 300/300. The pinned WPT
slice remains 2275/2283 applicable cases with 14 named not-applicable cases and the
same eight visible structural/common-compiler failures.

A sabotage changed the response-body bound from strictly greater-than to
greater-than-or-equal. The exact-boundary precondition fell from 1/1 to 0/1 with
`LimitError`; restoring the predicate returned 1/1. The live compiled-source frontier
is 1164 primary `NTS1001` refusals and 188 dependent `NTS1003` cascades, with zero
`NTS1004` module diagnostics, zero JVM-backend diagnostics, and no invalid HIR. These
counts describe new shared source reaching existing language prerequisites, not
compiled SnapshotAgent execution.

## Typed interceptor composition and retry policy

At `0f758afb`, the shared transport has immutable typed interceptor composition and
a retry layer whose request ordering is explicit. The first interceptor is the
outermost request observer, while responses and errors unwind in reverse order.
`RetryInterceptor` and `RetryAgent` retry the configured idempotent methods for typed
transport failures and configured HTTP statuses, with bounded exponential delay,
`Retry-After` support, custom decisions, non-semantic observers, and exact abort
reason propagation.

Request-body replay is metadata rather than a guess. `BodyState` exposes a fresh
Blob-backed stream factory at the provider-neutral transport boundary; a one-shot
stream has no factory and cannot be retried after consumption. Every factory carries
and validates its byte length. Retried response bodies are canceled before the next
attempt, huge decimal `Retry-After` values clamp to the configured maximum, and
observer failures are reported without changing dispatch. Partial-response resume
with `Range`/ETag and the exact standalone-Undici package facades remain visible in
the API ledger rather than being claimed by this checkpoint.

The focused retry corpus passes 11/11 and the complete local Node-host/real-socket
suite passes 311/311. The pinned WPT slice remains 2275/2283 applicable cases with
14 named not-applicable cases and the same eight visible structural/common-compiler
failures.

A sabotage removed the Fetch-to-transport replay factory while leaving the retry
implementation intact. The ordinary `fetch()` body-replay precondition fell from
1/1 to 0/1 with `UnreplayableRequestError`, then returned to 1/1 after restoration.
The live compiled-source frontier is 1172 primary `NTS1001` refusals and 194 dependent
`NTS1003` cascades, with zero `NTS1004` module diagnostics, zero JVM-backend
diagnostics, and no invalid HIR. The increase is new policy source reaching existing
language prerequisites; it is not compiled retry or provider evidence.

## Bounded response policy interceptors

At `cabe019f`, the shared interceptor layer can consume and discard a response or
turn a status at or above 400 into a stable typed `ResponseError`. Text and JSON
media types are captured as UTF-8 text, other media types remain bytes, and the
error owns copied headers plus its status code and message. Canonical JSON object
decoding remains attached to the compiler/common-runtime JSON prerequisite rather
than delegating to a host parser.

Both policies use one response collector with an explicit positive byte bound.
It rejects an advertised over-limit `Content-Length` conservatively, including
unsafe-integer values, and enforces the same bound incrementally when length is
unknown or false. Cancellation is awaited before the policy rejects, exact-boundary
bodies are accepted, trailer settlement remains visible, abort reasons retain exact
identity, and a body-read or trailer failure is never relabeled as a status or size
failure.

The focused policy corpus passes 9/9 and the complete local Node-host/real-socket
suite passes 320/320. The pinned WPT slice remains 2275/2283 applicable cases with
14 named not-applicable cases and the same eight visible structural/common-compiler
failures.

A sabotage changed the incremental size check from strictly greater-than to
greater-than-or-equal. The exact-boundary dump precondition fell from 1/1 to 0/1
with `ResponseExceededMaxSizeError`, then returned to 1/1 after restoration. The
live compiled-source frontier is 1180 primary `NTS1001` refusals and 195 dependent
`NTS1003` cascades, with zero `NTS1004` module diagnostics, zero JVM-backend
diagnostics, and no invalid HIR. The increase is new policy source reaching existing
language prerequisites; it is not compiled interceptor evidence.

## Bounded in-flight request deduplication

At `98097617`, the shared interceptor layer deduplicates eligible bodyless safe
requests while preserving an independent response body, trailers promise, and abort
outcome for every subscriber. The default eligibility is `GET`; configurable method,
skip-header, and excluded-header policies remain conservative, and the collision-free
key length-prefixes the method, URL, and exact retained header sequence.

Deduplication is deliberately bounded in four dimensions: pending requests,
subscribers per request, buffered bytes per subscriber, and aggregate buffered bytes.
An exhausted pending or subscriber slot falls back to an independent dispatch rather
than changing the request's answer. A slow subscriber alone receives a typed buffer
error and releases its reserved budget. Exact accounting survives copied chunks,
copy failures, cancellation, and terminal delivery; no hidden per-subscriber queue can
grow without limit.

Subscribers may join only before the first response-data event. They receive copied
byte chunks and copied trailers, so one consumer cannot mutate another's result. One
subscriber aborting or canceling does not disturb the rest; the last subscriber's
departure aborts and cancels the upstream request, with cleanup awaited. An upstream
failure retains the same error identity for every subscriber, and asynchronous setup
failures cannot escape as unhandled rejections.

The focused deduplication corpus passes 11/11 and the complete local
Node-host/real-socket suite passes 331/331. The pinned WPT slice remains 2275/2283
applicable cases with 14 named not-applicable cases and the same eight visible
structural/common-compiler failures.

A sabotage changed aggregate-budget admission from strictly greater-than to
greater-than-or-equal. The exact-boundary global-budget precondition fell from 1/1 to
0/1 with `DeduplicationBufferError`, then returned to 1/1 after restoration. The live
compiled-source frontier is 1207 primary `NTS1001` refusals and 202 dependent
`NTS1003` cascades, with zero `NTS1004` module diagnostics, zero JVM-backend
diagnostics, and no invalid HIR. The increase is new shared policy source reaching
existing language prerequisites; it is not compiled deduplication evidence.

## Typed transport diagnostics

At `d3d74e8b`, the shared transport has an opt-in typed diagnostic observer owned by
each `WebPlatformRuntime`. It emits request creation, response headers, response
trailers, and exact dispatch/trailer errors through stable request-context objects.
Display sequences are local to the interceptor instance; object identity, not a
process-global number, identifies a request.

Diagnostics copy their request, response, and trailer headers before publication.
Authorization, proxy authorization, cookies, and set-cookie fields are redacted by
default, with additional configured names supported. HTTP query values are omitted by
default, URL user information is never included, and non-network URL payloads such as
`data:` bodies are never exposed. Observer mutation therefore cannot change the
transport request or response.

The observer deliberately does not acquire a body reader or substitute a proxy
stream. The returned response, body stream, and trailers promise retain exact
identity and the body remains unlocked. Provider connection and body-sent events can
feed the same typed observer at their actual delivery points; manufacturing them in
an interceptor would change ownership or scheduling. Observer failures are reported
through the owning scheduler, while even a broken observer and broken reporter cannot
change transport settlement or error identity.

The focused diagnostic corpus passes 11/11 and the complete local
Node-host/real-socket suite passes 342/342. The pinned WPT slice remains 2275/2283
applicable cases with 14 named not-applicable cases and the same eight visible
structural/common-compiler failures.

A sabotage joined the built-in and configured redaction predicates with `&&` instead
of `||`. The privacy precondition fell from 1/1 to 0/1 while displaying the raw
authorization, cookie, and API-key values, then returned to 1/1 after restoration.
The live compiled-source frontier is 1207 primary `NTS1001` refusals and 204 dependent
`NTS1003` cascades, with zero `NTS1004` module diagnostics, zero JVM-backend
diagnostics, and no invalid HIR. These counts describe shared diagnostics reaching
existing language prerequisites, not compiled observer evidence.

## Bounded multi-origin Agent and Client lifecycle

At `7e546f21`, the shared dispatcher layer has an environment-local `Agent` that
lazily creates one provider dispatcher per canonical HTTP(S) origin and a `Client`
that enforces one canonical origin. The provider factory remains the protocol and
connection owner; no shared module or process global stores a default dispatcher.

The Agent's origin map is a least-recently-used order with an explicit retained-origin
bound. Only a provider dispatcher that reports itself fully idle may be evicted, and
its close must settle before the replacement is constructed. A failed close restores
the old entry, while a bound occupied by live work produces a typed
`UND_ERR_MAX_ORIGINS_REACHED` error. Origin creation is serialized to prevent racing
duplicate dispatchers and has its own explicit queue bound and typed overflow instead
of an unbounded promise chain. Abort during serialized eviction prevents replacement
creation.

Graceful close and exact-reason destroy are idempotent, reject new work immediately,
and cover every owned dispatcher. Aggregate typed statistics include retained and
idle origins, connection/pending/running totals, dispatches, evictions, the bounded
creation backlog, and per-origin snapshots. Provider `idle` is a lifecycle contract:
it may become true only when eviction cannot interrupt a request or live body.

The focused Agent/Client corpus passes 12/12 and the complete local
Node-host/real-socket suite passes 354/354. The pinned WPT slice remains 2275/2283
applicable cases with 14 named not-applicable cases and the same eight visible
structural/common-compiler failures.

A sabotage inverted the idle-dispatcher guard. The live-work preservation
precondition fell from 1/1 to 0/1 because the busy origin was evicted and the request
incorrectly succeeded, then returned to 1/1 after restoration. The live
compiled-source frontier is 1219 primary `NTS1001` refusals and 205 dependent
`NTS1003` cascades, with zero `NTS1004` module diagnostics, zero JVM-backend
diagnostics, and no invalid HIR. The increase is new shared dispatcher source reaching
existing language prerequisites; it is not compiled Agent evidence.

## Bounded same-origin and balanced dispatcher pools

At `20696298`, the shared dispatcher layer has a fixed-member `RoundRobinPool`
and `Pool` for one canonical HTTP(S) origin, plus a mutable multi-upstream
`BalancedPool`. A same-origin pool rejects a request for another origin before
selecting a provider dispatcher. Balanced routing constructs a new URL record with
only the origin replaced; the caller's request and its body, signal, headers, and
replay metadata keep their identity.

Balanced selection uses deterministic smooth weighted round robin. Configured
weights, health penalties, and retained upstream count are explicitly bounded.
Only typed transport failures reduce health; policy and user-code errors do not.
Successful dispatch restores one health step, while providers can report a typed
failure or success discovered later in the response-body or connection lifecycle
through the same rule. Credential-bearing and non-HTTP(S) upstream URLs are refused.

Removal first stops new selection, then waits for graceful provider close. A failed
close restores the upstream while the pool is accepting, so the dispatcher cannot
become an unowned live resource. Close and exact-reason destroy cover every remaining
owned dispatcher, including one already removed from selection while its close is
pending. Aggregate and per-upstream snapshots expose configured and health weights,
connections, pending/running work, idle state, dispatches, and typed failures.

The focused pool corpus passes 10/10 and the complete local Node-host/real-socket
suite passes 364/364. The pinned WPT slice remains 2275/2283 applicable cases with
14 named not-applicable cases and the same eight visible structural/common-compiler
failures.

A sabotage inverted the typed-transport-error health guard. The focused corpus fell
from 10/10 to 9/10 because the selected upstream incorrectly retained full health,
then returned to 10/10 after restoration. The live compiled-source frontier is 1233
primary `NTS1001` refusals and 205 dependent `NTS1003` cascades, with zero `NTS1004`
module diagnostics, zero JVM-backend diagnostics, and no invalid HIR. The increase
is new shared dispatcher source reaching existing language prerequisites; it is not
compiled pool evidence.

## Proxy routing and the environment-owned runtime

These commits followed the dispatcher-pool entry above and were recorded in
`docs/web-platform-node-lane-handoff.md` rather than here. They are summarized now so
the ledger is continuous again; each was verified in its own commit, and this entry
does not re-measure them.

- `8948eca6` added portable HTTP CONNECT and SOCKS5 tunnel connectors.
- `52b629fa` added environment proxy policy with modern Undici-style `NO_PROXY`
  matching.
- `93364490` added proxy dispatch agents, including absolute-form HTTP and tunneled
  TLS.
- `185145f9` and `1db768c0` routed protocol connections and sockets through the
  environment policy.
- `44eea06a` made `WebPlatformRuntime` the owner of the proxy routing used by Fetch,
  EventSource and WebSocket.
- `dcfb2a78` separated graceful pool drain from forceful destroy.
- `03c03d93` removed the repeated ambient declarations and made the environment slot
  the single shared access seam. `runtime/web-platform/src/provider/environment.ts`
  owns the typed ambient natives `nts_environment_install_platform` and
  `nts_environment_platform`; the ordinary-Node conformance host supplies a
  deliberately host-only single-runtime shim, and shared TypeScript contains no
  process-global fallback.

The security invariants established across those commits — TLS identity verified
against the logical target rather than the proxy, typed proxy authentication, dynamic
bypass policy, and provider shutdown — are preserved by the entry below.

## Environment-owned capability confinement in public constructors

The transitional constructor capability injection recorded as an open decision in the
Node-lane handoff is closed. `Request`, `Response`, `WebSocket`, `WebSocketStream` and
`EventSource` previously accepted a provider context as a surplus third JavaScript
argument. Script holding any `WebPlatformRuntime` could therefore bind a canonical Web
value to that runtime and substitute the URL parser, body policy, randomness,
transports and proxy policy the value used, even though the environment slot was
already the intended single source of that capability.

Each class now has a module-private `unique symbol` construction key, the same
convention already used by `abortSignalConstructorKey`. A public constructor ignores
surplus arguments: a third argument that is not the key leaves the value bound to the
environment's runtime. Internal construction travels through factories instead of a
public parameter — `createInternalRequest` for Fetch and Cache, module-private
`createInternalResponse` for `clone()`, `fromTransport()` and `fromCache()`, and
`createInternalWebSocket`/`createInternalWebSocketStream` for the runtime's own
factories. `EventSource` had no internal caller with an explicit context, so its third
parameter is removed outright rather than gated. Constructor identity, public arity and
the Web IDL conversion order are unchanged; no process-global, cast or prototype
workaround was introduced.

Two focused tests cover both directions. The first proves the public constructors
ignore a surplus capability: a second live runtime is passed at the old injection
position and the environment's base URL, body policy and WebSocket transport are still
the ones used. The second proves internal factories still deliver an explicit
capability: `Cache` reaches the internal Request and Response factories, so the
non-ambient runtime's base URL resolves the stored request and that runtime's
four-byte consumption limit governs the response it produced, while the runtime's own
`createWebSocket`/`createWebSocketStream` bind to that runtime's transport. A live
second runtime is used deliberately as the forged capability, because it is the most
plausible thing a caller could obtain and it fails loudly rather than inertly.

Three sabotages were run, each with a fresh host emit and a verified precondition.
Restoring the context to public position three on `Request` made the focused suite fall
from 2/2 to 1/2, resolving `https://other.test/relative` instead of
`https://environment.test/base/relative`. The same restoration on `WebSocket` made the
environment transport carry one socket instead of two. Making the internal Response
factory drop its context produced `Missing expected rejection`, because the cached
response then consumed past the owning runtime's four-byte limit. The third sabotage
also caught a real defect during development: `createInternalResponse` was initially
dead code, because `clone()` and the two static factories still called the constructor
directly. Every internal construction was rerouted through the factory before the
sabotage was rerun, and all three were restored to green.

The complete local Node-host/real-socket corpus passes 404/404 with zero skipped, up
from the 402/402 checkpoint by exactly these two tests, and the new file is registered
in `tooling/conformance/web-platform/check.sh`. The pinned upstream corpus is unchanged
at 2,300 total, 2,286 applicable, 2,278 passing, 8 failing and 14 named
not-applicable, with the same eight visible structural/common-compiler failures and the
same expected nonzero exit. The root TypeScript solution build is green. This is host
evidence for the shared algorithm; it is not compiled-provider evidence.

The NTS frontier was measured with the release binary present in this tree at
2026-09-07 12:43, against repository HEAD `7a376cde`. That binary reproduces the
handoff's recorded 1,264/228 figures exactly for unmodified source, which is why it is
named rather than replaced: two JVM codegen files postdate it and the compiler lane's
`compiler/core/src/hir` files are dirty in the shared worktree, so rebuilding would have
overwritten a binary the other lanes are using. Because the compiler is moving, the
delta was isolated by measuring HEAD's source and this slice's source with that one
binary rather than comparing against a figure produced by a different compiler.

Before: 1,264 primary `NTS1001`, 228 `NTS1003`, zero `NTS1004`, zero `NTS4xxx`, no
invalid HIR. After: 1,266 primary `NTS1001`, 228 `NTS1003`, zero `NTS1004`, zero
`NTS4xxx`, no invalid HIR. The net two-primary increase is seven new messages against
five that disappeared. Five of the seven name the construction keys directly: two
module-scope key constants of unrepresentable type, and three key-typed parameters
(`requestConstructorKey`, a `requestConstructorKey | undefined` union, and
`webSocketConstructorKey`). This makes the `unique symbol` construction-key
representation an explicit compiler dependency of this lane; it is reported rather than
avoided, since the alternative is either a process-global capability slot or leaving the
injection hatch open. The remaining two new messages and the five that disappeared are
reachability movement caused by the changed overload declarations, including four
`a method without a body` diagnostics. Those per-site attributions are not
independently verified: this `check` output carries no source locations, so the
accounting is a set difference over diagnostic text.

The counts are a dependency frontier, not completed compiler work and not a
regression.

## A listener whose lifetime is bounded by a caller-supplied resource

The shared `EventTarget` gained the internal seam the Node lane reported as its
remaining `node:events`/`node:util` dependency. `util.aborted(signal, resource)`
registers an abort listener held weakly against a caller-supplied resource: if the
resource is collected the listener detaches, and a later `abort()` must leave the
returned promise pending rather than resolving on behalf of something that no longer
exists. The Node lane's pinned case is `test-aborted-util.js`, whose fifth case
("Aborted with gc cleanup") is the one that fails without this; its exclusion lives in
`runtime/node/util/not-applicable`.

`addWeaklyHeldEventListener(target, type, callback, resource, options)` is exported
from `runtime/web-platform/src/core/events.ts`. It is deliberately not an
`addEventListener` option: no dictionary member reaches it, so nothing script can pass
to the public API requests weak retention, and the host's private symbol is not
copied. It also adds no property to `EventTarget` or its prototype. The module
function reaches ECMAScript-private state through a pair of module-scope function
slots that the class's static initializer assigns once. Those slots hold wiring, not
semantic state: they are the same value for every environment and carry no
per-environment data, so this is not the process-global state the integration
contract excludes. The considered alternative — a key-gated method in the style of the
construction keys above — was rejected because it would put a visible, throwing
property on `EventTarget.prototype`, which is the exposure the handoff forbids.

Retirement has two mechanisms and they are not redundant across providers. A
`FinalizationRegistry` retires the listener once the resource is collected, and the
resource's liveness is also checked at dispatch immediately before the listener would
run. The dispatch check exists because finalization timing is unspecified: a provider
whose reference queue drains at a later safe point — the JVM lane in particular —
would otherwise call a listener whose resource is already gone, which is exactly the
kind of provider-visible divergence the integration plan forbids. The registry
registration is released when a listener is retired for any other reason, so an
ordinary `removeEventListener` does not leave an entry behind. The listener holds only
a `WeakRef` to the resource, and the registry's held value references the target
weakly so that registering a listener never becomes a new reason for the target to
stay alive. Duplicate registration follows the public `(type, callback, capture)`
rule, so this seam cannot install a copy the public API would have rejected.

`resistStopPropagation` is deliberately not included. The Node lane confirmed no
pinned test it has claimed depends on it and asked for the weak handler separately if
that lands sooner; the two behaviors have different owners and different evidence.

Five focused tests pass: delivery and `once` retirement while the resource is alive,
a collected resource leaving the wait pending, an ordinary listener on the same signal
surviving that collection, the seam's absence from the public API and prototype, and
the duplicate/removal rules. The complete local Node-host/real-socket corpus passes
409/409 with zero skipped, and the new file is registered in
`tooling/conformance/web-platform/check.sh`. The pinned upstream corpus is unchanged
at 2,300 total, 2,286 applicable, 2,278 passing, 8 failing and 14 named
not-applicable. The root TypeScript solution build is green.

Two sabotages were run with verified preconditions. Removing both retirement
mechanisms took the focused suite from 5/5 to 3/5 with "a wait keyed to a collected
resource must stay pending" and "only the weakly held listener is retired". Holding
the resource strongly instead of through a `WeakRef` took it from 5/5 to 3/5 with "a
weakly held listener must not keep its resource alive". Both were restored to green.

One branch is deliberately recorded as untested rather than claimed. Removing only the
dispatch-time liveness check does **not** turn this suite red, because on this host the
finalization callback has always already run by the time the abort is dispatched. An
attempt to force the window — repeated synchronous `gc()` with the abort in the same
turn and nothing awaited between them — could not collect the resource at all, because
conservative stack scanning keeps it reachable from the frame that created it. That
test was removed rather than kept as an assertion that examined nothing. The two
mechanisms therefore mask each other here: the host exercises the registry, and the
dispatch check is asserted by construction and still needs provider-level evidence on
a lane whose collector retires references later. A third observation, unrelated to
this seam and not fixed here: TypeScript `private` and `protected` are erased, so
`removeRecord`, `compactListeners`, `reportError`, `setHandler`, `setListenerObserver`,
`setErrorReporter` and `dispatchTrustedEvent` are already own properties of
`EventTarget.prototype`. The prototype assertion therefore checks that nothing named
for this seam appears, rather than comparing the whole list.

The NTS frontier was measured with a compiler built from the current tree at HEAD
`43fda4d3` and then pinned to a private copy, so the number names the binary it came
from and is not disturbed by the other lanes rebuilding. That build includes the
compiler lane's dead-loop-latch fix. Same pinned binary both sides: before, 1,266
primary `NTS1001` and 228 `NTS1003`; after, 1,270 primary and 228 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR in both. The net four-primary increase is
nine new messages against five that disappeared. The new dependencies this seam
reaches are named exactly: one module-scope `let` holding a function that the lowering
will not accept because it may be reassigned with a closure of another layout, five
observations of a `WeakRef | null` property representation, and one enclosing-scope
name in the finalization callback. The `WeakRef` representation is the dependency
already recorded for `AbortSignal.any`'s composite state. Two of the nine new and two
of the five gone are the same pair of `Managed(Object(TypeId(...))) where Float{64} is
wanted` messages with shifted type ids, so they are renumbering rather than movement;
the remaining three that disappeared are reachability changes. These per-site
attributions rest on a set difference over diagnostic text, because this `check`
output carries no source locations.

Note for the earlier entries in this ledger: every frontier recorded above this point
was measured with a different, unpinned binary. Those numbers remain the honest record
of what was measured at the time and are not restated here.

## One proxy endpoint is not one connection pool

A SOCKS5 tunnel is bound to the target named in its CONNECT: the proxy resolves and
connects to that host, and the resulting byte stream reaches nowhere else. Pooling
that keyed on the proxy endpoint would therefore hand a request for one origin a
tunnel that terminates at another. That is a cross-origin routing defect rather than a
performance bug, and it is invisible to any test that only asks whether a response
came back.

The pool keys on the logical target address, so the invariant already held. It had no
regression protecting it, which is what this adds. One `Socks5ProxyAgent` with a
single `socks5://proxy.example:1080` endpoint serves two requests to one origin and
then one to a second origin. Both TCP connections go to the proxy, so the endpoint
alone cannot be what distinguishes them; the decoded SOCKS5 CONNECT targets are
`alpha.example:80` and `beta.example:80`, and each origin's request paths appear only
in its own tunnel's bytes.

The same-origin pair is load-bearing rather than incidental. Without it the separation
assertion would also be satisfied by a pool that never reused anything, which is not
the property being protected; the test asserts that the second same-origin request
opened no new connection before asserting that the second origin did.

The sabotage reduced the pool key to the connection's secure flag, so one endpoint's
tunnel looked reusable for any target. The focused proxy corpus fell from 28/28 to
27/28, and the failure is legible as exactly this defect: `ProtocolError: EOF inside
an HTTP line`, because the second origin's request was written down a tunnel whose
scripted peer had already been consumed. Restoring the target in the key returned it
to 28/28.

The complete local Node-host/real-socket corpus passes 410/410 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. This is host evidence for the shared pooling
algorithm; it is not evidence about any provider's own connection management, and a
production dispatcher that owns its connections needs this invariant established
separately in its own lane.

### Correction: the weakly held seam is not yet reachable from Node

The entry above should not be read as retiring Node's `test-aborted-util.js`
exclusion. After wiring `util.aborted` to the seam, the NodeJS lane measured which
branch ran — through the conformance substitution, with a temporary probe, rather
than by reading the code — and it reported `strong`. The registration reaches an
ECMAScript-private member of the canonical `EventTarget`, so only an instance of that
class can accept it, and nothing under `runtime/node/**` installs the canonical
`AbortController`/`AbortSignal` as globals. A pinned test's `new AbortController()` is
still the host's, so the weak path is not taken.

The shared seam is correct and its tests stand; the caller cannot reach it yet. The
remaining dependency is Node reexporting the canonical abort globals, which is the
plan's canonical-ownership row rather than anything about this listener option. It
also means the dispatch-time liveness branch has no evidence from either lane: the
Node gc case does not reach the shared registration at all, and this host cannot force
the window. Recording that here so the absence is not later mistaken for agreement.

**Correction to that correction: the JVM lane can evidence it.** An earlier report
that ART on API 26 under `app_process` never clears or enqueues a weak reference to a
plainly dead object was measured and was true of the measuring loop rather than of the
platform. `System.gc()` requests a collection and ART hands reference *processing* to a
daemon without waiting for it, so sixty requests and 64 MB of churn watched an empty
queue while every collection asked for had happened; one `System.gc()` followed by
`System.runFinalization()` enqueued on the first attempt with 1.6 MB of churn. The JVM
retirement check now runs on API 26 rather than skipping.

So the window this branch exists for is real on ART and measurable on the declared
floor, and that lane can produce the evidence once the seam is executable from a
compiled program. The general caution is worth repeating for any collector-dependent
conformance case here: a reference-queue test that only calls `gc` is testing whether
the collector ran, not whether references were processed, and on ART those come apart.

## The connect result reports what TLS negotiated

`ConnectAddress.alpnProtocols` said what a caller requested and nothing said what TLS
selected, so shared policy could not offer `["h2", "http/1.1"]` once and then choose
the engine over that same socket. The host adapter validated an expected protocol
internally and discarded the answer. This closes the open decision recorded in the
Node-lane handoff, with the shape agreed by the compiler/common-runtime and JVM owners
before any file was edited.

The result travels on the connect, not on the connection. `NegotiatedConnection`
carries `{ connection, protocol, certificateNames }`. A field on `ByteConnection` would
have put a TLS concept on every byte stream, including the WebSocket and deterministic
in-memory engines that have no use for one, and it would have hidden the asymmetry
that the caller offers a list and is told the single thing chosen. `certificateNames`
is the peer's dNSName SANs as presented, and it is here before HTTP/2 connection
coalescing rather than after: reusing a connection for a second origin is sound only
when the certificate covers it, so coalescing on hostname alone is a cross-origin
routing defect. Cleartext presents no names and therefore simply cannot coalesce.

**The contract is the part that matters, and it came from a device measurement.** The
JVM owner ran the candidate shape on a real API-26 device rather than reasoning about
it: `SSLSocket.getApplicationProtocol`, `SSLParameters.setApplicationProtocols` and
`SSLParameters.getApplicationProtocols` are all absent there, arriving at API 29, while
`X509Certificate.getSubjectAlternativeNames` is available. All three missing methods
compile cleanly against the API-26 `android.jar`, so a compile check would have said
the shape was answerable and the failure would have been a `NoSuchMethodError` on the
declared floor.

That makes "empty means cleartext" wrong, because it conflates *no ALPN happened* with
*ALPN happened and this platform cannot report it*. A provider that offered
`["h2","http/1.1"]`, negotiated h2 and reported nothing would have shared policy select
HTTP/1.1 and speak it into an h2 connection — the exact failure `alpnProtocols` exists
to prevent, one layer lower. Rather than a four-state `protocol` that every use site
can mishandle, the rule is that **a connector which cannot report a selection is never
offered a choice**: it is asked for exactly one protocol, so an absent answer is
unambiguous. `offeredProtocols` and `offeredUpgradeProtocols` enforce that centrally,
so a provider cannot merely be careful about it.

The single protocol is named explicitly in `ProtocolPreference.whenUnreportable`
rather than taken from a position in the ordered list, because the safe choice is the
most compatible protocol and not the most preferred one. The declaration is a
per-instance property, not a build-time constant: one Android build runs on both API 26
and API 29, and baking it in would need two providers where one should do. The same
declaration and contract exist on `NegotiatingTlsUpgrader`, because proxied TLS reaches
the peer through the upgrader rather than a connector and would otherwise silently lose
protocol selection the moment a tunnel is involved.

The capability is declared as optional members on `SocketConnector` and `TlsUpgrader`
themselves rather than only on the negotiating sub-interfaces. A provider author
reading the interface they implement can then see that the capability exists, and
detection asks a declared question instead of probing structurally for a member the
type does not mention. `connectNegotiated` and `upgradeNegotiated` free functions
accept any connector or upgrader, so code written before this ABI keeps working and is
described uniformly as `protocol: null` with no certificate names — which the contract
makes safe, since such a provider was only ever offered one protocol.

Seven focused tests pass, including real TLS. A direct connect to a server offering
`["h2","http/1.1"]` reports `h2` and exactly `["target.test"]` from a fixture
presenting `IP Address:127.0.0.1, DNS:target.test`, so IP entries are excluded and only
names that could justify reuse are reported. A server offering only `http/1.1` reports
that. A tunnelled TLS session through a real HTTP CONNECT proxy negotiates and reports
identically to a direct one. Malformed preferences — an empty list, or an unreportable
protocol absent from the offered list — are refused rather than silently narrowed.

The unreportable case asserts the danger rather than the helper's return value. The
test server records the protocol it actually selected, and the test waits for that
observation, because the server sees its side of the handshake after the client sees
its own and reading the record immediately finds it empty. With the contract in place
the server selects `http/1.1`, matching the `null` the client is told.

The sabotage made `offeredProtocols` ignore the declaration. The focused corpus fell
from 7/7 to 5/7, and a probe under the sabotage shows the precise divergence: offered
`["h2","http/1.1"]`, **server selected `h2`, client told `null`**. Restored, the server
selects `http/1.1` and the two agree. The complete local Node-host/real-socket corpus
passes 417/417 with zero skipped, and the new file is registered in
`tooling/conformance/web-platform/check.sh`. The pinned upstream corpus is unchanged at
2,300 total, 2,286 applicable, 2,278 passing, 8 failing and 14 named not-applicable.
The root TypeScript solution build is green.

This is the ABI and its contract only. Automatic HTTP/1.1 versus HTTP/2 selection over
one connected stream is **not** implemented here, and neither is HTTP/2 connection
coalescing; `certificateNames` is carried so that coalescing cannot later be built
without it. No provider other than the ordinary-Node conformance host implements the
new members yet, and host execution is not evidence that any real provider can report
a selection — on the declared Android floor it demonstrably cannot.

Measured with the same pinned binary built at `43fda4d3`. Before, 1,270 primary
`NTS1001` and 228 `NTS1003`; after, 1,274 primary and 230 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR in both. Four new primaries, none
disappearing. Two are the optional negotiation members reaching an unrepresentable
union of a function type and `undefined`; two are further observations of the
`WeakRef` array dependency already recorded for `AbortSignal.any`, reached because
these entry points take an `AbortSignal`. An earlier revision that detected the
capability with `in` instead of declaring it produced six new primaries and no extra
cascades; the declared version was kept for design reasons and happens to cost two
fewer primaries and two more cascades.

## A cancelled open is not a finished open

Graceful HTTP/2 drain reported completion while provider work it had just cancelled
was still running. `finishDrain()` aborted every in-flight open, cleared the map of
their promises, and then awaited only the connections that already existed. An open
still inside `connector.connect()` was simply dropped.

Cancelling an open does not end the work it started. A connector observes the abort
and may keep a socket attempt outstanding well afterwards, which is ordinary for a real
socket stack; on a provider whose cancellation settles late the gap is wide. During it,
`drain()` had already resolved, so a caller that treats drain as "no provider work
remains" — the reason to prefer it over `close()` — was told something untrue.

The fix snapshots the in-flight opens before dropping them and awaits their
*settlement* before draining connections. A cancelled open ends as a rejection, and
that is its normal ending here rather than a failure of the drain. Ordering matters:
opens are awaited first, because an open that wins the race still finds `accepting`
false, closes the bytes it obtained, and removes itself.

This makes drain's completion unbounded by design when a provider never settles a
cancelled connect. That is the correct reading of a graceful drain, and `close()`
remains the forceful path that does not wait; the two were already distinguished by
`dcfb2a78` and this preserves that distinction rather than blurring it.

The precondition is the strongest available, because the defect was in shipped code
rather than introduced to be caught. The new test drives an open into a connector that
observes the abort but keeps work outstanding, asserts that an open really is in flight
before draining, and then gives drain twenty turns to settle early. Against the previous
implementation it failed with "drain reported completion while provider work from a
cancelled open was outstanding"; against the fix, drain stays pending until the
connector's work settles and only then resolves, with `stats.connecting` back to zero.

The focused HTTP/2 transport corpus passes 8/8 and the complete local
Node-host/real-socket corpus passes 418/418 with zero skipped. The pinned upstream
corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8 failing and 14
named not-applicable. The root TypeScript solution build is green.

Measured with the same pinned binary built at `43fda4d3`: before, 1,274 primary
`NTS1001` and 230 `NTS1003`; after, 1,275 primary and 229 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. The one new primary is `Map#values`
reaching the iteration protocol, which is prerequisite five in the integration plan;
writing the snapshot as a `for...of` push loop instead moved the message rather than
removing it, at the identical total, so the concise form that states "snapshot before
mutating" was kept.

## The engine is chosen on the connection the decision was made on

`ProtocolSelectingTransport` picks HTTP/1.1 or HTTP/2 from what TLS actually
negotiated, once per canonical origin. This is the second half of the ALPN work: the
first landed the result and its contract, and this consumes them.

The selection costs no extra connection. One negotiated connect is made for the
origin, and the stream it produced is handed to the engine that speaks the selected
protocol through an adopting connector whose first `connect()` returns that stream.
Nothing reconnects to change engines, and nothing infers a protocol from request
intent. Later connections for the same origin negotiate again and must agree; a peer
that answers differently produces a typed `ProtocolMismatchError` naming both
protocols rather than an engine speaking into a stream that is not what it thinks it
is. An unreported selection is not a mismatch, because the contract means such a
connector was offered exactly one protocol and had nothing else to choose.

Cleartext origins negotiate nothing, so HTTP/2 there is prior knowledge rather than a
discovery. It is opt-in per transport and is never inferred from a URL scheme, because
sending the connection preface to an HTTP/1.1 peer is not a recoverable mistake. A
non-HTTP(S) scheme is refused rather than negotiated. Concurrent first requests to one
origin share a single in-flight selection instead of racing several. Retiring an
engine releases an adopted stream that engine never took, on both the drain and close
paths, so a decision that is discarded does not leak the connection it was made on.
Graceful drain awaits selections still in flight before draining engines, for the same
reason the HTTP/2 drain now awaits cancelled opens: a selection owns a connection no
engine holds yet.

Six focused tests pass against real TLS servers. A server offering `["h2","http/1.1"]`
yields the HTTP/2 engine and a real h2 response; a server offering only `["http/1.1"]`
yields the HTTP/1.1 engine over the same single connection; three concurrent first
requests produce one connection and one negotiation, multiplexed. Connections are
counted on the client rather than in the server's accept handler, because the server
observes its side of a handshake after the client observes its own and a count read
there would pass while a second connection was still in flight — the first version of
this test made exactly that mistake and reported success under a sabotage.

Two sabotages, both restored. Closing the negotiated connection and letting the engine
reconnect took the focused corpus from 6/6 to 3/6 with `actual: 2, expected: 1`
connections. Ignoring the negotiated protocol and always selecting HTTP/1.1 took it to
4/6, and the failure is the defect itself rather than a bookkeeping assertion:
`ProtocolError: EOF inside an HTTP line`, an HTTP/1.1 parser reading an HTTP/2
connection.

The complete local Node-host/real-socket corpus passes 424/424 with zero skipped, and
the new file is registered in `tooling/conformance/web-platform/check.sh`. The pinned
upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8 failing
and 14 named not-applicable. The root TypeScript solution build is green.

Not claimed here: HTTP/2 connection coalescing, which must use the `certificateNames`
carried by the connect result rather than hostname alone and is not implemented;
selection over SOCKS and HTTP-proxy tunnel routes, which needs the tunnel connectors to
carry the negotiated result outward the way the direct path now does; and any provider
other than the ordinary-Node conformance host. Host execution is not compiled-provider
evidence.

Measured with the same pinned binary built at `43fda4d3`: before, 1,275 primary
`NTS1001` and 229 `NTS1003`; after, 1,284 primary and 229 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. Nine new primaries, none disappearing.
Two are `close` and one is `dispatch` called through an interface the lowering cannot
resolve in the hierarchy; the rest are one `Map#values` iteration, one optional-chained
method call, one promise settled with another promise, one `unknown` narrowed to a
promise, one erased value, and one further `WeakRef` array observation reached through
`AbortSignal`. These are instances of the plan's existing class/interface, iteration,
absence and async prerequisites.

## The contract survives a proxy

Protocol selection previously worked only on the direct route. A tunnel reaches the
peer through the TLS upgrader rather than through a connector, so the negotiated
result stopped at the tunnel boundary and selection silently degraded to the
compatible protocol the moment a proxy was involved. This completes the route coverage
the integration plan requires.

`HttpConnectProxyConnector` and `Socks5ProxyConnector` now carry the negotiated result
outward. A tunnel's ability to report a selection is its TLS upgrader's ability, since
that is what negotiates, so the declaration is derived rather than asserted: the shared
contract's single rule — a connector that cannot report is never offered a choice —
therefore holds through a proxy without a second implementation of it. A cleartext
target through a tunnel reports the same absence the direct path reports for a
cleartext connect. `withConnectDeadline` became generic so the deadline, abort and
cleanup behaviour is shared unchanged between the reporting and non-reporting entries.

`EnvironmentProxyConnector` declares the conservative conjunction of its direct
connector and its tunnels' upgrader. Whether a given address is proxied is decided per
connect while the declaration is read once, so the two possible routes may differ;
under-declaring costs a protocol, while over-declaring is exactly the mismatch the
contract exists to prevent.

Three tests run against real proxies rather than scripted byte streams. A real HTTP
CONNECT proxy and a real SOCKS5 proxy — no authentication, CONNECT by domain name —
each tunnel to a TLS origin offering `["h2","http/1.1"]`, and selection reaches h2
through both. The CONNECT request line is `CONNECT target.test:<port>` and the SOCKS
request carries `target.test:<port>`, so in both cases the logical target crosses the
wire and is never resolved locally; the direct tests need a loopback resolver stand-in
and these deliberately do not.

The third test is the one that matters. A tunnel whose TLS upgrader cannot report a
selection is offered exactly one protocol, and the h2-preferring server therefore
serves HTTP/1.1. Its behavioural assertions are ordered before the capability
assertion on purpose, so that overstating the capability fails as a wrong protocol
rather than as a wrong boolean. The sabotage made a tunnel claim it could report
regardless of its upgrader: the focused corpus fell from 9/9 to 8/9 with
`ProtocolError: EOF inside an HTTP line` — an HTTP/1.1 parser reading an h2 connection
through a proxy, which is the Android-shaped defect reproduced end to end on the route
that was previously untested.

The complete local Node-host/real-socket corpus passes 427/427 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Still not claimed: HTTP/2 connection coalescing, and any provider other than the
ordinary-Node conformance host.

Measured with the same pinned binary built at `43fda4d3`: before, 1,284 primary
`NTS1001` and 229 `NTS1003`; after, 1,287 primary and 233 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. Six messages appeared and three
disappeared, but three of the six are the same messages with shifted type ids and are
renumbering rather than movement. The real increase is two further `WeakRef` array
observations reached through `AbortSignal` and one more `parse` called through an
interface the lowering cannot resolve in the hierarchy — the interface-method shape
that is now the most frequent single dependency in this lane's inventory, and which
the compiler owner has placed ahead of the `BrokenBase` layout defect in their queue.

## Coalescing, and the endpoint question it forced

HTTP/2 connection coalescing reuses one connection for a second origin. The integration
plan requires it and also names its hazard: a pool that coalesces on hostname alone is
a cross-origin routing defect rather than a performance bug. `certificateNames` was
carried on the connect result specifically so this could not be built without it.

`dnsNameCovers` implements dNSName matching narrowly. Names are case-folded and a
trailing root label is the same name. A wildcard is honoured only as the complete
leftmost label of a name with at least three labels and matches exactly one label, so
`*.example.test` covers `a.example.test` but not `example.test`, not
`a.b.example.test`, and never an empty label. `*.test` is refused outright because it
would cover a registry, and partial-label wildcards such as `f*.example.test` are not
honoured: some readings of RFC 6125 permit them, mainstream TLS stacks reject them, and
the safe reading is the one that reuses fewer connections.

Reuse additionally requires that the connection be TLS, that its endpoint and port
match, and that it still be usable. Cleartext presents nothing attesting to a second
origin, so it never coalesces. The port is part of the record because a connection
reaches one port and an origin on another is a different peer — an omission caught
while writing the tests rather than by them.

**Building this surfaced an architectural fact worth recording.** The decision to reuse
must be made *before* connecting, but the endpoint an origin resolves to is chosen by
the DNS policy that sits *below* this transport in the connector chain, and is attached
to the address at connect time. The transport therefore cannot see it when it needs it.
Rather than resolve DNS at the pool — which would make pooling perform network work —
the dependency is named: `knownEndpoint` is a synchronous probe of what has already
been resolved, explicitly allowed to answer "I do not know", and coalescing is inert
without it. An unknown endpoint means the connection is opened normally. Coalescing is
also off by default, because it changes where a request is routed and that is a policy
decision rather than an optimisation a transport may take on its own.

Six tests cover the matching rules directly and each reuse condition separately: a
covered origin on the same endpoint is served over the existing connection with its own
`:authority` still reaching the server; the same pair opens two connections when
coalescing is not asked for; an origin whose certificate does not cover it opens its own
connection and fails identity verification there; a covered origin claiming a different
endpoint does not reuse; and a connection with no known endpoint does not coalesce.

The sabotage removed only the certificate check, leaving every other condition met. The
focused corpus fell from 6/6 to 5/6 with `Missing expected rejection`: `gamma.test` was
answered over a connection whose certificate does not cover it, by a server that does
not speak for it. That is the cross-origin routing defect itself rather than a
bookkeeping assertion.

The complete local Node-host/real-socket corpus passes 433/433 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Not claimed: any wiring of `knownEndpoint` to the shared DNS cache, which is the
natural consumer and is not built; nor coalescing on any provider other than the
ordinary-Node conformance host.

Measured with the same pinned binary built at `43fda4d3`: before, 1,287 primary
`NTS1001` and 233 `NTS1003`; after, 1,288 primary and 233 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. Two messages appeared and one
disappeared, but that pair is one message with a shifted type id. The single real
addition is a `PromiseWithResolvers` property, the representation dependency recorded
since the Streams work.

## file:, and the two things a provider must own

The plan requires a capability-scoped `file:` extension for server and mobile use.
Until now every non-HTTP scheme except `data:` and `blob:` failed as unsupported, so
this is a feature row rather than a refinement.

Absent a provider, nothing changes: `file:` fails with the same "Unsupported URL
scheme" as before, so serving local files is always a deliberate act rather than a
default. The capability is environment-owned, supplied as `WebPlatformOptions.fileURLs`
and reached through the request context, not read from a global.

The split follows what each layer can actually know. Shared code owns which URLs are
fetchable at all — credentials refused, a port refused, a host permitted only when it
is empty or `localhost` — which methods apply, and the shape of the response. The
provider owns URL-to-path mapping and the scope it will serve, because path grammar is
platform policy and which directories an application may read is not something shared
networking code can decide. Bodies reuse the existing external-Blob source, so every
consumer opens its own independent range and no filesystem enters shared code; range
requests reuse the same `fetchBlob` path as `blob:` and are therefore correct for free.

Errors surface as Fetch specifies: an opaque `TypeError: Network request failed` with
the reason on the cause chain. That is the required behaviour and it is also why a
refused path never puts a filesystem detail into the message script sees. The tests
assert through the cause chain rather than the message, which is what made this
visible.

The host provider is scoped to a root and resolves before it compares. A URL leaving
the root arrives already normalized — the URL parser collapses dot segments, so
`.../nested/../../secret.txt` reaches the provider as the parent path rather than as
traversal it must detect textually, and the test asserts that normalization rather than
assuming it. A symlink is the case a textual check cannot see: `root/escape.txt` is
inside the root by every string comparison and outside it in fact. The provider calls
`realpath` on both the root and the target before comparing.

Eight tests cover serving with length and media type, HEAD without a body, a byte
range, a rejected method, a remote host, credentials, the normalized escape, and the
symlink. The sabotage replaced resolved containment with the textual path: the corpus
fell from 8/8 to 7/8 with `Missing expected rejection`, having served a file from
outside the permitted root.

The complete local Node-host/real-socket corpus passes 441/441 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Not claimed: directory listings, which have no defined representation here and are
refused; conditional requests or `Last-Modified` on file responses; and any provider
other than the ordinary-Node conformance host. One provider's scoping is not another's,
and a mobile provider's is its own to prove.

Measured with the same pinned binary built at `43fda4d3`: before, 1,288 primary
`NTS1001` and 233 `NTS1003`; after, 1,290 primary and 233 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. Three messages appeared and one
disappeared, but that pair is one message with a shifted type id. The two real
additions are one further `this` outside a method (eight to nine) and one further
top-level `await` (two to three), both existing diagnostics of the enclosing `fetch`
arrow property gaining another occurrence rather than new dependencies.

## The Undici API ledger cannot be written yet, and that is a finding

The plan requires an explicit API ledger against a pinned standalone Undici release,
in which each exported operation is marked implemented, deliberately different, or not
applicable *with evidence*, and states that "architecturally supported" does not count
as API compatibility.

No Undici revision is pinned or vendored in this repository, and nothing records one.
The plan also says immutable revisions must be recorded at implementation start and
that an unpinned `main` is not a conformance claim. Writing the ledger from memory of
Undici's surface would produce exactly the asserted compatibility the plan forbids, so
it is not written. Pinning a revision means introducing a third-party dependency, which
belongs to the repository's reviewed dependency process rather than to this lane acting
alone.

Recording it here so the gap is visible: the ledger is an unmet plan requirement whose
blocker is a dependency decision, not effort.

## The probe was asking the wrong question

Coalescing shipped inert, needing a `knownEndpoint` probe nothing supplied. Wiring it
to the shared DNS cache showed the probe's shape was wrong, so the shape changed
before a consumer depended on it.

`knownEndpoint` returned one endpoint: *which* address would this origin use. The
condition that actually licenses reuse is membership: **may this origin be served by a
connection already on endpoint X?** Those differ whenever a host has several addresses
and the live connection is on one the probe would not have named — a legitimate reuse
missed, and a rule that reads as if it had been checked. `knownEndpoints` now returns
the set, and the transport tests membership against the endpoint the connection is
actually on.

"Actually on" also changed. The record previously fell back to the probe when the
address carried no `resolvedAddress`, which answers where a fresh lookup would go
rather than where this connection went. `NegotiatedConnection` gained an optional
`endpoint`, reported by the layer that chose it, and the record uses that. Only the
connector knows which address it dialled, and a reuse decision that guesses is a
routing decision that guesses.

`DnsCache.knownAddresses()` is the probe's natural source and is deliberately
read-only. The existing cached read advances round-robin rotation and refreshes
recency, so reusing it would have let a pooling decision change what the next real
lookup answers. The new method neither resolves nor rotates nor touches recency, and
answers an empty list for an unknown host — never confusable with "no addresses
exist", because coalescing treats unknown as "open a connection normally".

Three tests were added. One drives a host whose known set contains the live endpoint in
second position, which is the case the single-value probe would have missed. One
asserts the cache probe against a **control cache that was never probed**: rather than
hardcoding a rotation order, it checks that three probes leave the next real lookup
exactly where an unprobed cache leaves it, which is the property that matters and is
robust to the rotation rule changing. The first attempt did hardcode the order, guessed
it, and failed. The third wires a real `DnsCache` in as the probe end to end.

Two sabotages, both restored. Making the probe use the rotating cached read failed the
control comparison. Replacing membership with equality against the first candidate made
the second origin open its own connection: `['alpha.test', 'beta.test']` where
`['alpha.test']` was expected.

The complete local Node-host/real-socket corpus passes 444/444 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Coalescing is still opt-in and still requires a caller to supply the probe; nothing
enables it by default, and no provider other than the ordinary-Node conformance host
reports an endpoint.

Measured with the same pinned binary built at `43fda4d3`: 1,290 primary `NTS1001` and
233 `NTS1003` before and after, with zero `NTS1004`, zero `NTS4xxx` and no invalid HIR.
One message differs between the two runs and it is the same message with a shifted type
id, so this slice moved the frontier not at all.

## Integrity was accepted and never checked

`Request.integrity` was stored, threaded through Cache, and read by nothing. A caller
who wrote `sha256-…` got no verification and no error. That is worse than not
supporting integrity: the one failure mode a caller cannot detect is the check that
silently did not happen, and the API's shape said it had.

Verification now runs against the decoded body, after content codings, which is where
the standard places it and which forces the response to be materialized — a digest
cannot be computed from a stream nobody has read. Materialization uses the
environment's existing consumption bound, so asking for integrity cannot quietly raise
a memory limit the environment set. The bytes handed back are the bytes that were
checked, republished from the verified buffer rather than from a second read of a
source that could answer differently.

The digest itself is a provider capability: cryptographic primitives belong to the
platform. **Its absence does not make the requirement optional.** A request carrying
metadata this environment cannot check is refused before it is sent, as is one naming
an algorithm the provider does not offer. Metadata consisting entirely of algorithms
this profile does not know places no requirement at all, which the standard specifies
and which is a different thing from an unmet one.

Only the strongest algorithm present applies, and a match against any entry of that
algorithm is a match — so a correct `sha256` alongside a wrong `sha512` fails, in
either written order. Comparison decodes the expected value and compares bytes, so
padding and the choice of base64 alphabet cannot make two spellings of one digest
disagree, and it does not exit at the first differing byte: a loop that stops early
reports through timing how much of a digest was right.

Parsing uses the runtime's shared ASCII-whitespace predicate rather than a pattern.
That is the set the grammar names and what the rest of this runtime uses; the two
regular-expression literals an earlier revision carried were removed for that reason
rather than to move a count, and the count moved anyway.

Nine tests cover the grammar, the alphabet and padding cases, every supported
algorithm end to end, a mismatch, strongest-wins in both orders, unknown-algorithm
metadata, and each fail-closed path. One of them initially passed for the wrong
reason: `runtimeWith(t, undefined)` triggers a default parameter, so the runtime that
was supposed to have no digest provider had one. It is now a separate helper that
asserts the provider really is absent before the test relies on it.

Two sabotages, both restored. Never rejecting a mismatch — the defect exactly as it
shipped — took the corpus from 9/9 to 7/9. Selecting the weakest algorithm instead of
the strongest took it to 7/9 on different cases.

The complete local Node-host/real-socket corpus passes 453/453 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Not claimed: integrity on `data:`, `blob:` or `file:` responses, which the standard
does not require and which this does not attempt; and any provider other than the
ordinary-Node conformance host, whose digest is `node:crypto`.

Measured with the same pinned binary built at `43fda4d3`: before, 1,290 primary
`NTS1001` and 233 `NTS1003`; after, 1,293 primary and 233 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. Five messages appeared and two
disappeared; that pair is two messages with shifted type ids. The three real additions
are one `digest` called through an interface the lowering cannot resolve in the
hierarchy, one further `this` outside a method, and one further `WeakRef` array
observation. The revision that used regular-expression literals measured 1,295 and 235
instead.
