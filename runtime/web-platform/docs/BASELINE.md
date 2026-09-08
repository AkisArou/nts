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

## A listener script cannot silence

Node registers its abort listeners with a private `kResistStopPropagation`, so an
earlier listener calling `stopImmediatePropagation()` does not cancel them.
`addInternalEventListener` and a `resistStopPropagation` option on the existing weak
seam provide that, on the same terms as the rest of the internal listener surface: not
an `addEventListener` option, no new property on `EventTarget` or its prototype, and
the host's private symbol not copied.

The dispatch loop previously broke out entirely on an immediate stop. It now skips
non-resisting listeners and keeps scanning, because a resisting listener registered
after the one that stopped would otherwise be unreachable — the break made position in
the list decide whether the option worked. Behaviour for every ordinary listener is
unchanged: skipped and broken-out-of are the same thing when nothing resists.

Resisting is opt-in rather than what "internal" means. A runtime listener that must
observe an event regardless is a different thing from a runtime listener, and
conflating them would let any internal registration quietly outrank script.

**The sequencing here was settled by the Node lane's experiment, not by argument.**
They first reported this option as unnecessary, then found their own ledger had named
it, then installed the canonical abort globals in four lines to see whether the
globals alone would close their failing case. They do not: with canonical globals
`test-events-add-abort-listener.mjs` fails identically, which is what makes this option
the remaining blocker rather than a guess. The same experiment found a dependency
neither lane had counted — a canonical `AbortSignal` handed to the host's
`node:events` breaks `listenerCount`, because the host cannot answer for a foreign
`EventTarget` — so the globals are not the cheap prerequisite they looked like. That
part is the Node lane's, and it is why this option is worth having on its own.

Four tests were added: a resisting listener registered *after* the one that stops still
runs; an internal listener without the option is silenced like any other; no dictionary
member reaches the option and nothing named for it appears on the prototype; and
resisting composes with weak holding, where a live resource still runs and a collected
one is not resurrected by resisting.

Two sabotages, both restored. Letting the stop silence resisting listeners took the
focused corpus from 9/9 to 7/9. Making every internal listener resist took it to 8/9 on
the case that asserts the option is opt-in.

The complete local Node-host/real-socket corpus passes 457/457 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Not claimed: that this closes any Node test. The Node lane's case is theirs to run, and
their `test-aborted-util.js` gc case additionally needs the canonical globals and the
`node:events` work described above.

Measured with the same pinned binary built at `43fda4d3`: before, 1,293 primary
`NTS1001` and 233 `NTS1003`; after, 1,294 primary and 233 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. Two messages appeared and one
disappeared; that pair is one message with a shifted type id. The single real addition
is one more module-scope `let` holding a function — the same static-initializer capture
this seam already used, now naming two functions instead of one.

## The server half of the handshake

The plan requires a WebSocket server as a Node/server extension reusing the shared
frame and extension engine. This is its handshake and only its handshake:
`acceptWebSocketUpgrade` validates an upgrade request and produces the response, with
no I/O of its own. Reading the request, writing the response and taking over the
connection belong to whatever HTTP server this is embedded in, and inventing a server
object here would have decided that embedding for everyone.

Validation is the RFC's: `GET`, an `Upgrade` naming websocket, a `Connection`
containing the upgrade token, version 13, and a `Sec-WebSocket-Key` that is really
sixteen base64 bytes. Both header checks go through the shared token-list helper, so
`Connection: keep-alive, Upgrade` and `Upgrade: WebSocket` are accepted as real clients
and proxies send them, rather than being compared whole.

The key check earns its place. The accept value is derived from the literal string, so
a malformed key still produces a handshake both sides agree on — the check exists
precisely because the handshake would otherwise work by accident and the field would
stop meaning what it says. Leading and trailing whitespace is header framing rather
than part of the key, and is trimmed before both validation and derivation.

Every refusal is a real HTTP response carrying `Connection: close`, never a dropped
connection, so a client learns why. A wrong version is the one refusal the RFC gives a
shape: it advertises `Sec-WebSocket-Version: 13`, without which a client cannot know
what to retry with. Subprotocol selection takes the server's preference order rather
than the client's, and no common subprotocol is a successful handshake with no
subprotocol rather than a failure.

Extensions are declined. A server may always decline, and negotiating
permessage-deflate from the server side needs an offer parser this does not have; the
existing negotiator is the client-side one that validates a server's *response*.
Answering an offer it could not fully honour would be worse than declining.

Seven tests. Six are direct, including the accept value checked against an independent
SHA-1 rather than against our own derivation. The seventh runs the canonical client
against a server built on this handshake over a real socket, completing the upgrade,
agreeing a subprotocol and round-tripping a message — the only way to show the
handshake is one a real client accepts rather than one that merely looks right.

Two sabotages, both restored. Deriving the accept value from a different key took the
corpus from 7/7 to 5/7, and the second failure is the client refusing the handshake,
which is what makes the end-to-end case load-bearing rather than decorative. Selecting
a subprotocol the client never offered took it to 6/7.

An earlier attempt at the first sabotage replaced the accept value's final character
with `=`, which it already was, and the suite stayed green against a mutation that
changed nothing. It is recorded because the lesson is the session's recurring one: a
sabotage that does not move the value proves nothing, and a green result under it is
not evidence.

The complete local Node-host/real-socket corpus passes 464/464 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Not claimed: a WebSocket server. There is no server object, no connection lifecycle, no
session, no extension negotiation, and no separate public module — the plan asks for
all of those and this is the first piece. The test's echo loop frames by hand and is a
test fixture, not an implementation.

Measured with the same pinned binary built at `43fda4d3`: before, 1,294 primary
`NTS1001` and 233 `NTS1003`; after, 1,295 primary and 234 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. The single new primary is exact and worth
naming: reading `status` from a discriminated union whose members lay their fields out
differently. That is an ordinary TypeScript result type rather than an exotic shape, so
it is reported rather than flattened into a single interface with optional members.

## Compression the server can actually perform

The handshake declined every extension offer. That was correct and it was a limit, so
this removes it: `negotiatePerMessageDeflateOffer` answers a client's RFC 7692 offer
from the server side, and the handshake uses it when asked to.

It is off by default. A handshake that agrees to compression the embedder cannot
perform produces a session neither side can read, so negotiating is enabled alongside
a deflate provider rather than assumed. The agreed parameters are returned on the
outcome rather than only written into a header, because the embedder has to configure
its codec with exactly what was agreed and re-parsing its own response to discover
that would be a second implementation of the same decision.

Directions are named for whose traffic they describe rather than whose parameter they
came from: `incoming` is client-to-server, governed by the `client_*` parameters, and
`outgoing` is server-to-client, governed by the `server_*` ones. Reversing them
produces a session that negotiates successfully and then cannot decompress, which is
the kind of mistake a name can prevent and a comment cannot.

An offer is accepted only if every parameter in it can be honoured exactly. An unknown
parameter, a duplicate, a value on a valueless flag, or a window outside 8..15 makes
that entry unusable and the next entry is tried; accepting while ignoring part of an
offer would agree to something neither side then implements. A client may send several
entries in preference order and the first honourable one wins. Nothing usable, or no
offer, is a successful handshake with no compression — never a failed one.

`client_max_window_bits` gets its own rule because the RFC gives it one: it may appear
in the response only if the client showed it understands the parameter. A bare
`client_max_window_bits` states support without requesting a limit, so the server
imposes none and says nothing; a client that never mentioned it is never sent it,
because a conforming client fails the handshake on receiving it. Symmetrically a bare
`server_max_window_bits` leaves the choice to the server, which keeps 15 and therefore
does not name the parameter either.

Three tests were added, covering the default-off behaviour, each honoured parameter and
its exact echoed response, and seven distinct unusable offers plus preference-order
fallback. Two sabotages, both restored: accepting an offer while ignoring parameters it
could not honour took the corpus from 10/10 to 9/10, and answering
`client_max_window_bits` when the client never mentioned it took it to 7/10.

The window-bits parser scans digits explicitly rather than using a pattern, for the
same reason the integrity parser does: it is a two-character decimal range, the shared
style avoids the regular-expression dependency, and consistency within the runtime is
worth more than the shorter spelling.

The complete local Node-host/real-socket corpus passes 467/467 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Still not claimed: a WebSocket server. This negotiates compression; it does not
compress. The shared `PerMessageDeflate` codec exists and is wired for the client
direction only, and nothing here connects the negotiated parameters to it.

Measured with the same pinned binary built at `43fda4d3`: 1,295 primary `NTS1001`
before and after, 234 to 235 cascades, with zero `NTS1004`, zero `NTS4xxx` and no
invalid HIR. One message differs between the runs and it is the same message with a
shifted type id; the added cascade is the handshake's new call into the negotiator.

## A clock that moves only when told to

The environment contract requires deterministic oracle tests to use virtual time and
requires that network activity never silently advances it. `VirtualScheduler`
implements the `Scheduler` seam with a clock that observes nothing: time passes only
through `advance()`, so a test expecting a timeout has to say so.

It is a provider rather than a test helper, and it is portable — no host dependency at
all — so every target can run the same deterministic corpus rather than each lane
writing its own approximation. Until now the only virtual clocks in this repository
were ad-hoc objects defined inside individual test files.

Three decisions are load-bearing and each has a test that fails without it.

The clock **stops at each deadline** instead of jumping to the end of the interval. A
task therefore sees the time its own deadline implies, and a timer it schedules inside
the remaining window still runs in the same advance. Jumping would make the outcome
depend on how the caller happened to divide the interval, which is the opposite of
deterministic.

Equal deadlines run in **scheduling order**. Without an explicit sequence the outcome
would depend on array order after removals, which is a race written down rather than
avoided.

Cancellation is checked **when a timer is selected**, not when it is scheduled, because
a running task may cancel a timer this advance has not reached yet. Cancelling twice or
after firing is inert.

Queued tasks drain before timers and never move the clock; a failing task is reported
and the run continues, so one exception does not hide every later assertion behind it;
and negative, `NaN` and infinite times are refused everywhere rather than normalized.
`advanceToNextDeadline()` reports whether it moved, so a caller can drive a scheduler
to quiescence without guessing an interval — including deadlines discovered on the way.

Nine tests. Three sabotages, all restored: not stopping at each deadline took the
corpus from 9/9 to 6/9; reversing the tie-break for equal deadlines took it to 8/9;
and checking cancellation only at scheduling time took it to 8/9.

The complete local Node-host/real-socket corpus passes 476/476 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Not claimed: that anything uses it yet. The existing suites keep their own ad-hoc
clocks, and moving them is separate work with its own risk of changing what a test
measures. Nor does this settle the environment-level time-mode selection the contract
describes; it provides the virtual mode, not the choice between modes.

Measured with the same pinned binary built at `43fda4d3`: before, 1,295 primary
`NTS1001` and 235 `NTS1003`; after, 1,298 primary and 240 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. The three new primaries are one `push` on
a homogeneous array, one assignment to an array's `length` in the compaction path — the
same shape recorded for `Headers` and `FormData` — and one property access the lowering
does not find declared on the type. The five cascades are the call graph from the tests
of those paths.

## The timing EventSource is specified in terms of

The EventSource suite used `retry: 0` throughout. That was not carelessness: with a
real clock, asserting that a reconnect happens after three seconds and not before means
either sleeping for three seconds or asserting nothing, and the suite chose neither by
removing the delay from every test. Reconnection timing — a requirement the plan names
explicitly — had no coverage at all.

Four tests now run EventSource against a `VirtualScheduler`. They assert the scheduled
deadline directly rather than inferring it from when a request happened to appear, then
advance to one millisecond short of it and confirm nothing reconnected, then advance the
last millisecond and confirm it did. They cover the configured delay, a `retry:` field
replacing it and persisting across a later reconnect that does not mention one,
`Last-Event-ID` carried into the retry, `close()` cancelling a pending reconnect
permanently, and a 204 being fatal rather than a slow retry.

**The measurement that justifies the slice**: with the reconnect delay removed
entirely, so every reconnect fires immediately, the pre-existing EventSource suite
still passes 5/5 while these fall to 1/4. The old suite could not see timing, which is
what having built the clock buys. Ignoring the stream's `retry:` field takes the new
suite to 3/4 while the old one again notices nothing.

Two things about using a clock that moves only when told to, both learned by getting
them wrong. Real promise turns and virtual drains have to alternate: awaiting real
ticks alone watches a queue that never empties, and the first version of this file
reported that no request was ever made. And the reconnect timer does not exist the
instant a stream ends — it is scheduled several microtask turns later — so advancing
too early moves the clock past a deadline that has not been set yet, which reads as
"the reconnect never happened" and is really "the test asked too early". Both are
recorded in the helper, because the next person to reach for this clock will hit them
in that order.

The complete local Node-host/real-socket corpus passes 480/480 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green. The
NTS frontier is unchanged at 1,298 primary `NTS1001` and 240 `NTS1003`, which is the
expected result for a slice that adds tests and changes no shared source.

## One engine, both ends

RFC 6455 makes masking the single asymmetry in WebSocket framing: a client masks every
frame it sends, a server masks none, and each rejects the other spelling. Everything
else — fragmentation, UTF-8 validation, control frames, the close handshake,
compression, message limits — is identical in both directions. So the session engine
takes a role rather than being written twice, and `adoptServerWebSocketSession` drives
it from the server side over a connection the caller has already upgraded.

`readFrame` already took an `expectMasked` parameter and `encodeFrame` already took a
`masked` one; both were passed constants. Making them follow the role is the whole
change to the engine. A second server-side implementation of message assembly would
have been the alternative, and it would have been the copy that drifts.

The handshake stays the caller's. `acceptWebSocketUpgrade` decides the response, the
embedding HTTP server writes it, and the byte stream that arrives here is already a
WebSocket. The factory takes the `BufferedReader` that consumed the request head, so
bytes a client sent immediately after its own handshake are not lost between the two —
which is why `BufferedReader` and `writeAll` are now part of the provider boundary: a
caller cannot use the factory without being able to construct the reader it takes.

The negotiated compression parameters connect to the codec unchanged, because both
negotiators name their directions from their own side: the client maps
`server_no_context_takeover` to *incoming* and the server maps it to *outgoing*, and
each is right about its own traffic. `PerMessageDeflate` therefore consumes either
without knowing which end it is on.

Four tests run the canonical client against a server built from these pieces over a
real socket: a text and a binary message round-tripping in order with `binaryType`
deciding what a message is, a masked-frame round trip, a compressed round trip of a
5,200-character payload with both ends reporting `permessage-deflate`, and a handshake
that selects no subprotocol still opening.

Two sabotages, both restored. Making the server mask what it sends took the corpus from
4/4 to 1/4; making it expect unmasked frames from a client did the same. Both fail as
the client rejecting the connection rather than as a bookkeeping assertion, which is
the point of running a real client rather than asserting on bytes.

Three defects in the test harness were found on the way, and one of them is worth
keeping: the byte-connection adapter returned whole socket chunks regardless of the
`maxBytes` the reader asked for. That is a contract violation the reader is entitled to
trip over, and it presented as the session simply never producing a message.

The complete local Node-host/real-socket corpus passes 484/484 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Still not claimed: a WebSocket **server**. There is no accept loop, no connection
lifecycle owner, no backpressure policy above the session, and no separate public
module — the plan asks for all of those. What exists now is a session that speaks the
server end correctly, which is the part that had to be shared rather than written
twice.

Measured with the same pinned binary built at `43fda4d3`: 1,298 primary `NTS1001`
before and after, 240 to 241 cascades, with zero `NTS1004`, zero `NTS4xxx` and no
invalid HIR. Two messages differ between the runs and both are the same messages with
shifted type ids. An earlier revision wrote the end callback as `() => end?.()`, which
cost one primary for a function returning `undefined | void`; rewriting it as a block
moved the diagnostic to the optional call rather than removing it, and an explicit
`if (end !== undefined)` — the spelling this codebase uses elsewhere — costs nothing.

## Fuzzing that can say what it covered

The plan lists protocol fuzzing under testing and observability. The property is not
"does it parse" — malformed input is the point — but that malformed input always
reaches a **named** failure: a typed error from this runtime's own taxonomy, in bounded
time, with nothing half-decoded escaping as a result. A raw `TypeError` from indexing
past an array, or a `RangeError` from an allocation, means the parser fell over rather
than refused, and the two are indistinguishable to a caller that only sees a rejection.

Six thousand seeded iterations run against the WebSocket frame decoder in the server
direction and the HTTP/1 header-field parser. Every accepted result is checked for
internal consistency — a control frame is never fragmented and never large, an accepted
opcode is one of the six that exist, a parsed field always has a name — because a
parser that accepts garbage quietly is the failure mode a fuzzer exists to find.

The corpus is seeded and its determinism is itself asserted: two generators from one
seed agree exactly, and two different seeds diverge. A fuzzer whose corpus changes per
run reports failures nobody can reproduce.

**The generator asserts its own coverage**, which is the part most easily left out. Six
shapes are counted — accepted frames, control opcodes, reserved bits, wrong masking,
extended and 64-bit lengths — and the test fails naming any shape that never appeared.
Without it the whole suite passes while generating nothing but two random bytes, which
is the "mechanism that is never the only way in" pattern applied to a test rather than
to an implementation.

Both parsers passed as they stand: no unnamed failure in six thousand iterations.

Four sabotages, all restored. Letting an invalid opcode reach the caller was caught.
Dropping the control-frame fragmentation and size constraint was caught. Making the
corpus incapable of carrying an extended length was caught by the coverage guard, which
is what proves that guard is not decoration.

The fourth is recorded because it did **not** fire and the reason matters. Mapping every
reserved opcode to `1` instead of rejecting it produces a structurally valid frame, and
a structural fuzzer cannot see it: the frame is consistent, it is simply about the wrong
thing. That is a real limit on what this technique establishes — it finds parsers that
fall over or accept malformed structure, not parsers that are confidently wrong — and
naming it is more useful than picking a sabotage that flatters the method.

The fuzzer lives in the conformance suite rather than in shared source. It is a test
driver rather than a runtime feature, unlike `MockAgent` and `SnapshotAgent`, which are
capabilities a consumer uses.

The complete local Node-host/real-socket corpus passes 487/487 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The NTS frontier is unchanged at 1,298 primary
`NTS1001` and 241 `NTS1003`, as expected for a slice that adds tests and changes no
shared source.

## The error taxonomy is a contract, so it is now asserted

Consumers switch on `error.name`, and two dispatch policies switch on whether an error
is a `TransportError`: `RetryInterceptor` retries only typed transport failures, and
only typed transport failures reduce a `BalancedPool` upstream's health. Both are
load-bearing and neither was asserted anywhere, so a class added to the wrong base — or
renamed — would have changed retry and routing behaviour silently.

The twenty exported error classes are now pinned in a table with how to construct each
and whether it belongs to the transport set. The exported set must equal the table
exactly, so adding an error class fails until the retry-and-routing decision is made,
and removing one fails as the compatibility break it is. Every instance must report its
own export name, names must be unique, and the two classes with a non-`Error` base keep
it: `MockNotMatchedError` is a `TypeError` because an unmatched mock is a programming
mistake, and `WebSocketError` is a `DOMException` because the WebSockets standard says
so.

**Writing it down surfaced a classification worth naming.** `ProxyResponseError`,
`Socks5ProxyError` and `ProxyConfigurationError` are not `TransportError`s, so a failing
proxy upstream never loses health and a proxy failure is never retried. For
configuration and authentication that is correct — retrying cannot help, and penalising
an upstream for a fixed misconfiguration would route traffic away from it forever. For a
transient 502 from a proxy it is arguably wrong. It is pinned with that reasoning rather
than changed, because changing it changes routing and that is a decision rather than a
tidy-up.

Two sabotages, both restored. Renaming `DnsNoAddressError` was caught. Moving
`ProxyResponseError` into the transport set was caught by two tests at once. That second
one also found a structural guard already in place: `TransportError` requires a
`TransportErrorCode`, so the move does not even compile until the error's own
`UND_ERR_PRX` code is removed — the type system objects before the test does.

The complete local Node-host/real-socket corpus passes 492/492 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The NTS frontier is unchanged, as expected for a
slice that adds tests and changes no shared source.

## Something that knows how many sessions are open

`WebSocketServer` owns the lifetime of server-side sessions. It is deliberately not an
accept loop: listening, TLS and HTTP request parsing belong to the server this is
embedded in, which already has all three. What existed nowhere else is something that
knows how many sessions are open, refuses when that is too many, and can close all of
them once.

`upgrade()` completes the handshake on an already-read request and adopts the session.
The response is written there rather than returned, because the handshake and the first
frame share one connection and one reader — handing the response back would let a
caller write it late, or not at all, while this object already believed the session was
live. Registration happens before the session is handed out, so a caller that starts
reading immediately cannot retire a session the server has not counted.

The connection bound is not optional. A server that accepts every upgrade has no way to
shed load, so `maxConnections` defaults to 1,024 and a non-positive or non-integer bound
is refused at construction. Being above the bound produces a real `503` rather than a
dropped socket, so a client learns it was turned away instead of timing out. The same
response is given once the server is closing.

`close()` stops accepting and closes every open session with code 1001, waiting for each
to settle; repeated calls share one shutdown rather than starting a second. `destroy()`
abandons them without a close handshake. Sessions remove themselves when they end, so
the count follows reality rather than being maintained by whoever remembers to.

Five tests drive it with the canonical client over real sockets: the count rising and
falling with live sessions, a refusal above the bound arriving as a 503 that does not
become a held session, `close()` reaching every session with a clean 1001 and being one
shutdown for two callers, a closed server refusing new upgrades, and an invalid bound
refused at construction.

Two sabotages, both restored. Not enforcing the bound was caught. Never unregistering a
session that ended was caught, with the count stuck at two.

**A third sabotage failed to demonstrate anything, and the comment it targeted was
wrong.** The shutdown snapshots the session set, and the comment claimed that iterating
while the set empties would skip sessions. Deleting the element currently being visited
during JavaScript `Set` iteration is safe, so that hazard is not real here. The rewritten
comment claimed instead that the snapshot lets closes start concurrently — and a
sequential shutdown passes these tests too. The comment now says the snapshot exists
because a `Set` cannot be mapped, that concurrency is a preference, and that nothing
here checks it. A comment asserting a property no test covers is the same defect as a
test asserting nothing, and it is harder to notice.

The complete local Node-host/real-socket corpus passes 497/497 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Still not claimed: a listening server, TLS termination, HTTP routing, backpressure
policy above the session, or the separate public module the plan asks for. The last is a
packaging decision touching repository layout and is worth agreeing before building.

Measured with the same pinned binary built at `43fda4d3`: before, 1,298 primary
`NTS1001` and 241 `NTS1003`; after, 1,302 primary and 242 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. Four new primaries, none disappearing:
`close` and `abort` called through the `WebSocketSession` interface, a promise settled
with another promise, and a spread of a `Set`. The first two are the interface-method
shape the compiler owner has just implemented, so this slice should be among the
diagnostics that disappear when that lands — which makes it a useful check on their
change rather than only a cost.

## Early hints were counted and thrown away

Interim (1xx) responses were read, counted against a bound, and discarded. That is safe
and it throws away the only thing they are for: `103 Early Hints` carries `Link` fields
a client is meant to act on while the origin is still working, and a client that never
sees it cannot act on anything. The plan lists informational responses under HTTP
protocols and early hints under Fetch, so this was a row with a limit rather than an
implementation.

`TransportRequest.onInformational` is called for each interim response in the order
received, before the final one, and never for `101` — a protocol switch is not a hint.
It sits at the dispatcher layer, where Undici's `onInfo` lives, rather than on `fetch()`,
because Fetch itself exposes no such thing; "where exposed" is the plan's own
qualifier. It is optional, so a provider that cannot surface interim responses simply
does not call it and nothing else changes.

An exception from the observer is reported through the scheduler and does not change the
request, for the same reason a diagnostics failure does not: observing a request is not
permission to fail it. Exposing hints did not raise the interim bound either — the
`maxInformational` limit still applies, still raises `LimitError`, and the hints within
it are still delivered before it does.

Seven tests use a raw socket server, because Node's HTTP server will not emit an unusual
interim sequence on request: two `103`s with multiple `Link` fields arriving in order
before a `200`, a bare `200` producing no hint at all, `100 Continue` treated like any
other interim response, a throwing observer leaving the request intact, the bound still
firing after three of six hints, and a request with no observer behaving exactly as
before.

Three sabotages. Letting an observer's exception escape into the request was caught.
Publishing the final response as an interim one was caught by four tests at once.

**The third did not fire, and the test that was supposed to catch it was claiming too
much.** Handing the observer the live header array instead of a copy changes nothing
observable, because an interim head is discarded the moment it has been published —
there is no retained structure left to contaminate. The test asserted it protected the
transport; it does not, and it now says so. The copy stays, because a later change that
does retain an interim head should not quietly begin handing callers something they can
edit, but it is defensive rather than demonstrated and both the test and the code
comment record that.

The complete local Node-host/real-socket corpus passes 504/504 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Not claimed: HTTP/2 interim responses, which take a different path and are not wired to
this; nor any Fetch-level surface, which the standard does not define.

Measured with the same pinned binary built at `43fda4d3`: before, 1,302 primary
`NTS1001` and 242 `NTS1003`; after, 1,303 primary and 242 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR. Two messages appeared and one
disappeared; that pair is one message with a shifted type id. The single real addition
is a `for...of` binding two names over a header sequence — destructuring `[name, value]`
while copying — which is the iteration-protocol prerequisite.

## I committed a file overwritten by my own measurement script

`733e6492` shipped `runtime/web-platform/src/fetch/transport.ts` containing the
contents of `runtime/web-platform/src/http1/transport.ts`. The tree did not type-check
for the duration of that commit.

The cause is worth writing down because the procedure that caused it is one this ledger
has praised repeatedly. Isolating a slice's diagnostics means swapping the changed files
for HEAD's copies, measuring, and swapping back. That script backed each file up by its
**basename**, and those two files share one. The second backup overwrote the first, and
the restore then wrote the HTTP/1 transport into both paths.

Two things let it reach a commit. The full gate ran *before* the isolation step rather
than after it, so 504/504 was a true statement about a tree that no longer existed by
the time it was committed. And `commit-mine.sh` runs clippy, which has nothing to say
about TypeScript, so the last gate between a broken tree and a commit does not look at
this lane's source at all.

Recovered by restoring the file from `398d34b1` and re-applying the interim-response
addition to it. `http1/transport.ts` was never damaged and kept its half of the change.
After recovery the repository type-checks, the complete local corpus passes 508/508 with
zero skipped, the pinned upstream corpus is unchanged at 2,278 of 2,286 applicable, the
root solution build is green, and the NTS frontier reads 1,303 primary `NTS1001` and 242
`NTS1003` — the same figures measured before the swap, which is the evidence that the
committed source is the source that was measured.

The procedure is now: back up by full path, and re-run the type-check after any
file-swapping measurement and before committing. A measurement that mutates the tree is
a mutation, and it needed its own control exactly as a sabotage does.

## Which Request fields do something, and which deliberately do not

The plan keeps browser-oriented fields observable even where their enforcement
algorithm is excluded: there is no document, so no unload for `keepalive` to survive, no
CORS for `mode` to select, and no document origin for `referrerPolicy` to derive from.
Inert is correct for those. It is also indistinguishable from outside from a field that
should do something and does not — which is what `integrity` was until earlier in this
session. So the split is asserted rather than assumed.

`mode`, `referrerPolicy` and `keepalive` are readable, survive a clone, and survive a
Cache round trip; observable metadata that vanished in storage would be observable only
until it mattered. `priority` is accepted in the init and deliberately has no getter,
because Fetch defines `RequestInit.priority` and no matching attribute — inventing one
would be as wrong as omitting one the standard does define.

The decisive test sends two real requests differing only in an inert field and compares
the bytes the server received. If any of them ever starts affecting the wire, that is
where it surfaces, and the entry has to move to the enforced side deliberately.

The contrast is asserted too: method and headers reach the wire, `redirect` validates,
`duplex` is required for a streaming body, an aborted signal rejects, and integrity
stops a request it cannot verify. That last one stops it with a *descriptive* TypeError
rather than an opaque network error, because a missing digest provider is a
configuration mistake rather than a network outcome — while a digest that is computed
and does not match is a network error, opaque as Fetch requires. Both halves are now
asserted, in this suite and the integrity one.

Two sabotages, both restored, and both re-run after the recovery above because their
first run had been against a tree that did not compile. Making `keepalive` set a
`keep-alive` header was caught by the identical-bytes test. Giving `priority` a getter
was caught by the unexposed-field test.

The complete local Node-host/real-socket corpus passes 508/508 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable.

## The HTTP/2 half of early hints was already built and unreachable

`Http2ClientConnection.request` has accepted an `onInformational` callback all along,
and `Http2Transport` never passed one. The mechanism existed; nothing routed through
it. That is the third instance of that shape found in this lane during this session,
after `createInternalResponse` and the inert coalescing, and the first where the
unrouted mechanism was somebody else's rather than one I had just written.

Wiring it required deciding one difference. The connection **resets the stream** if its
callback throws, which is right for a provider defect: a broken callback inside the
protocol engine is a protocol problem. It is wrong for a caller merely observing, and
it contradicts the contract the HTTP/1 path documents — an exception is reported and
does not change the request. The adapter therefore catches the observer's exception and
reports it through the scheduler, so the connection never sees one and keeps its safety
net for the case it was written for.

Three tests against a real HTTP/2 server using node's `additionalHeaders`: two `103`
responses arriving in order with their `Link` fields before a `200`, an observer that
throws leaving both the stream and the response intact, and a request without an
observer behaving exactly as before. Pseudo-headers are asserted absent from what a
caller is handed — `:status` is protocol framing, not a hint, and it is already carried
as `status`.

Two sabotages, both restored. Not passing the observer through — the state this was
found in — was caught by two tests. Letting an observer exception reach the connection
was caught by the one that exists for it.

**A tooling note that belongs in the evidence rather than only in a habit.** Both
sabotages first ran against a tree that did not type-check, so the previous emit was
still in place and the tests reported green against the code the mutation was meant to
replace. That is a control that always agrees. Sabotages in this lane now run through a
wrapper that refuses when `tsc` has anything to say, and diagnostic isolation runs
through one that keys backups by full path and verifies the restore compiles — the two
failures that produced the corrupted commit recorded above.

The complete local Node-host/real-socket corpus passes 511/511 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green. The
NTS frontier is 1,303 primary `NTS1001` and 242 `NTS1003` both before and after: this
slice reaches no dependency the transport had not already reached.

## Trailers had consumers and no producer

`TransportResponse.trailers` is read by the diagnostics interceptor, the deduplication
layer, the bounded response collector, the retry layer and the snapshot recorder. No
real transport ever set it. HTTP/1 read the trailer section, validated it for forbidden
framing fields, and threw it away; HTTP/2 never surfaced one. The only thing producing
trailers anywhere in this lane was `MockAgent`, so every consumer's trailer handling
was exercised exclusively against a fixture.

That is the same shape as the inert coalescing and the unrouted HTTP/2 interim hook, in
its fourth variety: not a dead mechanism and not an unrouted one, but a field with a
whole population of careful consumers and nothing on the other end. It is the hardest
of the four to notice, because every individual piece of code reads as correct.

The HTTP/1 transport now settles a trailers promise on every ending. A chunked body
resolves with the parsed fields. A fixed-length or EOF-framed body, and a response with
no body at all, resolve empty — those framings cannot carry a trailer section, and
resolving is the difference between "there are none" and a promise nobody ever settles.
A body that fails or is cancelled rejects, so a caller awaiting trailers learns the body
failed rather than waiting for a section that is not coming. The promise is
rejection-ignored at the source, because nothing obliges a caller to await it and an
unobserved rejection must not escape.

Six tests: a chunked response delivering two trailer fields, trailers *not* settling
until the body has been read, both no-trailer framings resolving empty, the pre-existing
forbidden-framing-trailer refusal surviving, a truncated body rejecting, and a cancelled
body rejecting.

Three sabotages, all restored and all run through a wrapper that refuses when the
mutation does not type-check. Discarding the parsed fields again took the corpus from
6/6 to 4/6. Settling the promise when the response head is built rather than when the
body ends took it to 2/6. Leaving the trailers pending on a body failure took it to
4/6, and both failures were eight-second timeouts — which is what a promise nobody
settles looks like, and the reason resolving empty rather than leaving pending is a
decision worth making explicitly.

**One test caught a defect in its own harness first.** The truncated-body case timed
out because the fixture server wrote the response and left the socket open, so a
`content-length` shortfall was never observable — the reader was waiting for bytes that
were not coming. The server now ends the socket, and the comment says why, because
"the trailers never settled" and "the server never finished" look identical from the
assertion.

The complete local Node-host/real-socket corpus passes 517/517 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Not claimed: HTTP/2 trailers, which arrive as a second HEADERS frame and are already
collected by the connection but not surfaced on the transport response; that is the
same gap one protocol over and is now the known next piece.

Measured with the same pinned binary built at `43fda4d3`: 1,303 primary `NTS1001` and
242 `NTS1003` before and after, with zero `NTS1004`, zero `NTS4xxx` and no invalid HIR.
One message differs between the runs and it is the same message with a shifted type id.

## The same gap, one protocol over

`Http2ClientResponse.trailers` was fully implemented in the connection — parsed,
resolved, rejected on failure, guarded against unobserved rejection — and
`Http2Transport` never put it on the response it returned. Every consumer therefore saw
HTTP/2 as a transport that could not expose trailers at all, which is the shape the
contract reserves for a provider that genuinely cannot.

Surfacing it is a mapping from HPACK fields to the transport's name/value pairs, and
**that mapping is where it went wrong**. `.then()` makes a new promise, and the
connection's rejection guard covers only its own. The first version populated the field
and immediately broke two unrelated tests — a redirect case and an idle-deadline case —
because a rejected trailers promise nobody held escaped as an unhandled rejection. Both
pass again with a guard on the derived promise.

That guard then needed a test, because nothing exercised it: with the guard removed the
whole file passed. A promise nobody holds cannot be asserted on, so the test cancels an
HTTP/2 body mid-flight, awaits nothing, and relies on the runner treating an unhandled
rejection as a failure. Without the guard it fails; with it, it passes. It is the only
shape of assertion available for this property, and writing it was the difference
between a guard and a decoration — the same distinction recorded for the early-hints
header copy, resolved the other way because here it could be settled.

Three tests: trailers delivered after the body over a real HTTP/2 server using node's
`waitForTrailers`, a response without trailers settling empty rather than pending, and
the cancellation case above. Two sabotages, both restored: dropping the trailers again
took the corpus from 13/13 to 12/13, and removing the derived-promise guard fails the
cancellation test.

The complete local Node-host/real-socket corpus passes 520/520 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green.

Trailers are now produced by both real transports and by the mock, so the consumers
that have handled them all along — diagnostics, deduplication, the response collector,
retry, the snapshot recorder — are for the first time exercised against something other
than a fixture.

Measured with the same pinned binary built at `43fda4d3`: before, 1,303 primary
`NTS1001` and 242 `NTS1003`; after, 1,304 primary and 242 cascades, with zero
`NTS1004`, zero `NTS4xxx` and no invalid HIR.

## Demonstrating the claim the previous two entries made

Those entries said trailer consumers had only ever been exercised against `MockAgent`,
and that producing trailers from the real transports changed that. That was an
assertion about a consequence, not a measurement of one, and this session has spent
enough effort on exactly that distinction to not leave it standing.

The diagnostics interceptor now runs over a real HTTP/1 transport against a real server
sending a chunked body with a trailer section. It publishes one `response:trailers`
event carrying the real field, after the body, and it **redacts a credential that
arrives in a trailer**: a value does not become publishable by turning up after the
body rather than before it. The whole diagnostics suite had until now used inline fake
transports, so this path — parse, produce, observe, redact — had no end-to-end coverage
at any point along it.

The sabotage publishes trailers without redaction, and the test fails on the leaked
authorization value.

The complete local Node-host/real-socket corpus passes 521/521 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green, and
the NTS frontier is unchanged at 1,304 primary `NTS1001` and 242 `NTS1003`, as expected
for a slice that adds a test and changes no shared source.

## The durable-storage ABI, shaped by a device rather than by me

The plan's narrow durable-storage ABI is now defined, with a host filesystem
implementation. The shape was agreed with the JVM owner before anything was written,
and two of their answers changed it.

**They ran the capability check on a real API-26 device first**, which is now this
project's habit rather than anyone's caution: `Files.move(ATOMIC_MOVE)` over an existing
target, `renameTo`, `FileDescriptor.sync()` on the data file and `Os.fsync()` on the
*directory* all work at the declared floor, and `java.nio.file` is genuinely present
rather than merely declared. So atomic replace does not have to shape the ABI, which is
what I would have assumed it might.

**Streaming is asymmetric — write only — and their argument is better than either
option I proposed.** A whole-value `write(namespace, key, bytes)` cannot serve "spill to
disk so large payloads are not forced into RAM", because the bytes parameter *is* the
payload in RAM: the whole-value form contradicts the requirement it exists for. The read
side has no such problem, because `BlobExternalSource` already does ranged reads and a
second ranged-read seam in the store would be a second answer to one question. So there
is one handle type, for writing, and reading is whole-value plus the existing source.

**Commit is a handle operation, not a `begin`/`rollback` pair.** Temp-file-plus-rename
and a SQLite transaction are both expressible as one `commit`; ABI-level verbs would
force a filesystem provider to model a transaction it does not have and would let a
caller open one and never close it.

**Two things are stated in the contract that would otherwise be provider details.**
What a key holds after a crash mid-write — the old value or the new one, never a mix and
never absent — because that is what lets a caller reason about recovery without knowing
which provider it has. And that cancellation is cooperative and checked between chunks:
a blocking write cannot be interrupted mid-syscall on Android, and closing the
descriptor underneath one tears the file rather than stopping the write, so the honest
guarantee is *no partial value becomes visible* rather than *the write stops
immediately*. A provider promising promptness would have to lie.

Nine tests: whole and ranged reads, absent keys as null rather than errors, nothing
visible before commit, discard leaving the previous value and no partial behind,
cancellation leaving the previous value, a simulated crash where the handle is abandoned
and a reopened store sees the old value with the leftover partial invisible, records
carrying size and modification time with namespaces separate, keys encoded rather than
trusted as path segments, and a closed store refusing work.

The crash test asserts that it actually left a partial file before checking that the
partial is invisible, because a recovery test that never produced anything to recover
from proves nothing.

Three sabotages, all restored. Writing straight to the target instead of through a
temporary broke four tests at once — it is the single mechanism behind atomicity,
discard, cancellation and crash recovery. Never checking the signal between chunks broke
cancellation. Listing leftover partials as records broke two.

**One guarantee is deliberately untested and named as such.** The directory sync makes
the *rename* durable, separately from the data sync that makes the bytes durable, and no
test here can crash a machine to show the difference. It is implemented because the JVM
owner measured that both syncs are reachable at the floor, and recorded here as
reasoning rather than as evidence.

**This interface has no consumer yet, which is the thing this ledger keeps warning
about.** It exists because the implementer of the other side asked for a strawman to
build against and to converge on the `AbortSignal` spelling where the two seams meet.
That is a named reason with a named implementer, not the usual accident — but it is
still an unrouted mechanism until spill-to-disk or a persistent cache store consumes it,
and it should not be counted as either of those.

The complete local Node-host/real-socket corpus passes 530/530 with zero skipped. The
pinned upstream corpus is unchanged at 2,300 total, 2,286 applicable, 2,278 passing, 8
failing and 14 named not-applicable. The root TypeScript solution build is green. The NTS
frontier is unchanged at 1,304 primary `NTS1001` and 242 `NTS1003`: the ABI is
types-only and the implementation is host tooling outside the compiled project.

## The compiled axis, off zero

Every entry above this one is host evidence: TypeScript running on node, which says the
algorithms are right and nothing at all about whether they compile. This lane's
compiled axis was zero, and the whole-project frontier of 1,304 refusals made it easy
to treat that as a single blocked thing rather than a question with an answer.

It is not one thing. Three shared modules compile and execute today, on all three
backends, agreeing with the oracle on every generated case:

| Module | What it is |
|---|---|
| `http/certificate.ts` | dNSName matching, including the wildcard rules HTTP/2 coalescing depends on |
| `core/ascii.ts` | the whitespace predicate the integrity and header parsers tokenize with |
| `core/base64.ts` | Infra's forgiving base64, which integrity compares digests through |

`tooling/conformance/web-platform/compiled/` is a fixture over exactly those, and
`nts check` reports **54 cases across 5 functions, agreed on every case**, separately
for `jvm`, `c` and `llvm`. That is compiled-provider evidence for those functions on
those backends — the first in this lane.

The frontier is a measurement rather than a judgement about what matters. `fetch/headers`
declines at the backend after twelve refusals; `websocket/handshake` pulls the whole
runtime through its import graph and reaches 1,023. What compiles is what has no import
edge into the unlowered parts, which is why the list is short and why it should grow as
prerequisites land rather than by being rewritten to fit.

**A source mutation is not a valid control here**, and noticing that mattered more than
any sabotage would have. The differential runs the same TypeScript compiled and on the
oracle, so a change to the source changes both sides identically and they agree
regardless — the instrument detects *compiler* disagreement, not source defects. The
control that does work is removing an export: the count moves 54 across 5 functions to
49 across 4 and back, which is what proves the checker is exercising this fixture rather
than reporting a constant.

The step is separate from the host gate because it needs a compiler and the host gate
needs only node. `check.sh` runs it when one is present and **says so loudly when it is
not** — a step that disappears quietly is how an axis stays at zero without anyone
noticing, which is approximately what happened here.

`NTS_BIN` selects the compiler, and pinning a private copy is the point: three sessions
share this checkout and `target/release/nts` moves several times an hour, so a result
taken across it names no compiler at all.

The complete local Node-host/real-socket corpus passes 530/530 with zero skipped, the
pinned upstream corpus is unchanged at 2,278 of 2,286 applicable, and the whole-project
frontier is unchanged at 1,304 primary `NTS1001` and 242 `NTS1003` — this slice adds a
fixture and changes no shared source.

## Sequential per key means refused, not queued

The JVM owner built the provider half and asked three contract questions rather than
choosing and telling me. Answering them is what this slice is.

**A second concurrent write to a key that already has one is refused.** Their argument
decided it: the ABI is sequential per key, and honouring that by *waiting* would turn a
caller's mistake into a pause, with the pause as the only evidence it made one. A caller
that genuinely wants the later value serializes above this seam — where it can also
decide which value should win, which the store cannot know. It is in the interface doc
rather than left to providers, because a store that queued and one that refused would
both satisfy a contract that did not say.

**`list()` is one observation rather than a key list plus a lookup per key.** Two calls
cannot be made atomic, so a key created or removed between them makes the metadata
disagree with the names and the caller cannot tell which half is stale. That is now
stated on the method.

The host strawman implements the refusal, and three tests cover it: a second write
refused while the first is open with the first undisturbed, the key writable again once
that write settles, and — the one that matters for abandonment — **discard and cancel
both releasing the key**, since a write that locked its key on being abandoned would be
worse than one that queued.

Three sabotages, all restored. Allowing the concurrent second write breaks the refusal
test. Never releasing on discard breaks the abandonment test. Keying the guard on the
key alone, ignoring the namespace, breaks the concurrency test — but only after that
test was changed: it originally committed `cache/a` before opening `cookies/a`, so the
collision it was written to detect never happened, and the sabotage passed 12/12. The
two writes now overlap deliberately.

**The directory sync has evidence now, and it is not mine.** This ledger recorded it as
reasoning, because no test here can crash a machine. The JVM lane checked the *cause*
instead, with an `LD_PRELOAD` shim reporting the syscalls a commit makes: `fsync` on the
temporary, `rename`, `fsync` on the directory, in that order. It is not a power-cut
test and they say so. What it rules out is the change that silently removes the
guarantee — and they confirmed both removing the directory sync and *moving it before
the rename* fail it, **while the functional suite stays green through both**. That
asymmetry is the argument for the test, and it is the same shape as everything else this
session has turned up: the guarantee whose absence no ordinary assertion can see.

They also measured away a platform seam I would have accepted: syncing a directory
looked like it needed the Android SDK, and `FileChannel.open(dir, READ).force(true)`
works at API 26, checked on-device with `Os.fsync` as a control so a failure would have
been about the portable route rather than the directory. One SDK-free class, and the
desktop JVM suite becomes real evidence about Android rather than a proxy for it.

The complete local Node-host/real-socket corpus passes 533/533 with zero skipped, the
compiled axis holds at 54 cases across 5 functions agreeing on all three backends, the
pinned upstream corpus is unchanged at 2,278 of 2,286 applicable, and the whole-project
frontier is unchanged at 1,304 primary `NTS1001` and 242 `NTS1003`.

Still open on this ABI: `source()` is unimplemented on the Java side and should reuse
the existing `BlobExternalSource` shape rather than growing a second ranged reader; the
intrinsic surface is unbound and its names are being agreed before either lane binds
one; and the ABI still has no consumer, which remains the honest status.

## A question about clamping found a wrong answer in my own store

The JVM owner asked whether a ranged read past the end of a value should be clamped or
refused, noting that the size a caller was told may have been replaced since. Answering
it meant looking at what my own strawman did, and it was worse than either option.

`source()` stat'd the value's size at the moment it was called, and the reader opened
the file **lazily by path on its first read**. A commit between the two is a rename onto
that path, so the reader took the *replacement* while still reporting the original's
size — bytes from one value under the length of another. Not stale: wrong. And it
silently violated the guarantee Blob is built on, which is that composition and slicing
share *immutable* stored ranges.

The reader now opens eagerly and checks the pinned value against the size the source
described. A descriptor pins what it was opened over, so a later rename cannot change
what an open reader sees; and if the value was already replaced before the reader
opened, it **refuses** rather than clamping. That answers the original question, and the
reason is stronger than the one I would have given without finding this: a caller asked
for a range of *that* value, and a prefix of a different one is not a shorter answer to
the question — it is an answer to a different question, returned without saying so.

Three tests. The failing one first: a value replaced between `source()` and the first
read must either refuse or return the original, never a prefix of the replacement. Then
the positive counterpart, which is the actual guarantee — a reader that has begun
reading keeps seeing the original value across a replacement, all the way to the end.
Then reader independence, with two ranges over one source read **interleaved**, because
reading them one after the other would hide a shared file offset entirely.

Two sabotages, both restored. Accepting a replaced value instead of refusing fails the
first test. Using a shared file offset instead of positional reads fails the ranged read.

This was found by a peer's question about their implementation, not by a test of mine,
and every test in this file passed before it. The class is one this ledger keeps
recording: a guarantee whose absence nothing was asking about.

The complete local Node-host/real-socket corpus passes 536/536 with zero skipped, the
compiled axis holds at 54 cases across 5 functions on all three backends, and the pinned
upstream corpus is unchanged at 2,278 of 2,286 applicable.

## The adapter is generic over the flat surface, so it is written once

The JVM lane finished the provider half and said the adapter was mine: their side is
synchronous scalars, strings and one caller-owned view, because that is what a
foreign-function boundary can carry, and the promises, the `AbortSignal` checked between
chunks and the `DurableWrite` object all belong above it.

Writing that adapter *against their intrinsics* was the obvious move and the wrong one.
It would have put a module in shared source whose import edge is one backend, and it
would have been rewritten for the next provider — with the promise, cancellation and
handle-lifetime semantics reimplemented each time. Those are precisely the parts most
likely to differ subtly between platforms, and a difference there is invisible: two
stores that both pass their own tests can still disagree about whether an aborted write
releases its key.

So the shared side declares the flat surface as an interface — `FlatDurableStore`,
twelve synchronous functions — and `durableStoreFromFlat` adapts *any* of them. The JVM
binding becomes a value that names their intrinsics; the host could supply one; a future
C provider supplies one. The layer above is written once, here, and tested once.

The tests run against a fake provider rather than a real store, and that is the point
rather than a shortcut. Against a real store every assertion below could also be
answered by the store, so a green suite would not say which half was right.

Two behaviours in the adapter are not obvious and both have their own test. The
**fill-buffer retry**: `read` and `list` answer what there was and write what fits, so a
short first guess needs exactly one further call, sized by what the provider just
reported — a second guess would be a loop with no bound. And **per-read allocation** in
the ranged reader: `BlobExternalReader` transfers ownership of each chunk, so a consumer
may hold two at once, and a buffer reused across calls rewrites the older one. That
obligation is the shared side's, not the provider's, and it exists *because* the flat
surface is fill-buffer shaped.

The record encoding carries an explicit key length. A key may contain any byte,
including the NUL that separates fields, so delimiting the key by scanning would split a
legal key in two.

Six sabotages, all restored. Dropping the fill-buffer retry breaks the two
larger-than-the-buffer tests. Reusing one buffer across ranged reads breaks the
chunk-ownership test. Delimiting the key by scanning breaks the NUL-key test. Removing
the between-chunks signal check breaks cancellation; so does making `discard` refuse an
aborted signal, which is the cleanup path failing exactly when it is needed. Removing
the entry-point pre-checks did not type-check the first time — six now-unused parameters
— and `sabotage-run.sh` refused it rather than reporting green against a stale emit; the
retyped form breaks the already-aborted test.

One sabotage was answered by a test that was too weak, and the weakness is worth
recording because it looks like a strong test. The 400-record listing asserted only the
*count*, and the scanning parser still produced 400 records: losing its place in the
stream costs it one field per record, and it resynchronises, so it consumes exactly one
record per turn and reports 400 mangled ones. The assertion now checks the decoded keys
and sizes.

That near-miss came with a second one. The clean-tree rerun that was supposed to confirm
the strengthened assertion *failed*, and the reason was that the source had been restored
without rebuilding — so the run was against the sabotaged emit. It is the same stale-emit
defect `sabotage-run.sh` exists to refuse, reintroduced by stepping around it with a bare
`node --test`. Restoring is not a measurement; rebuilding after restoring is.

### The compiled axis had stopped running, and said nothing

`check.sh` runs the compiled axis last and prints a loud skip when no compiler is
present. It had not run since it was added. The upstream corpus sits above it and exits
nonzero while the eight named structural failures stand, and `set -e` made every step
after it unreachable — so the step written specifically so it could not disappear quietly
disappeared quietly, and the ledger's "54 cases across 5 functions" was carried forward
from a separate manual invocation each time. The upstream status is now held and
reported at the end, and the axis runs.

The axis is unchanged where it should be: 54 cases across 5 functions, agreeing on jvm,
c and llvm.

### What it costs at the frontier

Measured with one compiler pinned from the current tree, both sides of the slice: the
whole-project frontier moves from 1,251 to 1,256 primary `NTS1001` and from 283 to 284
`NTS1003`, with zero `NTS1004`, zero `NTS4xxx` and zero invalid HIR throughout. The one
refusal that names this slice's own shape is a `method declaration` in an object
literal — `durableStoreFromFlat` returns one — and the one new cascade is
`FlatDurableWrite#discard`, off the interface method it calls. Both are left standing;
neither is worth a workaround, and the object-literal form is the shape the seam wants.

Those totals are not comparable to the 1,304 and 242 recorded above. That pair was taken
with a different compiler, and the interface-resolution change landed in between; this
pair is the first taken with a binary built from the current tree.

The complete local Node-host/real-socket corpus passes 550/550 with zero skipped, and
the pinned upstream corpus is unchanged at 2,278 of 2,286 applicable.

## The byte store has a consumer

The durable ABI had a contract, a host strawman, an Android provider, an adapter and no
caller. That is the shape this ledger keeps recording as a defect in other people's
code — a mechanism nothing routes through is a mechanism whose shape nobody has checked
— and it had been true of this seam for four slices.

`DurableHttpCacheStore` is a persistent `HttpCacheStore` over it. RFC policy, matching
and eviction stay exactly where they are for the memory store; only the bytes cross the
provider boundary, which is the whole claim of the pairing — a filesystem cache and an
Android cache should differ in where bytes land and nowhere else.

**Metadata and body are separate keys, and the order they are written in is the crash
story.** The byte store makes one key's replacement atomic and says nothing about two, so
a publish commits the body first and the metadata second: an interrupted commit leaves
either nothing or a body no metadata names, never metadata naming a body that is not
there. Deleting runs the other way round. The split pays for itself twice — with the
body in its own key, `replaceMetadata` rewrites one small value and is atomic for free,
where a single-value layout would have had to rewrite the body to change a header.

That ordering claim was stated before anything exercised it, which is the same defect in
miniature. It has a test now: a store wrapper that fails the *second* commit, then a
reopen that must find the entry absent, the surviving entry intact, and no orphan left.
Reversing the two commits fails it — not because recovery breaks, but because the body
never reaches storage at all, which is a different and more visible failure.

Two properties of the metadata codec are load-bearing and each has a sabotage. Every
variable-length field carries its own byte length, because a header value may hold any
byte and a scan for the next separator would split one field into two. And times are
written as two 32-bit halves rather than round-tripped through a decimal string, because
wall-clock milliseconds do not fit in 32 bits.

Three things are stated as limits rather than fixed. The index is in memory and this
process is assumed to be the only writer — refusing a concurrent write to one key is not
the same as coordinating two openers, and the byte store offers nothing that would be.
Eviction order does not survive a restart, because persisting recency would mean a
durable write on every cache *hit*, which is a real cost paid for a heuristic; after a
restart entries fall back to commit order. And `open` reads every metadata record once,
bounded by the entry limit.

The suite runs twice, over the host filesystem and over a fake flat provider reached
through `durableStoreFromFlat`. The second run is what gives the adapter a real workload
rather than only its own unit tests, and a disagreement between the two runs would be a
disagreement between the two halves of the seam — which is exactly what neither half can
find alone.

Ten sabotages, all restored. Two of them survived first time, and both named a real gap
rather than a limit of the technique.

The **round-trip test decoded nothing**. `find` answers from the in-memory index, so
asserting on it in the writing process exercises the object that was handed in — the
metadata never went near the codec. Truncating times to 32 bits passed cleanly. The test
now reopens the store first, and the same sabotage fails it.

The **vary sabotage was a no-op**. Removing the length check from `equalVary` changes
nothing unless two variant lists differ in length while agreeing as far as the shorter
one goes, and no test had such a pair. There is one now — `accept-encoding` alone against
`accept-encoding` plus `accept-language` — and both the no-op form and an always-equal
form fail it.

### What it costs at the frontier

Same pinned compiler on both sides: 1,256 to 1,264 primary `NTS1001` and 284 to 293
`NTS1003`, with zero `NTS1004`, zero `NTS4xxx` and zero invalid HIR. The cascades name
the seam accurately — `DurableHttpCacheStore#_publish` off `DurableByteStore#write`,
`DurableHttpCacheBody#open` off `DurableByteStore#source`, `MetadataWriter#text` off
`TextEncoder#encode` — which is the honest picture: the store is refused because the
store it is built on is, not for reasons of its own.

One refusal category is new to this project's frontier: **`sort` on an array of
references**. It is the id ordering in `open`, and it is left standing.

The complete local Node-host/real-socket corpus passes 578/578 with zero skipped, the
compiled axis holds at 54 cases across 5 functions on jvm, c and llvm, and the pinned
upstream corpus is unchanged at 2,278 of 2,286 applicable.

## Spill to disk, which is the row the byte store was built for

`DurableSpillArea` reads a body to the end and holds it wherever it fits: under the
threshold it never touches the store, over it the bytes are written as they arrive and
the body is never assembled in memory at all. What comes back is a `Blob` either way,
and that is the claim worth testing hardest — a consumer of a spilled body must not be
able to tell, except by asking.

It is the byte store's second consumer and the first to use its ranged-read side, which
matters because that side had only ever been exercised by tests of itself. A spilled
Blob slices, and two slices of one body read concurrently, which is the property a
shared file offset would break and nothing else here would have noticed.

Spilled bytes deliberately do not survive the process that wrote them. `open` clears the
namespace: anything left in it belongs to a run that has ended and nothing can name it
again, so it is not data, it is a leak. That makes the namespace unshareable with a
store whose contents are meant to last, which is why it is a namespace rather than a key
prefix on someone else's.

`release` is on the returned handle rather than on the Blob because a Blob has no
disposal of its own. The alternative is a finalizer deciding when stored bytes go away,
and a cache of spilled bodies would then be at the mercy of when collection runs.

Nine sabotages, all restored. Two would not type-check in their first form — an unused
`abandon`, an unused binding after gutting `release` — and `sabotage-run.sh` refused
both rather than reporting green against a stale emit; the retyped forms fail. Dropping
the pre-threshold bytes at the crossing, assembling the body and writing it in one
append, never clearing the namespace at open, allocating one key for every spill, and
skipping the initial signal check all fail their own tests.

Two of these are worth naming because the tests had to be built for them rather than
happening to catch them.

**"Streamed" was a comment until something counted.** The claim that a large body is
never assembled in memory is invisible from outside: the bytes come back either way.
The test now wraps the store and records the size of every append, so assembling the
body and writing it once fails on the maximum append size rather than on the content.

**An empty namespace is not proof that a write went away.** An uncommitted write is
invisible to `list` and still holds its key, so every failure test passed while the
abandoned write was never discarded — the cleanup was pinned only by the *stream*
cancellation it also does. The recorder now observes the discard itself, and removing it
fails.

One tidy-up went with this. The same in-memory `FlatDurableStore` had been copied into
three test files within two slices, which is how a fake stops being one fake: the copies
drift, and a suite passing against a drifted copy says nothing about the seam the others
exercise. There is one now, in `test/fake-flat.mjs`.

### What it costs at the frontier

Same pinned compiler on both sides: 1,264 to 1,267 primary `NTS1001` and 293 to 296
`NTS1003`, with zero `NTS1004`, zero `NTS4xxx` and zero invalid HIR. No new refusal
category — every primary this adds is a kind already on the frontier. The cascades again
name the seam rather than the slice: `DurableSpillArea#clear` off `DurableByteStore#list`,
and the constructor off `AbortController#get signal`.

The complete local Node-host/real-socket corpus passes 602/602 with zero skipped, the
compiled axis holds at 54 cases across 5 functions on jvm, c and llvm, and the pinned
upstream corpus is unchanged at 2,278 of 2,286 applicable.

## A one-shot body becomes replayable only because somewhere was offered to hold it

The retry interceptor refused every streaming request body with
`UnreplayableRequestError`, which was correct and unhelpful in equal measure: a body it
cannot replay is a body it must not retry, and buffering an arbitrary upload to fix that
is a guess about memory the interceptor has no standing to make.

`RetryOptions.requestBodyStore` is the standing. A body is held only because a caller
supplied somewhere to hold it, and absent one the refusal is exactly what it was. The
spill area supplies the somewhere, so a small body stays in memory and a large one goes
to the byte store — the caller chooses *whether*, not *how big*.

It is also the spill area's first caller. Spilling had been a mechanism with no
consumer for one slice, which is the pattern this ledger keeps naming in other people's
work and had now produced twice in a row here.

The seam is two interfaces in `fetch/transport.ts` rather than a direct dependency,
because both ends need it and neither should import the other: a retry policy must not
know about storage, and storage must not know about dispatch. The adapter that joins
them lives in `dispatch`, which is the direction that composes — a policy may know about
storage; storage knowing about policy is how a byte store ends up carrying the
vocabulary of every consumer that ever wanted bytes.

Three decisions are visible in the tests because each could have gone the other way
silently. A body is held **before the first attempt**, since by the time a retry is
wanted the body has been sent and there is nothing left to hold. A body is **not** held
for a method the interceptor would never retry, or for a body that can already replay
itself. And `bodyLength` is carried over from the request rather than taken from the
held source, so a request that declared a length its body does not have is still an
error: correcting it here would turn a caller's inconsistency into a silent success.

### An ABI guarantee that was true, depended upon, and unwritten

Releasing the held body when the dispatch settles is only safe if a transport still
reading it keeps reading the original bytes. That rests on a property of the byte store
which both providers already had and neither had promised: **a reader keeps reading what
it was opened over, even after the key is deleted.**

The replacement half was already required — a Blob composes and slices immutable ranges,
and a reader that saw a replacement mid-read would break it. Deletion is the same
guarantee, and it is what makes a lifetime possible above the seam at all: without it
nothing can release stored bytes while anything might still be reading them, and every
caller ends up either leaking or guessing.

It is on `DurableByteStore.source` now, with a test on both providers. The test was not
free: written against the host store it failed first time on a range one byte short of
the string, which is the sort of failure that would have read as "the property does not
hold" to anyone less suspicious. Reverting the host reader to reopen by path on every
read fails it, so it is not vacuous.

The JVM lane owns the third provider and now owes this too. Told, rather than assumed.

Five sabotages for the wiring, all restored: never releasing, holding for an ineligible
method, holding a body that can already replay itself, taking the length from the held
source, and returning one stream from every `open()` instead of a fresh one.

### What it costs at the frontier

Same pinned compiler on both sides: 1,267 to 1,269 primary `NTS1001` and 296 to 297
`NTS1003`, zero `NTS1004`, zero `NTS4xxx`, zero invalid HIR, no new refusal category.

The complete local Node-host/real-socket corpus passes 612/612 with zero skipped, the
compiled axis holds at 54 cases across 5 functions on jvm, c and llvm, and the pinned
upstream corpus is unchanged at 2,278 of 2,286 applicable.

## The Cache API over provider-owned durable storage

The plan asks for "a separate `Cache`/`CacheStorage` API with provider-owned durable
storage", and the memory store's own comment already said production providers should
inject a durable one. `DurableCacheStorageStore` is that store.

The name map is one key and each cache's entry list is one key, so both are replaced
atomically by construction: `compareExchange` is a read, a revision comparison and a
single-key write, and there is no window in which half a list is visible. Bodies are
separate keys, written before the list that names them and deleted after the list that
stopped naming them — the same ordering as the HTTP cache store, for the same reason.

**`read` returns the same `Blob` for the same stored body every time**, and that is not
a cache for speed. It is what makes a caller's round trip cheap: the API above reads a
list, changes one entry and exchanges it back, and every unchanged entry arrives holding
a Blob this store handed out. Recognising it is the difference between rewriting every
body on every put and rewriting none of them. A Blob that arrives fresh is new by
definition and is stored.

It is driven two ways. Directly, where the store's own contract lives — revisions,
handle ownership, body lifetime — and through the real `Cache` and `CacheStorage`
objects, because a store that satisfies its interface and cannot serve the API above it
has only passed a test of itself. That second path also checks the thing the whole slice
is for: a second `open` of the same bytes finds what the first one put there.

### A duplicated vocabulary that cannot rot

The codec has to duplicate eight unions that are declared as types elsewhere, because a
type is not a value. The failure mode if one drifts is bad and quiet: a member added to
`RequestDestination` writes fine, fails to decode, and takes its **whole list** with it,
because an entry that cannot be read makes the list unreadable.

So each array carries a `Covers<Union, (typeof array)[number]>` alias, and each alias is
the type argument of the `oneOf` that reads that field — checked where it is relied
upon, rather than in a block of assertions off to one side. Deleting `"xslt"` from the
array is a compile error naming `"xslt"`. The first form of this did not survive: eight
aliases declared and never used are eight `TS6196` errors, and a check the compiler
deletes is not a check.

Eight sabotages, all restored: not comparing the revision, writing the list before its
bodies, leaving unreferenced bodies, building a new Blob per read, not cleaning up a
body written before a failure, accepting a handle from another store, and dropping one
request field from the codec.

Three of those were answered by tests too weak to be evidence, and all three were weak
the same way — **the sabotage was unreachable from the case the test set up.**

The quota test could not reach the cleanup path at all: the entry-count limit refuses a
two-entry exchange before any body is written, so a one-entry oversize body throws
before storing and there was no written body to clean up. The cleanup is reachable from
the interrupted exchange instead, and that test now asserts on storage **before** the
reopen, because reclamation at `open` would otherwise hide a failed exchange that left
its body behind.

The foreign-handle test passed for the wrong reason: the other store's handle named list
`0`, and this store had no list `0`, so removing the ownership check still produced an
error — just a different one. Both stores now allocate an id that collides, so accepting
the handle would read, and then write, somebody else's cache.

### What it costs at the frontier

Same pinned compiler on both sides: 1,269 to 1,279 primary `NTS1001` and 297 to 311
`NTS1003`, zero `NTS1004`, zero `NTS4xxx`, zero invalid HIR. The largest single-slice
movement this session, which a file this size should produce.

Two categories are new to this project's frontier. **A parameter of unrepresentable type
(an array of the type parameter `T`)** — that is `oneOf<T extends string>(allowed:
readonly T[])`, and it is the price of the vocabulary check being generic. And
**"`#appendBlob`, a declaration outside every walk"**, which is worth reading carefully
before believing: `#appendBlob` is called by `#storeBody`, which is called by
`compareExchange`, so it is reachable in the source. The reading that fits is that
nothing *compilable* reaches it, because the callers are refused — a consequence of the
cascade rather than a finding about this code. Left standing, and raised with the
compiler lane rather than worked around.

The complete local Node-host/real-socket corpus passes 636/636 with zero skipped, the
compiled axis holds at 54 cases across 5 functions on jvm, c and llvm, and the pinned
upstream corpus is unchanged at 2,278 of 2,286 applicable.

## The dispatcher operations, and the two that are deliberately missing

`DispatcherOperations` gives any `FetchTransport` the Undici-shaped `request`, `stream`
and `pipeline`. They are methods rather than exported functions because those are the
names the shape is known by, and three module exports called `request`, `stream` and
`pipeline` would be indefensible in a shared namespace — quite apart from what a backend
that resolves collisions by qualifying both names would make of them.

**This is not a parity claim, and the ledger should not be read as one.** No Undici
revision is pinned in this repository, so the API ledger the plan asks for cannot be
written honestly; that remains a dependency decision for the repository owner. What the
plan does require separately is the architecture and behaviour, and that is what is here
and tested. Nothing below says "the same as Undici"; it says what these do.

`connect` and `upgrade` are absent, and the absence is the finding rather than a gap to
fill quietly. Both must hand the caller a connection, and `FetchTransport` answers with
a response and no way to reach the socket underneath it. Adding one changes what every
transport in this lane promises, so it is a seam decision to be agreed rather than an
operation to write.

Three behaviours carry the weight. A status a caller would call a failure is still a
result, because deciding what a 404 means belongs to the caller and a dispatcher that
threw on it would put the body out of reach. The `stream` factory is called once, from
the head, before anything is written to what it returns — and if it throws, the response
is cancelled rather than left unread. And `pipeline` returns its stream before the
dispatch completes, so a dispatch failure surfaces on that stream rather than as a
rejected promise nobody is awaiting.

Six sabotages, all restored. One would not type-check in its first form and was refused.

Two tests were wrong before the code was, and both in the same way as the spill slice:
**an assertion about a stream that the stream itself already invalidated.** "A body past
`maxBytes` cancels the response" passed a two-chunk body that had already been buffered
and closed, and cancelling a closed stream is a no-op — so it asserted nothing. It uses
twenty chunks now, so the body is still producing when the limit trips. And "the factory
sees the head before any byte is read" could never hold: a stream fills its queue on
construction, so the body has been read from before any operation touches it. What this
operation controls is the *order* — destination chosen, then written to — and that is
what is asserted.

### The instrument was hiding a caught sabotage

One sabotage read as a survivor and was not. `sabotage-run.sh` piped its output through
`head -14`; this suite has fifteen tests and the sabotage broke the fifteenth, so the
only line that mattered was the one cut off. Run directly, it fails cleanly.

That is the wrong way round for a tool of this kind. A survivor is a claim that a test
is too weak, and the honest response to it is to go and weaken something else — so a
truncating instrument does not merely lose information, it actively argues for damage.
The `head` is gone, and passing lines are dropped instead, since a sabotage run is only
ever read for what broke.

The blast radius is bounded and worth stating: every other suite sabotaged this session
is split across two backends with the host block first, so the truncation cut the second
backend's repeat of results the first had already given. This suite is the only single
block long enough to lose a real one.

### What it costs at the frontier

Same pinned compiler on both sides: 1,279 to 1,285 primary `NTS1001` and 311 to 312
`NTS1003`, zero `NTS1004`, zero `NTS4xxx`, zero invalid HIR.

Two more **"a declaration outside every walk"**, and these sharpen the question the last
slice raised. One is `start`, an object-literal method, which is at least unsurprising.
The other is `pipeline` — a **public method of an exported class**, reachable from
outside the module by definition. Whatever that message means, it cannot mean what it
says about that one. Raised with the compiler lane; left standing.

The complete local Node-host/real-socket corpus passes 651/651 with zero skipped, the
compiled axis holds at 54 cases across 5 functions on jvm, c and llvm, and the pinned
upstream corpus is unchanged at 2,278 of 2,286 applicable.

## The seam the last slice refused to guess at

`connect` and `upgrade` were recorded as absent because `FetchTransport` answered with a
response and no way to reach the socket underneath, and that was called a seam decision
rather than an operation to write. This is the decision, made rather than deferred: a
request may set `acceptTunnel`, and a transport that can surrender its connection
returns it on `TransportResponse.connection`.

Fetch never sets it, so `101` remains an error there — the behaviour that was already
right stays exactly as it was, and the new path is reached only by asking.

**The bytes behind the head are the whole difficulty.** Parsing a response head reads
from a buffered reader, and that reader will happily have pulled bytes past the end of
the head — bytes which, after a switch, are the first thing the new protocol says. The
handed-over connection therefore reads through the reader rather than the socket. The
test writes the `101` and the tunnelled text in one packet, and the sabotage that reads
the socket directly does not fail an assertion: it **times out**, because those bytes
are not late, they are gone.

Three smaller decisions, each with its own test. A switch while the request body is
still uploading is refused, because handing over a connection with an upload still
writing into it interleaves HTTP bytes with the new protocol's. The lease is **detached**
rather than released: `release(false)` would close a socket that is very much alive, and
`release(true)` would offer a connection now speaking someone else's protocol to the
next HTTP request. And a server that declines gets to answer normally, body and all,
because being declined is a normal answer and its body is usually the explanation.

### A field that could only receive, never ask

The first version let a caller accept a switch and not request one. The transport
manages `Connection` and `Upgrade` as framing headers and rejects them from callers, so
an upgrade request could not be expressed — the seam could hear an answer to a question
it had no way to put.

This was found by the test using the real transport rather than a fake. A fake would
have accepted the headers and every assertion would have passed.

The fix is a field, `upgradeProtocol`, not a relaxation: framing coherence stays the
transport's job, and an upgrade is the one case where the caller must nonetheless name
something. It is validated as a token, and it requires `acceptTunnel` — asking a server
to switch with nowhere to put the switched connection is not a request worth sending.

And it is asserted **on the wire**. A field the transport reads and never sends would be
exactly the inert mechanism this ledger keeps recording: every other test in the file
would still have passed, because the raw server switches whether or not it was asked.

Six sabotages, all restored; one was refused for not type-checking and its retyped form
is the timeout above.

### What it costs at the frontier

Same pinned compiler as the previous slice, whose measurement is this one's before:
1,285 to 1,290 primary `NTS1001` and 312 to 313 `NTS1003`, zero `NTS1004`, zero
`NTS4xxx`, zero invalid HIR.

One new category: **a `get accessor` in an object literal**. That is `get closed()` on
the handed-over connection, which exists because `ByteConnection.closed` is a property
and the tunnel must report the underlying socket's rather than a copy taken once. Left
standing; the alternative is a snapshot that starts lying the moment the socket closes.

The complete local Node-host/real-socket corpus passes 663/663 with zero skipped, the
compiled axis holds at 54 cases across 5 functions on jvm, c and llvm, and the pinned
upstream corpus is unchanged at 2,278 of 2,286 applicable.

## The tunnel seam gets its consumer, and WebSocket gets the dispatch stack

The previous slice landed a seam whose only consumers were its own tests, which is the
shape this ledger keeps recording in other people's work and had now produced three
times running here. `DispatchedWebSocketTransport` is the consumer.

`RawWebSocketTransport` takes a `SocketConnector` and writes the upgrade request itself.
That is the right shape for the reference path, and it means a WebSocket gets none of
what the dispatch stack does — no proxy, no DNS cache, no connection accounting, no
interceptors — each of which would otherwise have to be reimplemented or done without.
The dispatched transport sends an ordinary request that asks to keep its connection, so
all of it applies to a WebSocket exactly as it does to a request.

Nothing else changes: the handshake validation, the framing engine and the session are
the same code either way. `adoptClientWebSocketSession` is the mirror of the server
adoption added for the server row, and exists for the same reason — masking is the only
asymmetry in the framing, so the engine takes a role rather than being written twice.

Two refusals are deliberate and each has a test. A response with no connection is an
error rather than an assumption: a WebSocket whose transport silently declined would
appear to connect and then read HTTP as frames. And a handshake that fails validation
closes the connection before throwing, because the connection became ours the moment it
was handed over and nothing else will close it.

The peer is the shared server pieces over a real socket, so both ends of one engine have
to agree — with the connection between them having been through a real HTTP transport
rather than a fake. Text and binary round-trip, and the subprotocol survives.

Five sabotages, all restored. Two would not type-check in their first forms and were
refused. Substituting a dead connection for a missing one, tolerating a failed
handshake, leaking the connection when validation fails, dropping the subprotocol offer,
and not naming the upgrade protocol all fail.

Two tests were wrong first, and neither was the code's fault. A server refusing an
unoffered subprotocol is not a refusal at all — selecting none is the correct answer to
an offer it cannot meet, and the client is entitled to proceed without one. That test
now uses a server that answers `426` instead, through the real transport, which is the
case worth having anyway. And an aborted session reports `close`, not `closed`; the
assertion was checking a spelling I had invented.

The echo server harness was extracted rather than copied into a second suite. Two suites
now need a real peer, and a test harness that exists twice is one that drifts — which
for a peer means two suites quietly stop testing the same thing.

### What it costs at the frontier

Same pinned compiler as the previous slice, whose measurement is this one's before:
1,290 to 1,292 primary `NTS1001` and 313 to 314 `NTS1003`, zero `NTS1004`, zero
`NTS4xxx`, zero invalid HIR, and no new refusal category — the only difference in the
message set is a type identifier renumbering.

The complete local Node-host/real-socket corpus passes 670/670 with zero skipped, the
compiled axis holds at 54 cases across 5 functions on jvm, c and llvm, and the pinned
upstream corpus is unchanged at 2,278 of 2,286 applicable.

### The capability the raw transport cannot have

Two tests were added to the dispatched transport, and neither changes any source — the
frontier is untouched, and the point of both is that nothing needed to change.

**A WebSocket reaches its origin through a CONNECT proxy.** The proxy is a
`ProxyAgent` with `proxyTunnel`, which is to say it is just a transport; nothing in the
WebSocket path knows a proxy is involved. `RawWebSocketTransport` cannot do this at any
price short of reimplementing proxying inside itself, because it opens its own socket.
The test runs a real CONNECT proxy that pipes to a real WebSocket server, and asserts
the proxy was asked for the origin — without that assertion a client that quietly
connected directly would pass.

**The public `WebSocket` API works over it.** A transport that satisfies
`WebSocketTransport` and cannot serve `createWebSocket` would have been a store that
passed only a test of itself, which is the mistake the durable cache slice recorded and
this one had every opportunity to repeat.

The default remains `RawWebSocketTransport`. Making the dispatched one the default is a
change to what every embedder gets, and it is worth making deliberately rather than as a
side effect of it now being possible — the reference path is also the one with the
fewest moving parts when something goes wrong.

The complete local corpus passes 672/672 with zero skipped.

## The unrouted-mechanism check is a gate now, not a habit

Four mechanisms nothing routed through have been found in this lane: a dead internal
factory, HTTP/2 coalescing that read an address the pooling layer never has, an
`onInformational` hook no caller passed, and `Request.integrity` accepted and enforced
nowhere. **None was found by looking.** Each surfaced by accident, usually as a sabotage
that stayed green — which means the habit of looking has a perfect record of failure.

`tooling/conformance/web-platform/unrouted.mjs` runs in `check.sh` and fails on any
exported name that is declared and then never mentioned again, anywhere: not by shared
source, not by the public barrels, not by any test. The allowlist carries a reason per
entry, and an allowed name that becomes referenced is *also* a failure, so the list
cannot quietly become where findings go to be forgotten.

The first version had the bug the JVM lane had described an hour earlier: **a check whose
corpus contains its own answer.** The allowlist names the very things being searched for,
and the tool scanned its own directory, so every allowed name was trivially "referenced".
It reported its own allowlist as stale, which is the only reason it was noticed. Its file
is excluded from its own corpus now, and planting a dead export fails the gate.

Eight names were declared and never mentioned again. Three were removed and five kept
with reasons.

**A second UTF-8 decoder.** `core/utf8.ts` says in its header that the codec's
"observable fallback semantics live here once", and then encoding lived there once while
decoding lived there *and* in `core/encoding.ts` — with only the latter called. Before
removing it, the two were run against each other on sixteen inputs, fifteen of them
malformed: truncated sequences, lone continuations, overlong forms, surrogates encoded
as three bytes, code points past the last one, and bytes that never appear in UTF-8.
They agreed on every one. The single difference was the BOM, which the used decoder
consumes and the codec does not — and that is exactly the WHATWG policy that should not
be at codec level. So the codec's decoder went, the header now says encoding only, and
the sixteen cases are a test of the decoder that survived, differentially against the
host. There is a `fatal` counterpart, because a fatal decoder that silently replaced
would be the worse of the two failures.

`bodyFromBytes` and `normalizeMethod` were superseded and went with it. Removing
`bodyFromBytes` exposed an import nothing else used, which is the usual shape of this:
dead code holds other dead code alive.

The five kept are the complete RFC 9113 error-code set — a partial enumeration invites a
magic number at the site that needs the missing one — and the named Streams operation
`writableStreamDefaultWriterClose`, whose sibling is what `pipeTo` uses; keeping both
named makes the difference legible rather than folklore.

### What it costs at the frontier

Same pinned compiler on both sides: primaries unchanged at 1,292, cascades **down** from
314 to 312, zero `NTS1004`, zero `NTS4xxx`, zero invalid HIR. The dead code was itself
only ever cascading, which is the tidiest possible confirmation that nothing was using
it.

The complete local corpus passes 674/674 with zero skipped, the compiled axis holds at
54 cases across 5 functions on jvm, c and llvm, and the pinned upstream corpus is
unchanged at 2,278 of 2,286 applicable.

## The check that was too small, and what it cost

The unrouted-export gate landed and immediately did real damage. It called `utf8Decode`
dead and it was removed; the Node lane re-exports it through
`runtime/node/internal/utf8.ts` for `Buffer.toString("utf8")`, and **thirteen of their
modules stopped type-checking.** They found it, not me, and they found it within the
hour.

The defect is the one this ledger has been circling all session, in its purest form yet.
The tool searched `runtime/web-platform/src` and `tooling/conformance/web-platform`. It
then reported, in the language of a general fact, an answer that was only true of that
subset: *"declared and never mentioned again"* actually meant *"never mentioned again
here"*. A corpus smaller than the set of possible callers does not answer the question
it appears to answer — and it is worse than no check, because a manual look would not
have carried the same authority.

It is also, precisely, the shape the JVM lane described earlier the same day and that
I had already reproduced once in this very file, when the allowlist sat inside the
corpus being searched. Twice, in one tool, in one day: **the corpus is the check.**

The corpus is now every `.ts`, `.mts`, `.cts`, `.mjs` and `.js` under `runtime`,
`tooling` and `examples` — 702 files rather than 60. Even within `tooling`, the original
scan had missed `tooling/conformance/audit.mjs`, which also names `utf8Decode`.

Build output is excluded, for the mirror reason. A stale `.d.ts` declares what the
source has dropped, so counting generated declarations as references would keep dead
exports alive by their own shadows. That is not hypothetical either: the Node lane's
aggregate typecheck reads this project through its built declarations, and those were
nearly two hours stale — so *their* gate reported green over the tree I had broken. Two
different checks, both confidently wrong about the same edit, for two different reasons,
in the same afternoon.

The control is the same input under both corpora: narrow, `utf8Decode` has no references
and is dead; wide, it has two real consumers and is live. Nothing about the code changed
between those two answers.

`utf8Decode` is restored, its header now says why it exists next to the WHATWG decoder —
`Buffer.toString("utf8")` must not consume a BOM, which is exactly the policy difference
measured when this started — and it records that it is consumed from outside this
directory. `bodyFromBytes` and `normalizeMethod` stay removed: under the wide corpus they
appear only in stale build output, which is not a reference.

Local corpus 674/674, upstream unchanged at 2,278 of 2,286, compiled axis 54 cases across
5 functions on jvm, c and llvm. The frontier is unchanged from before the removal.

## The compiled axis grows, and reaches something the compiler declines

The compiled axis is the only evidence in this lane that any of this actually runs, and
it had covered three modules since it left zero. `core/percent.ts` joins them:
`percentDecodeBytes` is now exercised as `percentDecodedLength`, and the axis is **55 of
59 cases across 6 functions, agreeing on jvm, c and llvm**.

The four remaining cases are the finding, and they are left visible rather than trimmed
away. The fixture's own header says it should grow as prerequisites land rather than by
being rewritten to fit, and a fixture edited until it passes is a fixture that has
stopped measuring anything.

**The source is not the problem, and that was established before blaming anything else.**
`percentDecodeBytes` was fuzzed on the host against an independent oracle over six
thousand inputs — percent triples, truncated triples, non-hex digits, astral characters
and lone surrogates — and agreed on every one.

That fuzz found a defect on the first run, in the oracle. Its lone-surrogate regex was
`[\uD800-\uDFFF](?![\uDC00-\uDFFF])`, which matches the **trailing** half of every valid
surrogate pair, so every astral character read as malformed and the function looked
wrong. The reported mismatches were all astral. A comparison is only as good as the side
you are not testing.

**A real inconsistency turned up on the way and is fixed, though it changed nothing.**
The shared source is authored under `tsconfig.base.json`, which sets
`noUncheckedIndexedAccess`; the compiled fixture extended `tsconfig.fixtures.json`,
which does not. So `bytes[index + 1]` typed as `number` rather than `number | undefined`,
the `=== undefined` guards the source depends on became statically impossible, and the
axis was compiling a subtly different program from the one the host runs. The option is
now set on the compiled fixture — not on the shared fixtures config, which every nts
fixture uses and which is not this lane's to decide. Turning it on did not change the
result by a single case, and saying so is the point: it was worth fixing because it was
wrong, not because it explained anything.

### A minimal reproduction, isolated with its own control

  export function pastTheEnd(length: number): number {
    const bytes = new Uint8Array(length & 7);
    const beyond = bytes[bytes.length];
    return beyond === undefined ? -1 : beyond;
  }

All 17 generated cases declined, on all three backends, and none was compared. The
control — the same shape with an index that is always in range — checks 29 cases and
agrees on every one, so the decline is the out-of-range read and not the surrounding
construct. The behaviour is identical with and without `noUncheckedIndexedAccess`, so
it is not the type-level option: node answers `undefined` for a read past the end, and
the compiled program stops.

The harness's own sentence is the one worth keeping: *a program that stops on every input
looks exactly like this*. Four declines inside fifty-nine passing cases is easy to read
as noise; the same defect alone is unmistakable, which is the argument for reducing
before reporting.

Raised with the compiler lane. Nothing here is worked around.

Local corpus 674/674, upstream unchanged at 2,278 of 2,286, whole-project frontier
unchanged at 1,292 primary `NTS1001` and 312 `NTS1003`.

### And then it more than doubled, for nothing

The axis is **138 of 142 cases across 13 functions**, agreeing on jvm, c and llvm. It
was 54 across 5 this morning.

Almost all of that came free, and the reason it was not free earlier is worth naming.
The frontier here has always been about *import edges* — a module either compiles or
pulls in the whole runtime — so once `core/ascii.ts` and `core/utf8.ts` are on the axis
at all, every remaining function in them costs a wrapper and nothing else. The fixture
had been exercising two of the seven ASCII predicates and none of the UTF-8 codec,
purely because those were the two the first slice happened to need.

Three whitespace definitions that differ by two characters each are exactly where a
transcription slip lives, and now all three are checked against the oracle rather than
one of them.

The addition worth having is `utf8RoundTrip`: encode with `utf8Write` into a buffer sized
by `utf8Length`, then decode. It is scalar-value normalisation with the codec doing the
work, and it is the most demanding string case on this axis — a lone surrogate must
become U+FFFD and a valid pair must survive, so a backend whose strings are not UTF-16
code units, or whose replacement differs, disagrees here rather than somewhere subtler.
All three agree.

The four declines are unchanged and still the percent-decoder's out-of-range reads.

Local corpus 674/674, upstream unchanged at 2,278 of 2,286.

### What the axis cannot reach yet, and why each one is blocked

Written down because the next person to grow it should not have to rediscover the map.
Every module in the shared source with at most one import was probed.

**`core/webidl.ts`** — the Web-IDL numeric conversions (`toUnsignedLong`,
`toEnforceRangeUnsignedLongLong`, the clamps) are pure number-to-number arithmetic and
would be the best possible material for this axis: modulo-2^32 wrapping, clamp
boundaries, and a 64-bit range check that must truncate before it compares. They are
blocked by `requireDictionary(value: unknown)` and `coerceToDOMString` in the same
module — `unknown` is unrepresentable, and a module is emitted whole. Splitting the file
would unblock it, and that is exactly the "rewritten to fit" this fixture is not allowed
to do; the numeric half stays off the axis until `unknown` parameters are representable
or something else changes on its own merits.

**`fetch/headers.ts`** — Web-IDL union and intersection parameter types. Three modules
sit behind it (`forms/mime.ts`, `cache/cache-control.ts`, `cookies/cookies.ts`), so it
is the single highest-value unblock available.

**`http2/hpack-huffman.ts`** — the most interesting one, and it fails in three different
ways at once. `core/errors.ts` uses `new Error(message, { cause })`, which is refused;
the decoder uses `new Uint8Array` from a value; and on the JVM backend specifically:

    not emitted: NTS4001 emitting %24 moved the operand stack from 0 to 1, and an
    operation must leave it as it found it -- the emitter and its own accounting
    disagree about this one (in `buildTree`)

and the same for `encodeHpackHuffman`. That is a different class from every other
refusal in this ledger: not "this construct is not supported yet" but the emitter
contradicting itself, and it is JVM-only — c and llvm produce no `NTS4xxx` here.

It resisted reduction. Two plausible constructs were ruled out with controls: a
conditional assignment into one of two arrays, and a post-increment inside the index of
an assignment target (`output[outputIndex++] = current`), which is the distinctive line
in both functions. Both compile and agree. Reported to the compiler lane with the file,
the two function names, and what has been eliminated, rather than a guess.

## A correction: the `NTS4xxx` zero is conditional on the `NTS1001` count

Every measurement in this ledger reports "zero `NTS4xxx`, zero invalid HIR", and this
session has quoted that as the number that has never moved. It is true, and it means
less than it reads.

Compiling `http2/hpack-huffman.ts` on its own produces two `NTS4001` refusals on the
JVM backend — the emitter disagreeing with its own operand-stack accounting, in
`buildTree` and `encodeHpackHuffman`. The whole-project run **reaches that module**:
`decodeHpackHuffman` appears in it, refused, with `readString` cascading off it. But it
is refused at the `NTS1001` level, and a function refused there never reaches the
emitter — so the backend defect behind it is invisible.

So the two counts are not independent measurements of two things. **A backend defect
sitting behind a language refusal cannot be seen until the language refusal is fixed.**
`NTS4xxx = 0` says "nothing that is currently emitted trips the backend", which is a
much weaker claim than "the backend is clean", and it will get harder to keep as the
primaries fall rather than easier.

This is the shape of thing the standing instruction to distrust lowering-only numbers is
about, and it applies to a number this ledger has been reporting all day. Every prior
"zero `NTS4xxx`" entry should be read with this attached; none of them is wrong, and all
of them are narrower than their wording.

The honest way to state the frontier from here is: *of the functions that reach the
backend*, none is refused by it. Which also means the compiled axis — where modules are
named directly and therefore do reach emission — is the only place these will surface
early. That is a second reason to grow it, beyond the one it was built for.

## The server's request reader was living in the test harness

`WebSocketServer.upgrade` takes a method and headers that somebody else has already
read, and shared source had no way to read them: `http1/parser.ts` had `readHead` for a
*response* and no mirror for a request. The only implementation of that in this
repository was ninety lines inside `test/websocket-echo-server.mjs` — the harness
standing in for the product, which means the tests were passing against a parser that no
embedder would get.

`readRequestHead` is that mirror. The harness now calls it, so the WebSocket server
suites exercise the shared parser against a real client rather than a private one.

**The target is returned exactly as it arrived.** Normalising it here would put a URL
policy inside a framing parser, and a server that routes on a normalised target while
logging the original is how the two come to disagree. Six shapes are asserted verbatim,
including `//a/../b`, `/%2e%2e/`, an absolute-form target and `*`.

Sabotage found three things, only one of which was a defect in the tests.

**Three fired as intended**: not checking the method is a token, not checking the
target's byte range, and an off-by-one in the target slice.

**One was unobservable, and that is a fact about the code.** Replacing `lastIndexOf(" ")`
with the second `indexOf(" ")` changes no test — and cannot, because a target may not
contain a space and the byte check refuses one that does, so the two accept exactly the
same request lines and differ only in which error a malformed one reports. The comment
had claimed `lastIndexOf` was load-bearing "because only the version is anchored at the
end", which is an assertion the tests do not support. The comment now says what is true.
A surviving sabotage is not always a weak test; sometimes it is a strong claim.

**One could not be written at all, and the refusal is the evidence.** `RequestHead.version`
is typed `"1.0" | "1.1"`, so the runtime check that narrows to it cannot be removed
without a type error at the return. Three attempts to weaken it were refused by `tsc`
before they ever ran. That is a better guarantee than a test, and worth noticing rather
than working around to manufacture a red run.

The test cases carry another small lesson. Two lists of malformed methods and targets
were written with the offending bytes typed literally, and they were **invisible in the
source**: one entry read as a perfectly ordinary `GET` that the parser appeared to be
rejecting wrongly, when in fact it carried a trailing byte outside the token set. They
are explicit ``-style escapes now, and the file is pure ASCII. A case nobody can
read is a case nobody can check — and the same trap caught this ledger entry while it
was being written.

Local corpus 683/683 with zero skipped, upstream unchanged at 2,278 of 2,286, compiled
axis 138 of 142 across 13 functions on all three backends. Frontier: primaries unchanged
at 1,292, cascades 312 to 313, zero `NTS1004` and zero invalid HIR.

## Origin authentication, which this lane had only for proxies

The plan asks for "authentication hooks with explicit ordering and ownership". This lane
had `ProxyAuthenticator` and nothing for the origin, so a `401` was simply returned to
the caller with no seam to answer it.

`AuthenticationInterceptor` is that seam, and it refuses `407` **in its constructor**.
Proxy credentials are not origin credentials, the proxy layer is the only thing that
knows which hop challenged, and an interceptor answering a `407` would send the origin's
credentials to a proxy. That is a `RangeError` at construction rather than a comment.

**Credentials are never sent before they are asked for.** The first request goes out as
the caller wrote it and only a challenge produces a second one. A preemptive
`Authorization` header goes to whoever answers the address, including whoever answers it
wrongly, and that is the whole difference between an authentication hook and a
credential leak.

**A one-shot body is refused rather than answered with an empty one.** Answering a
challenge with no body would show the server an authenticated request that is not the
one the caller made — worse than not answering at all. A body that can replay itself is
replayed, so the same `replayBody` seam the retry interceptor uses covers this too.

### The parser is the difficulty, and the grammar is why

A comma separates both challenges and auth-params, so the same character means two
things: `Basic realm="a", Bearer` is two challenges and `Digest realm="a", qop="auth"` is
one. Only lookahead distinguishes them — after a parameter, a comma followed by `token=`
continues the challenge and a comma followed by a bare token starts a new one — which is
why this is a reader with rewind rather than a split.

`token68` is worse, because it is decided by what *follows* it rather than by its own
characters: `realm` and `abc` are both valid token68 syntax, and only the `=` after
`realm` says which one it is. It is accepted just when the run reaches a comma or the
end. It is also kept separate from the parameters rather than folded in as a nameless
one, so an authenticator can tell `Negotiate abc==` from a parameter it does not know.

RFC 7235's own ambiguous example is a test, including the escaped quote inside a value.

A malformed tail ends parsing and keeps what was already understood. Refusing the whole
field would turn a server's sloppiness into a client that cannot authenticate at all.

The parser was wrong twice on first run and both tests caught it: a challenge that ran on
into the next one demanded a separating comma that had already been consumed, and the
token68 branch lost to the parameter branch because it was tried second.

Nine sabotages, all restored; two would not type-check in their first form and their
retyped versions fail.

### A recurring hazard, now on its third appearance

The test asserting that the challenge body is read before the connection carries the
answer was wrong the first time, in the same way as two earlier tests in this ledger: a
`ReadableStream` prefetches on construction with the default high-water mark, so a
counter in `pull` counts the stream's own eagerness rather than the consumer's read. It
reported the body as drained by a code path that never touched it.

The fix is `{ highWaterMark: 0 }`, so `pull` fires only when something actually reads.
Three times now this has invalidated an assertion about *who* read a stream, and the
pattern is worth stating plainly: **a stream's default eagerness makes "nothing has read
it yet" untestable.** Assert on order, or turn the eagerness off.

### What it costs at the frontier

Same pinned compiler on both sides: 1,292 to 1,294 primary `NTS1001` and 313 to 314
`NTS1003`, zero `NTS1004`, zero invalid HIR.

One new category: **an `await` of something that is not a promise**. That is
`await this.#authenticate(...)`, where an authenticator may answer synchronously or with
a promise — the same shape `ProxyAuthenticator` already has. Narrowing the contract to
promise-only would remove the refusal and would be a compiler-gap workaround; it stays.

Local corpus 701/701 with zero skipped, upstream unchanged at 2,278 of 2,286.

## Interceptor order, and a rule that was backwards until it was measured

The plan asks for "explicit ordering and ownership". Composition order was defined —
array order is outer to inner, with responses unwinding in reverse — but *which* order
to compose in was not written down anywhere, and an ordering rule nobody can falsify is
a preference wearing a rule's clothes.

Three constraints are now documented on `composeFetchTransport`, and each is a test that
runs **both** arrangements. A test that exercised only the recommended order would pass
just as happily if the order did not matter at all.

`ResponseErrorInterceptor` must be outside `RetryInterceptor`, because it throws on any
status at or above 400: from the inside it converts a retryable `503` into an exception
before retry has a status to act on. Swapped, the 503 is thrown and nothing is retried.

It must also be outside `AuthenticationInterceptor`, for the same reason with a sharper
edge: a `401` is a challenge, and thrown from the inside it becomes an error the
authenticator is never offered. Swapped, the authenticator is not consulted at all.

`DumpInterceptor` is not an ordering question but an exclusion. It returns `body: null`,
so anything outside it that needs a body — which is exactly `ResponseErrorInterceptor`,
whose error carries one — gets nothing. Compose one or the other.

### The third rule was written backwards, and the test is what said so

The documentation first claimed `RetryInterceptor` should be **outside**
`AuthenticationInterceptor`, reasoning that a challenge is best answered close to the
transport where it costs no retry budget. That is wrong, and the measurement is
unambiguous: on a script alternating retryable failures and challenges, retry-outside
costs five attempts and fails, authentication-outside costs four and succeeds.

The reason is that `401` is not a retryable status, so retry never loops on a challenge —
the interaction runs the other way. With retry on the outside, every retry of a
*retryable* failure re-runs the whole authentication exchange from unauthenticated. With
authentication outside, the credential is obtained once and retry re-sends a request that
already carries it.

The intuition was about which layer *sees* the challenge. The behaviour is about which
layer *repeats* the other. Those are different questions and I answered the wrong one.

This is the argument for testing both arrangements rather than the recommended one,
made by the practice catching its own author within a minute of the rule being written.
Had the test only exercised the documented order it would have passed, and the
documentation would have been confidently wrong in a file that other lanes read.

A fourth test is the control on the controls: with a transport *error* rather than a
status, retry and authentication do not interact at all, so the differences above have
to come from challenge handling rather than from composition overhead.

Nothing is claimed about `DiagnosticsInterceptor` or `DeduplicationInterceptor`. Both
have defensible positions, this lane has demonstrated neither, and saying so is more
useful than a preference dressed as a rule — which is precisely the failure mode the
third constraint just walked into.

Local corpus 705/705 with zero skipped, upstream unchanged at 2,278 of 2,286, frontier
unchanged at 1,294 primary `NTS1001` and 314 `NTS1003`.

## Ninety-three more upstream tests, and the eight that were failing are now zero

The pinned upstream corpus had five of the Encoding standard's twenty-two `.any.js`
fixtures. Seventeen were sitting unpinned in Node's vendored WPT checkout, already local,
needing nothing but a blob hash in the manifest.

Seven were pinned — the ones that exercise UTF-8 and UTF-16 rather than the legacy
single-byte and ISO-2022 encodings, which this profile does not claim and which would
have been pinned only to watch them fail for a reason already known. The corpus is
**2,393 tests, 2,379 applicable**, up from 2,300 and 2,286.

The first run was the finding. Ninety-three new tests, **fifty-five passing and
thirty-eight failing**, and every single failure named `utf-16le`, `utf-16be` or
`utf-16`. Not one UTF-8 assertion failed anywhere in the seventeen new fixtures. The
decoder threw `RangeError` on any label but UTF-8, deliberately and with a comment
saying so.

That is a decision, not a defect — but it is one worth revisiting when the bill arrives
in the form of thirty-eight failing conformance tests, and the honest options were to
record a limitation or to remove it. Recording it would have meant a standing
thirty-eight-failure baseline that everyone downstream has to learn to ignore.

**So UTF-16 is implemented.** `utf-16le` and `utf-16be` decode, with the same streaming
discipline as the UTF-8 machine: a single byte with no partner and a lead surrogate with
no trail both survive a chunk boundary, and both are errors at the end of a
non-streaming decode. A decoder that dropped either would turn a truncated stream into a
shorter valid one, which is exactly the failure `fatal` exists to make visible.

`utf-16` is a label for UTF-16**LE**. That reads as a mistake and is not one: the
standard resolves the ambiguity in favour of little-endian, and a decoder that guessed
from a byte-order mark instead would disagree with every other implementation. It has
its own sabotage.

All thirty-eight now pass. The corpus is **2,371 of 2,379 applicable**, and the failures
are back to the same eight named structural ones this ledger has carried all along —
ninety-three tests added and the failure count unchanged.

### The corpus is the control

Four sabotages, and none of them needed a test of mine. The pinned upstream fixtures
are the control, which is stronger evidence than anything written here could be, because
they were written by people who had never seen this implementation:

- ignoring endianness and decoding everything little-endian: 8 failures become **21**;
- dropping an unpaired lead surrogate instead of reporting it: **10**;
- ignoring a truncated tail at the end of a non-streaming decode: **12**;
- mapping the `utf-16` label to big-endian, the intuitive-looking mistake: **9**.

Each restores to 8. A sabotage measured against somebody else's conformance suite is the
one kind that cannot be accused of testing what the author happened to think of.

The BOM behaviour that mattered earlier today — `Buffer.toString("utf8")` must not
consume a leading BOM, and the WHATWG decoder must — is now covered upstream too, by
`textdecoder-byte-order-marks` and `textdecoder-ignorebom` rather than only by this
lane's own reasoning.

Local corpus 705/705, compiled axis 138 of 142 across 13 functions on all three
backends, frontier unchanged at 1,294 primary `NTS1001` and 314 `NTS1003` with zero
`NTS1004` and zero invalid HIR.

## Forty more upstream tests, and three things they found

The same survey that grew the Encoding corpus was run across every pinned subset: how
many `.any.js` fixtures exist in Node's vendored checkout against how many are pinned.
Seven more were pinned, chosen for being in areas this lane implements rather than for
being likely to pass — `Blob.stream()`, `AbortSignal.any`, three `dom/events` fixtures
and two streams crashtests.

Thirty-five of the forty new assertions passed immediately. The other five are the
point of the exercise, and they are three separate findings plus one profile boundary.

### `isTrusted` was a prototype getter and had to be an own one

`Event.isTrusted` is `[LegacyUnforgeable]`: an own, non-configurable accessor on every
instance rather than one on the prototype, so that a script cannot redefine or delete
the flag that says whether a script made the event. It was on the prototype, which
satisfies every ordinary use and fails
`Object.getOwnPropertyDescriptor(new Event("x"), "isTrusted")`.

The fix took two attempts and the second attempt is the interesting one. Defining the
accessor per instance with an arrow closure passes the first three assertions and fails
the fourth: **the getter must be the same function object for two different events.**
The descriptor is per-instance; the accessor behind it is not. There is one shared
static getter now, and the fixture passes.

### `Event.timeStamp` does not exist, and cannot without a decision

Two `Event-constructors` assertions fail on `assert_true(ev.timeStamp > 0)`. Everything
around them passes — `type`, `target`, `srcElement`, `currentTarget`, `eventPhase`,
`bubbles`, `cancelable`, `defaultPrevented`, `returnValue`, `isTrusted` — so this is one
missing member rather than a shaky implementation.

It is left failing on purpose. `timeStamp` is a `DOMHighResTimeStamp` relative to the
global's time origin, and **this profile has no clock**: `defaultNow()` in the retry
interceptor returns literal `0` and expects the caller to inject a real one, which is a
deliberate convention rather than an oversight. `new Event("x")` is constructible with no
runtime at all, so there is nowhere to inject one either.

`Date.now()` would satisfy the assertion most of the time and is the wrong answer twice
over: it is absolute epoch milliseconds rather than time since an origin, and an event
constructed in the same millisecond as the module loaded would report `0` and fail
intermittently. A flaky test bought with a semantic error is a bad trade.

So this is an ABI question — a monotonic clock primitive — and it is the second one this
lane has raised today. Recorded rather than papered over.

### `Blob.stream()` is not a byte stream

`Reading Blob.stream() with BYOB reader` fails with *A BYOB reader requires a byte
stream*. The specification says `Blob.stream()` returns one; this returns a default
stream, so `getReader({ mode: "byob" })` throws.

A real gap and a real fix, requiring both blob stream sources to become
`UnderlyingByteSource` with `autoAllocateChunkSize` and BYOB request handling. It is
named here and left failing rather than being quietly dropped from the corpus, which
would have been the easy way to keep this entry green.

### One boundary rather than a bug

`EventTarget-removeEventListener` has one assertion calling
`globalThis.removeEventListener`, which requires the global object itself to be an
`EventTarget`. That is true of `Window` and `Worker` and deliberately false here: this
profile installs no ambient globals, and installing one to pass a test is precisely the
shared process global the governing plan forbids. It is recorded in `notApplicable` with
that reason; the rest of the fixture runs against a constructed `EventTarget` and passes.

The corpus is **2,433 tests, 2,418 applicable, 2,407 passing, 11 failing** — the eight
long-standing structural failures plus the three named above. Local corpus 705/705,
compiled axis 138 of 142 across 13 functions, frontier unchanged at 1,294 primary
`NTS1001` and 314 `NTS1003`.

### And `Blob.stream()` is a byte stream now

The gap named in the previous entry is closed. Both blob stream sources are
`UnderlyingByteSource` with `type: "bytes"`, and the queuing strategy loses its `size`
function — a byte stream measures its queue in bytes, and the Streams standard makes
supplying one a `TypeError` rather than a redundancy.

Everything those sources enqueue was already a `Uint8Array`, so the change is almost
entirely in the types: what actually differs is that `getReader({ mode: "byob" })` is now
answered instead of refused, and BYOB reads are served from the queue by the byte-stream
machinery that the sixty-five pinned streams fixtures already exercise.

The sabotage is the whole claim in one line — hand the stream constructor a default
source again — and the BYOB assertion comes straight back: 2,408 passing becomes 2,407,
10 failures become 11.

The corpus is **2,433 tests, 2,418 applicable, 2,408 passing, 10 failing**: the eight
long-standing structural failures and the two `Event.timeStamp` assertions, which stay
open pending a clock primitive. Local corpus 705/705 with zero skipped, compiled axis
138 of 142 across 13 functions on all three backends.

## The largest open row: a WebSocket server that listens

The handshake existed, the server-side session existed, the connection lifetime owner
existed. What did not was a way to obtain a connection at all, because the provider ABI
had `connect` and no `listen` — so the row sat open behind an ABI addition rather than
behind code.

Both peer lanes answered before anything was written, and every decision they
contributed has a test.

**The JVM lane measured it on an API-26 device rather than reasoning about Android.**
`ServerSocket.bind` with port 0 works and reports the port it got; `accept` returns a
real connection; no permission beyond the `INTERNET` one a client already declares. So
`SocketBinder` is optional on **policy** grounds — a client SDK should not silently grow
the ability to listen — and explicitly not on capability grounds, which is a distinction
worth keeping because the two would be written the same way and mean different things.

**The Node lane corrected the contract, having written the adapter.** `net.Server` is
not pull-based: libuv accepts and node emits `'connection'` before any consumer is
consulted, so on that provider there are two queues and my "the OS backlog is the only
queue" was a false sentence about a real implementation. `backlog` now bounds
connections waiting for an accept **wherever the waiting happens**, and a provider that
cannot defer the OS accept may hold up to that many itself. One number, one meaning,
across providers.

They also settled three smaller things, each of which is a test: `close()` resolves a
waiting `accept` with `null` rather than rejecting, because a listener is a stream of
connections and its end should spell the same way as `ByteConnection.read` — which makes
`while ((c = await accept(signal)) !== null)` the correct loop instead of a `try`/`catch`
around every shutdown. An aborted signal **rejects**, and aborting one `accept` leaves
the listener open. And `BoundAddress.hostname` is the literal address bound, never the
name requested, because `listen({ hostname: "localhost" })` binds `::1` or `127.0.0.1`
and a caller echoing the name back can reach the other family.

`serveWebSocketUpgrades` is the loop, and it is deliberately not part of
`WebSocketServer`: listening and framing are separable, and an embedder that already has
a server wants the second without the first. **The loop is the backpressure** — it
accepts one connection at a time and does not ask for the next until the current one has
become a session or been refused, which is the only thing that makes a `backlog` mean
anything.

The end-to-end test drives the canonical client against it over a real socket:
handshake, subprotocol, a message each way, and the server counting the session it owns.

### Three of my tests could not have failed, in three different ways

Seven sabotages. One hangs the suite rather than failing an assertion — resolving
`listen()` on the call instead of on `'listening'` produces a listener bound to nothing,
and everything waits for ever. Informative, not a clean control, and recorded as such.

The other three survivors were all my tests being unable to distinguish the mutation:

**The bound-address test asked for `127.0.0.1`**, so the requested name and the literal
address were the same string and reporting either passed. It binds `localhost` now and
asserts the answer is *not* `localhost`.

**The "loop carries on" test used a plain HTTP request**, which the server refuses with a
status — a normal return, not a throw, so the loop's error path was never reached. It
now also sends a malformed request line, which is the case that actually throws.

**The aborted-signal test could not see the up-front check**, because subscribing to an
already-aborted signal fires immediately and rejects anyway. The two differ in exactly
one case: a listener that is *already closed* answers `null`, and abort has to win,
because abort is about this call rather than about the listener. That case is a test now,
and it is the only reason the check earns its place.

One bound is honestly untested: that the adapter destroys connections past `backlog`.
Provoking it means racing several clients against a listener that is not accepting, and a
timing-dependent test asserting a discard is worse than an admission.

Local corpus 714/714 with zero skipped, upstream unchanged at 2,408 of 2,418, compiled
axis 138 of 142 across 13 functions. Frontier 1,294 to 1,296 primary `NTS1001`, cascades
unchanged at 314, zero `NTS1004` and zero invalid HIR.

### How to read "agreed on every case"

The compiled axis reports agreement between a compiled program and node, on three
backends. The JVM lane found the case that qualifies what that sentence is worth, from
the other end of the same problem.

Their `examples/declared-wider` returns a two-field `Error` from a function declaring a
three-field `Tagged`, and the caller writes field two. The JVM verifier refuses it. The
pointer-cast backends write past the end of the allocation and **agree with node**.

So on that example, two of three backends report a pass on a program that is corrupting
memory, and the only reason anybody knows is that the third is strict enough to complain.
Stated generally: **agreement between a backend and the oracle is not evidence of
correctness when the backend cannot detect the error.** Three backends agreeing is
better than one; three agreeing while a fourth *refuses to compile it* is a different and
stronger signal, because there the refusal is the finding and the agreement is the noise.

This lane's axis has the same exposure. "138 of 142 cases, agreed on jvm, c and llvm"
means the three produced the same answers as node — not that none of them produced them
by accident. The four declined cases are the only place the axis currently says anything
a backend refused to do, and they are worth more per case than the 138 for exactly that
reason.

It pairs with the correction two entries above. A backend defect behind a *language*
refusal is invisible until the refusal is fixed; a backend defect behind a *permissive*
backend is invisible until a stricter one sees it. Both are the same shape: the
instrument's silence is a fact about the instrument.

## The clock is agreed and still blocked, on something smaller than expected

Both peer lanes answered the `MonotonicClock` proposal with device measurements, and the
contract they produced between them is better than the one I proposed.

**The JVM lane, on an API-26 device:** `System.nanoTime()` is non-decreasing over 200,000
reads with a 36ns smallest step, so sub-millisecond precision is not the constraint. Its
qualification is the important part — `CLOCK_MONOTONIC` **stalls** during deep sleep
rather than reversing, so *non-decreasing* is keepable and *measures elapsed real time*
is not. The stronger version would need `elapsedRealtimeNanos`, an Android SDK member,
which would make the interface unimplementable as one thing.

**The Node lane, on the host:** `performance.now()` is exactly this — milliseconds since
`performance.timeOrigin`, backed by `uv_hrtime`, so a system clock change cannot move it.
Not `process.hrtime.bigint()`, whose origin is documented as "an arbitrary time in the
past" and which would put a `BigInt` in an interface two other providers implement.

**And they corrected themselves before answering, which changed the contract.** They were
going to say a worker thread has its own time origin, because that is how a browser
behaves and what the specification asks for. Measured, Node's `performance.timeOrigin` is
**process-wide**: every worker shares the main thread's, differing by 0.000 ms. So the
contract must not promise per-realm origins *or* cross-thread comparability — the first
is the spec's shape, the second is an accident of one host, and writing either down would
make a correct provider look broken. What it should say is what a caller needs:
*milliseconds since an origin fixed for the lifetime of this provider; two values from
the same provider are comparable, values from different providers are not.*

### The blocker is not the clock

`Event.timeStamp` still cannot be implemented, and the reason turned out to be somewhere
else entirely. An `Event` would reach a clock through the environment slot — except
`currentWebPlatformRuntime()` **throws** when nothing is installed, and `new Event("x")`
in a bare context must not throw. The environment ABI has a read and no way to ask
whether there is anything to read.

A `try`/`catch` around the environment read would work today and is the wrong answer.
It puts a thrown exception in the constructor of the most-constructed object in the
platform, on the path taken whenever no runtime is installed — and performance is the
reason this project exists, so a design whose fallback is *throw and catch, every time*
is not one to reach for quietly.

So this is an environment-ABI question and it belongs to the compiler lane: a
non-throwing way to ask whether a runtime is installed. It is a smaller thing than the
clock, and until it exists, landing `MonotonicClock` on its own would put an interface in
shared source that nothing can route through — which is the defect this lane has spent
the day building a gate against.

The two `Event.timeStamp` assertions stay visible. The contract above is recorded so the
next attempt starts from two device measurements rather than from an argument.

## A peer's bug in their code found the other half of it in this one

The NodeJS lane reported three bugs in their own base64 and hex: they were decoding a
string's *characters* where node decodes its *bytes*, so every code unit above U+00FF was
silently skipped. Their `atob`/`btoa` came out identical to node across 44,225
comparisons; the three defects were on their side of the same confusion.

This codebase does not have their bug. `encodeByteString` **throws** on a code unit above
255 rather than masking it, which is the right half of the choice. It had the other half:
**the refusal escaped as the wrong error, from the wrong layer.**

`parseIntegrity` never validated the digest's character set. A digest is a base64 value
by grammar, but any non-whitespace run after `sha256-` was accepted, so a digest holding
a character above U+00FF reached `encodeByteString` at *match* time:

    new Request(url, { integrity: "sha256-Ā" })
    → TypeError: Expected an HTTP ByteString

`integrity` is a `DOMString` a script sets, so that is reachable from ordinary use. An
integrity check that should have reported a mismatch instead threw an exception naming an
HTTP byte-string requirement, from a layer below the one the caller was addressing.

The digest is validated at parse time now, which is where the Subresource Integrity
grammar puts it and what this parser already did for an unsupported algorithm. The
base64url alphabet and padding are accepted, because the match path already converts
`-` and `_`, and rejecting them would break every caller using that spelling.

**The consequence is security-relevant and is asserted rather than assumed.** Metadata
that parses to nothing means *no integrity check*, not a check that always fails —
`resolveIntegrity` returns null for an empty entry list and no verification runs. That is
the standard's behaviour and what browsers do, and it changes `"sha256-!!!!"` from
"always fails" to "not checked". A caller who wants invalid metadata to fail closed has
to validate before setting it. It has its own test, because a quiet loosening recorded
only in a commit message is how a security property gets lost.

Two sabotages: removing the character check restores the throw, and both new tests fail.

One test of mine was wrong before the code was. `"sha256-abc def"` was written as an
invalid digest and is not one — the grammar is whitespace-separated, so that is a valid
entry followed by a token with no dash. The parser was right and the case was removed.

Local corpus 717/717 with zero skipped, upstream unchanged at 2,408 of 2,418, frontier
unchanged at 1,296 primary `NTS1001` and 314 `NTS1003`.

### The same audit over every other path, and it was the only one

One fix is worth less than knowing it was the only one needed, so the shape was chased
across the whole lane: **a Web IDL `DOMString` field feeding a path that requires bytes.**

Every caller of `encodeByteString` was checked against where its input comes from. The
answer is a clean rule rather than a list. `Headers` coerces every name and value with
`coerceToByteString`, which refuses a code unit above 255 at the boundary, so everything
header-derived — the HTTP/1 head, HPACK values, the multipart boundary, the proxy
`CONNECT` line, the WebSocket handshake — is already bytes before it arrives.

`Request.integrity` was the **only** field on any of those paths declared
`coerceToDOMString`. The bug lived exactly where the Web IDL type said "any string" and
the consumer needed "bytes", which is not a coincidence and is the thing to look for
next time.

The two remaining `DOMString` fields that plausibly reach a byte path do not, and both
were probed rather than reasoned about:

`Blob.type` normalises. A type containing anything outside U+0020–U+007E becomes the
empty string, as the File API requires — measured with a high code unit and a control
character, both giving `""`. So a `Blob` cannot smuggle one into a `Content-Type` header.

WebSocket subprotocols are validated as HTTP tokens and a non-token throws a
`SyntaxError` at the constructor, so nothing above U+007F reaches
`Sec-WebSocket-Protocol`.

Cache names reach a `TextEncoder`, which encodes any string.

One instance, found, fixed, and the rest checked.

## The fuzz that proved a point and was thrown away

Establishing that `percentDecodeBytes` was sound before blaming a backend took six
thousand generated inputs against a hand-written oracle. They agreed on all of them, the
question was answered, and the fuzz went in a scratchpad — so the evidence lasted exactly
as long as the question did. The NodeJS lane made the same argument from the other side
today and moved their differentials inside their sweep; this is that argument applied
here.

`core/utf8.ts` is the right place to start, for a reason outside this lane. It is the
most depended-upon function here that is not part of the Web surface: `utf8Decode` is
re-exported for `Buffer.toString("utf8")` and thirteen of the NodeJS lane's modules stop
building without it. It was **nearly swapped** for the WHATWG decoder earlier today,
which would have changed their behaviour on any buffer beginning `EF BB BF` with every
test on both sides staying green, because the difference is invisible from this side.

So the codec is now compared against node's `Buffer` on every run: `utf8Length` against
`Buffer.byteLength`, `utf8Write` against `Buffer.from`, `utf8Decode` against
`Buffer.toString`, and a ranged decode against the same over a subarray. Twenty thousand
generated strings each — ASCII, Latin-1, the BMP, astral pairs and lone surrogates — plus
twenty thousand arbitrary byte sequences for the decode direction, where a decoder either
matches node's replacement behaviour or invents its own. Seventy-five thousand
comparisons in seventy milliseconds.

**The oracle is node's, not a reimplementation, and that is the point.** The
percent-decoding fuzz's hand-written oracle was wrong on its first run — its
lone-surrogate regex matched the trailing half of every valid pair — and reported the
function as broken. A comparison is only as good as the side nobody is testing.

`Buffer.toString("utf8")` is also the correct oracle for the decode direction where
`TextDecoder` is not: the WHATWG decoder consumes a leading BOM and this codec must not.
The distinction that nearly caused a silent break is the one the test is anchored on.

Three sabotages, all restored. Consuming a leading BOM on decode — the exact swap that
was nearly made — fails. Counting an astral code point as three bytes fails both the
length and the write comparison. Ignoring the `start` of a ranged decode fails, after its
first form was refused for not type-checking.

Local corpus 721/721 with zero skipped, upstream unchanged at 2,408 of 2,418.

## A differential against node, and node was the one that was wrong

`TextDecoder` is now compared against node's across the product of three encodings, the
`fatal` flag, the `ignoreBOM` flag and arbitrary streaming splits. The pinned WPT
fixtures cover the standard's cases; this covers the *combinations*, which no fixture
enumerates because the product is large and dull, and which is where an implementation
with correct pieces still gets the interaction wrong. UTF-16 landed today and is the
least-exercised code in this lane, which is why it went first.

It failed immediately, on two of the twelve combinations — `utf-8` streamed with
`ignoreBOM` false, fatal and not. **The divergence is real and node has it.**

    [0xEA, 0xEF, 0xBB, 0xBF, 0x41]

    decoded whole      node: U+FFFD U+FEFF U+0041     this: U+FFFD U+FEFF U+0041
    split 1 / 3 / 1    node: U+FFFD U+0041            this: U+FFFD U+FEFF U+0041

Node's two answers disagree **with each other** for the same bytes. A byte-order mark is
removed only when the stream *starts* with one; here the stream starts with a truncated
three-byte lead, so the `EF BB BF` that follows is U+FEFF and is data. Node's
whole-buffer answer says so and its streamed answer drops it.

So the streaming comparison lost its oracle, and rather than delete the case or accept
node's answer, the property changed: **a split must not be observable.** Streamed output
is compared against this decoder's own whole-buffer output for the same bytes. That is a
weaker oracle and a stronger statement — it catches every split-boundary defect without
borrowing anybody's opinion about the BOM, and the whole-buffer path still faces node.

The disagreement itself is a test now, written so it fails if node ever agrees with
itself, because a workaround whose reason has silently expired is worse than the bug.

### And it is worse than whole-versus-streamed

The NodeJS lane verified the finding and sharpened it, and the sharper form is what the
test pins, because the weaker one has a charitable reading that this removes.

    bytes: EA EF BB BF 41              node                    this
    whole                              U+FFFD U+FEFF U+0041    same
    split 1 / 1 / 1 / 1 / 1            U+FFFD U+FEFF U+0041    same
    split 4 / 1                        U+FFFD U+FEFF U+0041    same
    split 2 / 3                        U+FFFD U+FEFF U+0041    same
    split 1 / 2 / 2                    U+FFFD U+FEFF U+0041    same
    split 1 / 3 / 1                    U+FFFD U+0041           differs
    split 1 / 4                        U+FFFD U+0041           differs

**Node disagrees split-versus-split.** Two distinct answers for one byte sequence; this
decoder gives one. The table grew to nine splits over three passes by two lanes, each
verifying the last rather than accepting it — `1/4` and `1/2/2` turned up on checking the
report, `3/2` and `2/2/1` on checking that. `docs/records/0207` carries the full table and
what it cost to establish; this entry does not repeat it, because two copies of a table
are two things that can drift.

The trigger is precise: node drops the code point only when a **complete** `EF BB BF`
begins at the head of a decode call following a call that emitted nothing. Byte-at-a-time
is right because each chunk is incomplete and held; `2/3` and `1/2/2` are right because
the sequence straddles a boundary. There is no rule under which `1/1/1/1/1` and `4/1` are
correct and `1/3/1` is not, which is what closes off "streaming is allowed to differ".

`ignoreBOM: true` on the whole buffer gives the same answer as the default, which
confirms the whole-buffer path never classified those bytes as a byte-order mark at all.

This is the lesson from the percent-decoding fuzz arriving from the other direction. There
the oracle was a reimplementation and it was wrong on its first run. Here the oracle is a
mature independent implementation and it is *still* wrong, on one case, in a way visible
only because it contradicts itself. **A differential locates a disagreement; it never
says whose.** What settled it was a property neither implementation gets to vote on.

Three encodings, twelve combinations, seven thousand inputs each: 26 assertions across
84,000 comparisons. Local corpus 747/747 with zero skipped, upstream unchanged at 2,408
of 2,418.

## A retraction, verified the same way a claim would be

The NodeJS lane reported that the largest compiler blocker in this lane's streams was
nullable and optional properties — 305 sites — and asked whether any were nullable
*incidentally*. An afternoon went into answering that: all 166 nullable class fields
inspected by hand, split into nullable-to-release and nullable-as-a-domain-value, and a
design constraint handed back about what a boxing representation would cost.

They then built the fixture and retracted it. **A plain nullable property compiles.**

Verified here rather than accepted, because a retraction earns no more trust than a
claim:

    class Holder { slot: number | undefined = undefined; }         no refusal
    class Holder { slot: Marker | null = null; }                   no refusal
    class Holder { readonly slots: (number | undefined)[] = []; }  no refusal

Those three compile and agree with node on 34 generated cases. The `| null` in the
diagnostics is there because it is in the *type*: `PromiseWithResolvers<void>` and
`PromiseWithResolvers<void> | null` are one refusal, one of them wearing a union.

**One narrower claim survives, and it is the one that touches this code.** A
`T | undefined` where `T` is a type parameter genuinely refuses, and `Fifo<T>` has that
shape. Isolated: the three non-generic shapes alone produce nothing, the generic one
alone produces exactly `` `null` or `undefined` where what it stands in for is not a
reference ``.

### The instrument again, and the sharpest version of it yet

Their tool grouped diagnostics by message text with backticked types normalised away.
That merged two distinct causes under one name, and the group was then described by the
wrong one. Nothing about the numbers was wrong — 305 sites really do carry a `| null` in
their message — and the conclusion drawn from them was still false.

This is the fifth instrument in one day that reported confidently about the wrong object,
and it is the purest of them: no bug in the tool, no missing data, no stale cache. Only a
grouping key that discarded the distinction that mattered, and a name attached to the
group by the first thing that looked like an explanation.

**And it cost an afternoon of mine on the strength of a name.** That is worth recording
without blame attached — the same lane checked two of my findings today and made both
sharper, and I checked two of theirs and did the same. What separates this one is that
nobody built the fixture, on the single claim that was loudest. The rule their own
instructions carry, and mine should too: **a hundred-line fixture beats naming a
module**, and it beats it most when the naming feels obvious.

The engineering the afternoon produced is not wasted — `Fifo` clearing a dequeued slot
so the value is not retained is right whatever the compiler does with it, and the
distinction between nullable-to-release and nullable-as-a-domain-value is worth having.
It is simply not a compiler constraint, and the handoff no longer says it is.

### A correction: "outside every walk" was consistent and I called it inconsistent

Two entries above, this ledger says of `a declaration outside every walk`: *"The other is
`pipeline` — a public method of an exported class, reachable from outside the module by
definition. Whatever that message means, it cannot mean what it says about that one."*

That was too strong. A ten-line fixture, arrived at while verifying something else, makes
the coherent reading visible:

    class Slot<T> { value: T | undefined = undefined; }

    export function genericSlot(value: number): number {
      const holder = new Slot<number>();
      holder.value = value;
      return holder.value ?? -1;
    }

    refused: NTS1001 `null` or `undefined` where what it stands in for is not a reference
    refused: NTS1001 `genericSlot`, a declaration outside every walk

`genericSlot` is exported and is the only entry point in the program, and it is still
reported as outside every walk. So the walk is over what **survives lowering**, not over
what is reachable in the source — and `pipeline` fits that reading exactly: it returns a
`ReadableStream` built from an object literal whose `start` was refused, so it is itself a
cascade and drops out of the surviving graph for the same reason.

Two consistent instances, and this ledger called them inconsistent. The wording objection
stands on its own — a message that names a declaration in this source while describing a
property of the compiler's traversal has sent me hunting for a missing call site twice —
but the claim that no reading survived was wrong, and it was wrong in the direction of
making somebody else's diagnostic look more broken than it is.

## Prototyping the ask, and being corrected twice by it

The NodeJS lane reported a blocker as the compiler lane's, followed the symbol rather
than assuming, found it was theirs, hand-patched the one line and compiled it — and could
then say the ask was **sufficient** rather than merely necessary. The `Event.timeStamp`
ask had necessity and nothing more, so it was worth building rather than repeating.

It corrected the reasoning twice, in opposite directions.

**First: the `try`/`catch` objection was mine and was not the constraint.** The entry two
above says a guard around the environment read would put a thrown exception in the
constructor of the most-constructed object in the platform. There is an established
convention here that says otherwise — `File`'s constructor already calls
`currentWebPlatformRuntime().wallTimeMilliseconds()` **unguarded**, so
`new File([], "x")` with no runtime installed throws, and that is accepted. `Event` doing
the same would have been consistent, not a workaround.

**Second: implementing it that way broke 41 host tests.** `File` gets away with requiring
a runtime and `Event` does not, because `AbortController`, `AbortSignal` and
`EventTarget` are usable with no runtime installed and this lane's own suites rely on that
throughout. So the ask is necessary after all — for a reason that is a measurement rather
than the argument originally offered for it.

**Sufficiency got most of the way.** With a probe and
`this.eventTimeStamp = hasWebPlatformRuntime() ? …monotonicMilliseconds() : 0`, **both
`Event.timeStamp` WPT assertions pass** and the upstream corpus reads 2,410 of 2,418 with
the remaining eight being the long-standing structural failures. Host failures fall from
41 to 33, and 32 of those are `nts_environment_has_platform is not defined` — the
prototype's host shim is installed lazily, so a test constructing an `Event` before
importing the shim module never sees it. That is scaffolding rather than design, and it
was not closed, so this is recorded as incomplete rather than as a sufficiency claim.

One design question answered for free: **a separate clock interface is the wrong shape.**
`PlatformPrimitives` already carries `wallTimeMilliseconds()`, so the monotonic clock
belongs beside it as `monotonicMilliseconds()`. Two clocks on one interface, and the
mistake available is letting the monotonic one satisfy something that wanted the epoch —
a cache's "now" must be in the same frame as the `Date` headers it compares against.

Everything reverted; the two assertions stay visible. What the exercise bought is that
the next attempt starts from a working shape and a known scaffolding gap rather than from
an argument, and that the argument it would otherwise have started from was wrong.

## Sufficiency, demonstrated and then held back

The compiler lane landed `nts_environment_has_platform()` in `runtime/c/nts_runtime.{h,c}`
and the LLVM signatures, choosing `has` over `_or_null` for a reason worth repeating: the
existing read aborts before installation *so that* its declared return stays non-nullable
and bootstrap does not depend on how absence is represented. A nullable form would put
that dependency back.

With it, the prototype completes. `Event.timeStamp` reads the clock through the
environment when there is one and answers `0` when there is not:

- **local corpus 747/747**, zero failures;
- **upstream 2,410 of 2,418** — the two `Event.timeStamp` assertions pass and the eight
  remaining are the long-standing structural failures;
- **JVM frontier cost: one cascade.** 1,296 primaries unchanged, 314 to 315, no new
  refusal category, and `hasWebPlatformRuntime` is not itself refused — the constructor
  was already refused there for its own reasons, so one more call changes almost nothing.

### It is not landed, and the reason is the tree

`nts_environment_has_platform` is **uncommitted** — three modified files in the shared
worktree, still going through the compiler lane's gate. Committing shared source that
declares it would leave `HEAD` referencing an intrinsic that C and LLVM do not have if
that gate goes red or the change is reworked. So the shared half is reverted and waits
for the commit, and the exact shape is recorded above so applying it later is mechanical
rather than a rediscovery.

### What did land is the reason the demonstration could finish at all

The earlier attempt stopped at 33 host failures, 32 of them
`nts_environment_has_platform is not defined`, and that was scaffolding rather than
design: the environment intrinsics were defined inside `node-runtime.ts`, which is
evaluated when something imports it. That is late. A suite that imports the platform
barrel, builds an `AbortController`, and only then reaches for the host runtime was
constructing objects before the intrinsics existed.

They now live in `environment-shim.ts` and are **preloaded**, which is what the thing
being emulated actually does — an intrinsic exists before the first module runs.
`node-runtime.ts` imports the same module, so a direct importer that skips the preload
still gets them and there is one definition rather than two that drift.

The failure looked like a design problem for an afternoon. It was a load-order problem,
and the emulation not matching the shape of the thing it emulated is what hid it.

### One cost of the change, worth knowing before it lands

Adding a member to `WebPlatformRuntime` broke a hand-built stub runtime in
`core.test.mjs` — `{ scheduler: { … } }` with no clock — and broke it **at run time**,
because the test is `.mjs` and TypeScript never checked the stub against the interface it
is standing in for. One fixture here; an embedder would have their own. Interface growth
is not free in a suite whose fakes are untyped.

## `Event.timeStamp`, and the last named conformance gap closes

Both intrinsics are committed now — the compiler lane's `nts_environment_has_platform`
in the C runtime and LLVM signatures, and the JVM lane's op table, which turned out to be
missing **all eight** environment intrinsics rather than the one. That is why the cost
measured from outside was a single cascade: anything reaching the environment was already
dark on that backend, so adding one more call to an already-refused constructor could not
cost more.

So `Event.timeStamp` lands. Upstream goes from **2,408 to 2,410 of 2,418**, and the eight
that remain are the long-standing structural failures this ledger has carried throughout.

The frontier was re-baselined rather than compared across binaries, and the re-baselining
earned its keep: the same source measured **1,296 primaries on the old pinned binary and
1,299 on the new one**. The compiler moved. Against the new baseline this change costs
one cascade — 1,299 primaries unchanged, 314 to 315, zero `NTS4xxx`, zero invalid HIR.

### What the standard asks for, and what it does not

`timeStamp` is captured at construction and read through the environment **only when
there is one**. `AbortController`, `AbortSignal` and `EventTarget` are all usable with no
platform installed, and reading unguarded fails 41 of this lane's own tests — established
by doing it, not by arguing about it. `File` reads the clock unguarded for `lastModified`
and gets away with it because nobody builds a `File` without a platform; an `Event` is
built by code that has no idea.

The clock is `monotonicMilliseconds()` beside the `wallTimeMilliseconds()` that was
already on `PlatformPrimitives`, and the two must not be confused: a cache's "now" has to
be in the same frame as the `Date` headers it compares against. The contract says
non-decreasing and deliberately not "measures elapsed real time", because both providers
measured it on real hardware and both stall rather than reverse across a suspend —
`performance.now()` over `uv_hrtime` on the host, `System.nanoTime()` with 36 ns steps on
an API-26 device.

### Two of my own tests could not fail, and one of my instruments was bypassed

The upstream fixture asserts `timeStamp > 0`, which a **wall clock satisfies just as
well** — an epoch millisecond count is emphatically greater than zero. So this lane's own
suite asserts what WPT cannot: that the value is time since an origin rather than an
epoch, that it is captured once rather than read lazily, and that a later event is not
stamped earlier than an earlier one.

Then a sabotage returning a constant zero **passed that entire suite**. Captured-once,
non-decreasing and not-an-epoch are all true of zero, and only the upstream fixture
noticed. A file claiming to cover the semantics should not need the fixture to catch that,
and it asserts strictly positive now.

And the "no runtime installed" case passed for the wrong reason until it was moved to its
own file. The environment slot is process-global, so a suite that builds a runtime
installs one for everything after it — a no-runtime assertion sharing a file with a
runtime test is asserting nothing.

**The worst of the three was self-inflicted.** Two sabotages were run through an inline
runner written in the moment rather than through `sabotage-run.sh`, which refuses when
`tsc` has output. Both mutations failed to type-check, both ran against the *previous*
sabotage's emit, and both reported a failure belonging to a different mutation. The guard
against exactly this was built earlier the same day and then walked around, which is the
more instructive half: an instrument only helps on the runs it is actually used for.

### Held, then landed

None of this was committed while the intrinsic was uncommitted. The shared half sat
reverted through a full measurement cycle because declaring an intrinsic that `HEAD` does
not have would break C and LLVM if the other lane's gate went red. It landed the hour the
commit appeared, which is what the holding was for.

Local corpus 752/752 with zero skipped, compiled axis 138 of 142 across 13 functions on
all three backends.

## System proxies, and the interpreter that is deliberately not here

The Proxies row named one thing this lane had never built: "system/PAC proxy integration
where a mobile provider exposes it." What landed is the half that needs no agreement from
anybody, and the omission is the more interesting part.

**There is no PAC interpreter, and there should not be one.** A PAC file is a JavaScript
program — `FindProxyForURL(url, host)` returning a string — so evaluating one needs a
JavaScript engine. Every platform this project targets already has that engine wired to its
own proxy stack: Android resolves PAC inside `ProxySelector`, Apple inside
`CFNetworkCopyProxiesForURL`. Writing a second interpreter would ship a worse answer to a
question the host already answers, and would answer it *differently from every other
application on the same device*, which is the failure nobody would debug.

So the portable contract is "ask the host which proxy applies to this URL", and what comes
back is the classic result grammar. That grammar is identical whether a PAC file produced it
or a settings panel did, which is exactly why parsing it is shared source while producing it
is not. `parseProxyResult` and `SystemProxyPolicy` are that half; the provider primitive
behind the resolver is an ABI change and is not being made unilaterally.

### Where a plausible implementation would go wrong

There is no upstream fixture for any of this — WPT does not test proxies, because a
browser's proxy stack sits below everything WPT can observe. So the cases worth writing are
the ones where two reasonable implementations diverge.

**`SOCKS` means SOCKS4, and SOCKS4 is not SOCKS5.** Folding one into the other type-checks,
looks like support, and produces a connection that fails inside a handshake the peer never
agreed to speak. They are kept apart, and a SOCKS4 directive is reported as unusable.

That in turn forces a distinction the obvious return type cannot make: a host that answers
`SOCKS s:1080` and a host that answers nothing **both go direct**, and only one of them is a
configuration somebody expected to work. So the resolution carries the rejected directives
verbatim beside the usable routes, and a test asserts the two cases are distinguishable —
because a caller that cannot tell them apart cannot report the difference.

The rest of the pinned behaviour: one unusable directive does not take the usable ones
beside it down; a result that never says `DIRECT` still ends there, since a fallback list
that runs out would otherwise fail a request that going direct would have served; an
unbracketed IPv6 literal is refused, because `::1:8080` is a valid address as well as a host
and a port and there is no honest way to choose; and the bypass list is consulted **before**
the host is asked, asserted by counting resolver calls rather than by looking at the answer,
since checking afterwards gives the same routes while paying for a lookup on every request
to a bypassed origin.

Seventeen tests, green on the first run — which is the shape that usually means something
could not have failed, so all six sabotages were run before believing it. Every one was
caught, including the SOCKS4 fold, which takes down three tests rather than one.

### One compiler defect, found by writing ordinary code

The module costs three primary refusals and two cascades: 1,299/315 to 1,302/317 on a
binary pinned for both measurements. Two are shapes already refused elsewhere in this corpus
(an empty array literal with the annotation on the variable, ×6 before this; a module-scope
const whose initializer was refused, ×13). The third narrowed to something small and sharp.

A shorthand property whose value is a **narrowed nullable scalar** loses the narrowing. The
same program written the long way lowers cleanly:

    const port = decimalPort(text);          // number | null
    if (port === null) return null;
    return { hostname, port };               // refused: an erased value ...
    return { hostname, port: port };         // clean

Controlled per property, so it is not the object literal and not the narrowing on its own:
`{ hostname: hostname, port }` is refused and `{ hostname, port: port }` is clean. The
string shorthand survives because a nullable string is already a reference; only the scalar
loses it. TypeScript treats the two forms as the same program, and so should the lowering.

The shorthand stays. Rewriting it would be a compiler-gap workaround, and the refusal is
worth more visible than absent.

## The assertions that hold when every value is right

Written on the Node lane's suggestion, and their framing is the whole argument: they had
been asserting identities node's own tests have no reason to state — `querystring.decode ===
querystring.parse`, `path.posix.posix === path.posix` — all true, none asserted upstream,
and all of them structural properties **a compiled backend would lose while passing every
test it has**.

This lane has the same surfaces. `controller.signal`, `request.headers`, `response.body` and
an abort `reason` are all required to be *the same object* on every read, not an equal one,
and the repair that breaks them is the one that looks correct: an accessor that builds its
result per read returns something `deepEqual` cannot distinguish, satisfies every test
written in terms of contents, and silently breaks listener registration, stream locking, and
any `WeakMap` keyed on the object.

Eight assertions, and the one negative that keeps them honest — `clone()` must *not* share
the original's stream, which is the property clone exists to provide.

Three sabotages, all caught, and the useful detail is how far each reached. A controller
minting a fresh signal per read takes down the direct identity assertion **and** the derived
request that has to follow the original abort. A body accessor rebuilding an equivalent
stream takes down the locking observation **and** the clone test. Neither mutation changes a
single value anyone can read; both change which object holds it.

No shared source moved, so there is no frontier cost to report: this slice is entirely
evidence about behaviour that was already correct and previously unasserted.

## A cookie jar that survives the process, and two defects it found in itself

The Cookies row asks for "an optional persistent `CookieJar`" and only `MemoryCookieJarStore`
existed. `DurableCookieJarStore` closes it over the byte store the storage slice landed.

The module is small because the atomicity is **inherited rather than reimplemented**.
`CookieJarStore` is `loadAll`/`saveAll` over a whole snapshot and says a durable
implementation "atomically replaces the previous snapshot or rejects"; `DurableByteStore`
already promises a key holds the old value or the new one after a crash mid-write, never a
mix and never absent. That is the same guarantee, so the jar is one key. Per-cookie keys
would need a second mechanism to make the replacement atomic and the store already provides
exactly one.

### The decision that is not the round trip

What to do with bytes that come back wrong. `reject` is the default because a jar that
silently starts empty **is indistinguishable from a first run** — a user's session is gone,
nothing is red, and no caller can tell corruption from freshness. Dropping exists because
version skew is real and permanently bricking the jar is a bad answer to it, but it must be
asked for and it reports what it dropped; dropping unobservably is the failure the option
exists to avoid.

Decoding is fatal for the same reason. A corrupt byte repaired to U+FFFD produces a cookie
whose value is quietly *not* the one that was stored, and it would be sent to a server that
way.

### Two defects, and the second was found by the first being wrong

The suite failed on its first run, and the test that failed was built on a false premise. It
tried to force an encoding failure with a lone surrogate — but `JSON.stringify` escapes lone
surrogates to ASCII, so no failure occurred.

Chasing why exposed the real defect. `JSON.stringify` escapes control characters and lone
surrogates and **passes ordinary non-ASCII straight through**. A cookie value is an octet
string, so code units up to 0xFF are legitimate, and the ASCII-assuming encoder written on
that false premise would have refused a perfectly valid cookie. Replaced with the shared
`TextEncoder`, and the test replaced with the round trip that actually pins it.

The second was reported by the fix. A UTF-8 failure raised inside `decodeSnapshot` was
caught by the enclosing `JSON.parse` guard and re-reported as malformed JSON — sending a
reader to the wrong layer entirely, since the two failures have different causes and
different repairs. The decode now happens outside that guard.

Both were mine, in code written the same hour, and neither would have been visible from a
passing suite.

### The taxonomy gate did its job

Adding `CookieJarStoreError` failed `error-taxonomy.test.mjs`, which exists so that adding
an error class **forces the retry-and-routing decision rather than defaulting it**. It is
not a transport failure: a corrupt snapshot fails identically every time it is read, so
retrying spends attempts to reach the same answer, and letting it reduce an upstream's
health would blame a server for a local storage fault it never saw.

Six sabotages, all caught — and two of them were refused for a stale emit first, which is
the guard working where it was walked around earlier today. Run over both providers, the
host filesystem and the fake flat store through `durableStoreFromFlat`, so the adapter
carries a real workload and a disagreement between the runs would be a disagreement between
the two halves of the seam.

803/803 host, upstream unchanged at 2,410 of 2,418, frontier 1,302/317 to 1,305/319 on the
same pinned binary.

## The Web IDL surface, which nothing here had ever checked

Written after the Node lane reported finding twelve `process` functions and four `os` ones
published with no `.name` at all — node names every function it publishes, nothing upstream
asserts it, and a compiled backend would lose it while passing every test it has. The same
question asked here found the same class of defect.

WPT tests this through `idlharness`, which this corpus does not pin: it needs the IDL
definitions and a harness that parses them, which is a far larger dependency than a fixture
file. So the surface was unchecked, and it was wrong in two ways no behavioural test would
ever notice.

**Fourteen interfaces had no `@@toStringTag` at all**, so
`Object.prototype.toString.call(new Event("x"))` answered `[object Object]` where every
other implementation answers `[object Event]`. **Twenty-one more had it as a getter**, which
produces the right string and the wrong shape — Web IDL requires a *data* property,
non-writable, non-enumerable, configurable. The accessor is the obvious thing to write in a
class body, which is exactly why all twenty-one were written that way.

**And eleven constructors had the wrong `length`.** Web IDL defines it as the required-
argument count and it is observable: `Event.length` is 1 everywhere, and here it was 0.
These classes take `...args` tuples so that an omitted argument is distinguishable from an
explicit `undefined` — which Web IDL also requires, and which matters more than the arity —
so the tuple stays and the arity is declared. `Headers` was wrong in the other direction,
1 where the IDL says 0.

The oracle is the IDL text, not node. Node agrees on every interface it implements and that
agreement is worth having, but it is a cross-check: this lane has already found one place
where node's own answer was the wrong one, and a table copied from a running implementation
is a table chosen by whatever that implementation happens to do.

### Three spellings, all correct, and the frontier chose between them

The first version used a helper — one exported function so that thirty-five call sites could
not drift from the rule. It cost **42 primary refusals**, 1,305 to 1,347. Passing a class or
a prototype to a function is `a class used as a value`, which this compiler does not lower
yet.

Measured against the alternatives on a four-case control: a module-scope
`Object.defineProperty` costs one refusal per interface, the helper costs two, and a
`static {}` block costs **none** — because `this` inside it is not the class used as a value.

All three are equally spec-conformant, so choosing the cheapest is a choice between
spellings and not a way around a missing feature. The static block is also the better
placement: the declaration sits with the class rather than at the bottom of the file.

**What keeps thirty-five copies of a four-attribute descriptor honest** is the test, which
asserts the exact descriptor and the exact length for every interface from one table. That
table is the single source of truth the helper was going to be, and drift fails it.

The slice ends at **1,297 primaries — eight fewer than it started with**, because removing
the twenty-one accessors also removed the computed-member-name refusals they cost. Better
conformance and a smaller frontier, which is not the usual direction.

Four sabotages, all caught: a writable tag, a tag reverted to an accessor, a dropped length
declaration, and a tag added to an Undici-shaped class. That last one matters because the
suite asserts `Agent`, `Pool`, `RetryInterceptor`, `MockAgent` and `CookieJar` stay
**untagged** — they are not Web IDL interfaces and no implementation tags them, so a later
pass adding tags "for consistency" has to change that test and say why.

808/808 host, upstream unchanged at 2,410 of 2,418.

## Two deviations measured and pinned rather than fixed

Asking the Web IDL question properly turned up two more answers, both larger than the tags
and lengths that were fixed with them, and both left standing on purpose.

**Sixty-three internal methods are publicly reachable on interface prototypes.**
`AbortSignal.prototype.trigger`, `ReadableStream.prototype.markDisturbed`,
`Headers.prototype.makeImmutable` and sixty more. Web IDL says an interface prototype
carries the interface's members and nothing else; these are wiring between modules in this
runtime, public because they are ordinary methods.

**Every interface member is non-enumerable, and Web IDL requires them to be enumerable.**
Operations get `{ writable: true, enumerable: true, configurable: true }` and attribute
accessors `{ enumerable: true, configurable: true }`; ES class members are non-enumerable,
so all of them are. `for (const key in headers)` yields nothing where a conformant
implementation enumerates the prototype.

### Why neither was fixed in passing

The second cannot be fixed before the first. A blanket pass making prototype members
enumerable would enumerate the sixty-three internal ones too — **making one deviation worse
in order to improve the other**, and turning an invisible leak into a visible one. They have
to be closed in that order.

And the first is not a tidy-up. `#private` is not free here — the frontier already carries
refusals for properties of unrepresentable private type — so "make them private" is a
decision about compiler cost taken by someone who knows what that cost is. It is not mine
to spend quietly on sixty-three methods.

So the surface is written down instead, with the rule that **it may shrink and never grow**.
A new public method on an interface prototype fails the gate and has to be justified. The
second test catches the case the table cannot: a *new* deviation on an interface that is
currently clean, since a table of known offenders says nothing about the innocent.

The count is asserted as a literal `63` rather than derived from the table, so removing an
entry has to change that line too and cannot pass as a silent no-op. And the enumerability
deviation is asserted in the direction it currently holds, with the note that if that
assertion starts failing, the deviation is fixed and the test is what needs updating.

The oracle is node's prototype per interface, so the list is exactly "members this runtime
exposes that a conformant implementation does not". Interfaces node does not implement are
absent from the table for that reason and not because they are clean — stated because the
table would otherwise read as a complete census.

Both sabotages caught: a clean interface growing a method, and a listed interface growing
one beyond its list.

812/812 host, upstream unchanged at 2,410 of 2,418.

## Why the compiled axis is stuck at five modules

An attempt to grow the compiled axis failed, and failing located the reason it has been
stuck. Writing it down because the axis is the only evidence any of this *runs*, and the
constraint on it turned out not to be what the file's own header assumes.

Eighteen exported functions across the runtime take only scalars, return a scalar, and
carry no refusal of their own — the shape `nts check` can generate cases for. Adding them
took the axis from 13 functions to 31 and then broke it completely: **the backend declined
six functions and nothing ran at all.**

The header of `compiled/src/main.ts` says the limit is that modules "reachable only through
the wider import graph pull in the whole runtime and its 1,300 refusals". That is true and
it is not the binding constraint. `core/webidl.ts` **imports nothing at all** — a true leaf,
holding the seven Web IDL numeric conversions, which are the most demanding arithmetic
available on this axis: truncation toward zero, modulo 2^16 / 2^32 / 2^64 wrapping, and the
special cases for `NaN`, both infinities and negative zero. Exactly where a backend whose
narrowing saturates instead of wrapping would disagree.

It cannot be added either, because one unrelated function in it is declined.

### The narrowing that has no layout

    export function f(value: unknown): void {
      if (value !== undefined && value !== null) {
        throw new TypeError("no");
      }
    }

Excluding **both** nullish values narrows `unknown` to `{}`, the empty object type, which
has no layout. Controlled four ways, same file, same body, only the condition changing:

| condition | narrows to | result |
|---|---|---|
| `value !== undefined` | `{}` &#124; `null` | compiles |
| `value !== null` | `{}` &#124; `undefined` | compiles |
| `value !== undefined && value !== null` | `{}` | **declined** |
| `value !== null && value !== undefined` | `{}` | **declined** |

`NTS2006 an object type with no layout` on c and llvm, `NTS4001 a value of unrepresentable
type: an object` on jvm. This is `requireDictionary` in `core/webidl.ts`, and it is the
shape of every Web IDL dictionary check.

### The asymmetry is the part that matters

A frontend refusal is *recorded and survivable*: `NTS1001` marks one function undone and
everything else in the unit still compiles and still runs on this axis. A backend decline
is not — `nothing can be checked until they are removed or supported`. So a single function
of this shape in an otherwise-clean leaf module makes **the entire module unreachable**, and
there is no way to take the seven good functions without it.

That is why the axis has five modules rather than fifty, and it is a different problem from
the frontier count. Lowering more of the language raises the axis only if the last declining
function in each module is also lowered; until then a module is all-or-nothing.

**A correction, on the record because it nearly became the report.** The first isolation
concluded the trigger was an `unknown` parameter, "regardless of what the body does with
it". The control disproved it in one run: an `unknown` parameter with an empty body compiles
fine, and so does one that is compared against a single nullish value. The claim was formed
from two positive cases and no negative one — the same mistake this ledger has recorded in
three other lanes today, made here.

No source changed. The eighteen functions are not added, because adding them would report a
green axis of thirteen while silently declining the rest.

## `systemProxyFor`, and a hedge that became a reason

The proxy row's last piece. `PlatformPrimitives` gains `systemProxyFor(url): string | null`,
returning the classic result grammar that `parseProxyResult` already parses, and the
Proxies row closes.

Four questions went to the JVM lane, all four came back measured on an API-26 device, and
three of them turned assumptions into facts.

**Synchronous stays, and now says why.** `ProxySelector.getDefault().select(URI)` is 46–87 µs
on the first call of a cold process and 2–11 µs after, with no network, no file read and no
PAC fetch behind it. The signature was specified synchronous because a proxy lookup that
turned the event loop would reorder everything downstream of it; that was reasoning, and it
is now a number.

**Per-URL stops being a hedge.** With distinct `http.proxyHost` and `https.proxyHost`, the
selector answers differently for `http://example.com/a`, `https://other.example.org/b` and
`ftp://example.com/f`. Scheme-sensitive *and* host-sensitive, so the URL argument is
load-bearing on both axes rather than decoration for a global setting.

**Null is documented as unreachable on one provider.** An unconfigured Android selector
returns exactly one `Proxy.NO_PROXY` for every URL — never empty, never a throw — so the
`| null` arm cannot occur there. It stays for platforms with no proxy story at all, and the
declaration says so, because otherwise an always-`DIRECT` provider reads as a broken one.

### The answer that changed the code

The bypass list was applied on this side with the reasoning that "the two platforms disagree
about whether their own bypass rules are reflected, and applying a bypass twice is harmless
where trusting the wrong one is not." That was a hedge written without evidence.

The measurement removed the premise: Android *does* apply its own rules —
`http.nonProxyHosts` entries come back `DIRECT` for `localhost`, `127.0.0.1` and
`*.internal`. The hedge was wrong about the disagreement it was hedging against.

The double application stays, for a **better reason that only became visible once the hedge
was disproved**. `NoProxyMatcher` carries the *caller's* configured list, which is a
different set from the system's, which no provider can know about, and which has to be
honoured on every platform including ones with no system bypass list at all. So the comment
changed from "the platforms disagree, so hedge" to "these are two different lists, and the
second is applied here because nothing below can know it". Same code, and it now says
something true.

### What the host answers, and why it is not the environment variables

`createHostNodePrimitives` returns `null` for every URL by default. That is the honest
answer rather than a stub: **Node has no system proxy API.** What a Node process has is
`HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` — which `EnvironmentProxyPolicy` already reads,
and wiring them in here too would give one question two answers that could disagree. A
resolver can be injected for an embedder that has a real source, or for a test.

`systemProxyPolicy()` reads the environment **when a URL is resolved**, not when the policy
is built, so a policy can be constructed before a runtime exists and a provider whose
settings change mid-process is asked again rather than answered from a cache. A sabotage
capturing the runtime at construction is caught, and so is one that drops the URL argument.

### Two limits recorded, both volunteered by the lane that measured them

A bare `app_process` never receives the framework's copy of the global proxy into system
properties, so what was measured is `DefaultProxySelector`'s own behaviour with those
properties set directly — **not** that a device's global proxy setting reaches a real app.
And the account of Android resolving PAC inside a framework service that publishes an
ordinary `host:port` is documented behaviour, **not** device evidence; no PAC was configured.

Both are recorded with the boundary attached. A peer marking the edge of their own
measurement unprompted is worth more than the measurement, and this ledger has spent the
session on instruments that were reasonable and not about the object they appeared to
describe.

Frontier: **1,297 primaries unchanged**, 319 to 321 cascades. 814/814 host, upstream steady
at 2,410 of 2,418.

## The excuse was measured and it was wrong

The previous entry deferred privatising the sixty-three internal prototype methods, on the
grounds that "`#private` is not free here — the frontier already carries refusals for
properties of unrepresentable private type". That cited a real diagnostic and **misread
it**: the refusal is about a property's *type* being unrepresentable, not about privacy. A
real observation attached to the wrong claim, and it had been sitting in this ledger as a
reason not to do work.

Measured instead. Four `TextDecoder` members converted: **1,297/321 before, 1,297/321
after.** Free.

**And then not believed, because that is exactly what a patch doing nothing would print.**
Three preconditions had to hold before the zero meant anything: the occurrences really
`#`-prefixed in source, the emitted JavaScript really carrying `#` members, and the names
really gone from `TextDecoder.prototype`. All three checked. The first version of that
measurement had no verification in it at all, and "unchanged" had already been read as good
news.

### Sixty-three to forty-five, and where it stopped

Eighteen internal methods are now genuinely private: thirteen on `AbortSignal`, four on
`TextDecoder`, one on `Headers`. Zero frontier cost, 814/814 host, upstream unchanged.

Two files were attempted and reverted, and **the compiler was the oracle for both**:

`core/events.ts` — `initialize` and `applyConvertedEventInit` are called from *outside* the
`Event` class. A name-based scan said they were single-file and single-file is not
single-class; `#private` is per-class, and `tsc` said so immediately.

`streams/readable.ts` — several of those names are declared on an **interface**, where a
private identifier is not legal at all, and others cross between the stream and its byte
state.

Neither reverted file is a defeat worth hiding: they are the twenty-eight-ish that need a
different mechanism than privacy, which is what the remaining forty-five now means.

Along the way `?.#member` turned out to be illegal — an optional chain cannot carry a
private identifier — so four call sites became explicit checks. Behaviourally identical,
and the comment says why rather than leaving the next reader to rediscover the rule.

### What the peer lane's correction changed about the risk

The NodeJS lane cleared this change to land, then corrected its own scope claim twice: three
modules became four, and four became **twelve of twenty-two**, because `core/events.ts` is
upstream of nearly everything they own — `zlib` reaches it in three hops with no mention of
this runtime anywhere in `zlib`. They replaced recall with a tool that follows imports
transitively.

That correction arrived after `core/events.ts` had already been reverted for unrelated
reasons, so the landed change touches **`core/abort.ts`, `core/encoding.ts` and
`fetch/headers.ts`** and not the file with twelve modules behind it. The two module-level
helpers they actually depend on — `addInternalEventListener` and `addWeaklyHeldEventListener`
— live in `core/events.ts`, are exported functions rather than prototype methods, and are
untouched.

Worth recording because the risk was real and the reason it did not land is not foresight.
`tsc` refused the file that mattered, for a reason having nothing to do with the twelve
modules behind it.

## `TextDecoderStream` and `TextEncoderStream`, and what the frontier is actually counting

The Encoding standard's two transform streams were missing, which is why the eleven
`encoding/streams` fixtures had been sitting unpinned and reading as "out of profile". They
were out of profile because the classes did not exist, not because the area does not apply.

Upstream grows **2,433 to 2,547**, with 2,515 passing and the failure count back at the same
eight structural ones.

Neither class adds a codec. Both hold a `TransformStream` privately and forward `readable`
and `writable`, and the decoder is the existing `TextDecoder` with `stream: true` — so the
new fixtures test the existing codec through a new seam rather than a second implementation
of it.

**The genuinely new part is the encoder's surrogate handling**, and it is why
`TextEncoder.encode` cannot simply be called per chunk: `encode` performs USVString
conversion, which replaces a lone surrogate with U+FFFD *immediately*. A high surrogate at
the end of one chunk has to be held and joined with a low surrogate at the start of the next.
Encoding each chunk independently turns one astral character split across a boundary into two
replacement characters — and every value still round-trips for input that happens not to
straddle one, which is why it needs a fixture rather than a review.

### Two real defects the new fixtures found

**`TextDecoder.decode()` on a detached buffer threw.** Web IDL says getting a copy of a
detached buffer source yields an *empty byte sequence*, so a transferred `ArrayBuffer` must
decode to nothing. This threw `TypeError` from `new Uint8Array(detached)`. That is a bug in
the codec, not in the stream — found only because the stream fixture transfers a buffer, and
nothing in the existing corpus ever did.

**An `undefined` chunk decoded to the empty string instead of erroring the stream.**
`decode()` with no argument is *valid* and answers `""` — right for the codec, wrong for a
stream, where a chunk must be a buffer source. Every other bad chunk was already refused
inside `decode`; this one was not, because for the codec it is not bad. The stream refuses it
explicitly now.

Nine of the new tests are marked not applicable with a reason: they exercise `Shift_JIS`,
`ISO-2022-JP`, `ISO-8859-14`, `iso-8859-2` and `ascii`, and this profile implements UTF-8,
UTF-16LE and UTF-16BE only — declined by the decoder's constructor rather than decoded
incorrectly.

### The instrument selected nothing and reported it as clean

Five sabotages were run against `NTS_WEB_PLATFORM_FIXTURE=encoding/streams` and all five
came back with **zero failures and zero tests**. The filter was an exact path match, so an
area prefix selected nothing, and a run over no tests prints the same shape as a run where
nothing broke.

It is a prefix now, and it **exits non-zero when a filter selects nothing** — because the
only reason this was caught is that five consecutive sabotages surviving is implausible
enough to look at. Four would have been believable.

The guard was then written *below* the `process.exit` that ends the script, so it never ran;
the control that proved it fires was a filter matching nothing, checked before trusting it.
Re-run properly, all five sabotages are caught.

### What the frontier is counting, measured

The two classes moved the frontier **1,297 to 1,407**, which looked disproportionate for two
small classes. It is, and the reason is not the classes.

A control: **one additional `TransformStream<number, boolean>` — a single unused function,
one new instantiation with fresh type arguments — costs a further 180 primaries**, from
1,407 to 1,587. More than both real classes together.

So a refusal inside a generic is counted **once per instantiation**, and the frontier is
partly a measure of how many times an already-refused generic is instantiated rather than of
how much new code is refused. That belongs beside the earlier finding that three
spec-conformant spellings of one declaration cost 42, 35 and 0: **the count is a property of
the code as written, not only of what the compiler cannot do.**

The two instantiations here are the correct type arguments. Widening them to something
already instantiated would buy the number back and lose the type safety, which is the
workaround this lane does not make.

814/814 host, upstream 2,515 of 2,523 applicable, compiled axis unchanged at 138 of 142.

## idlharness runs, and it found seven things nothing else could

The handoff said `idlharness` was not pinned because it needs the IDL definitions and a
harness that parses them — a much larger dependency than a fixture file. That was true and
it was not a reason, because all of it is already sitting in Node's vendored checkout:
`resources/idlharness.js`, the `webidl2` parser, and `interfaces/*.idl`. The Web IDL
conformance suite was one harness change away the whole time.

It runs now: **51 of 55 for `encoding`**, with the four remaining marked not applicable for
a verified reason.

### Seven real defects, all invisible to every behavioural test

**Five brand checks.** Web IDL requires an attribute getter to throw `TypeError` when its
receiver is not an instance — reading `TextDecoder.prototype.encoding` must fail.
`TextEncoder.encoding` and `TextEncoderStream.encoding` returned a string literal and
answered for *any* receiver including `null`; `TextDecoder`'s three read TypeScript-private
fields, which compile to ordinary properties and check nothing. All five now read a **private
identifier**, which throws on a foreign receiver as a language guarantee rather than as a
hand-written check.

**One operation brand check.** `TextEncoder.encode` never touched `this` at all, so it
worked when called with `this = null`. It now begins with a private-member read that exists
solely to be that check, and says so.

**One wrong arity.** `encodeInto`'s IDL says two required arguments; the `...args` tuple that
keeps an omitted argument distinguishable from an explicit `undefined` reports zero.

**And the enumerability deviation is closed for four classes.** The previous entry recorded
that it could not be fixed before the internals were private, because a blanket pass would
enumerate those too. `TextDecoder`, `TextEncoder`, `TextDecoderStream` and `TextEncoderStream`
now have nothing non-standard left on their prototypes, so the fix is safe *there* and is
applied there only. That ordering was written down before it was possible and then followed.

### What it took, and the mismatch it exposed

`WebIDLParser.js` is a redirect in WPT proper and absent from Node's copy, so the alias to
the vendored parser lives in the runner. `idl_test` fetches the `.idl` files, so `fetch_spec`
is replaced with a read from pinned support rather than pointing a network stack at the
filesystem. `assert_inherits` was missing from this lane's deliberately-small harness — and
it is the assertion that distinguishes a property on the prototype from one moved onto the
instance, which is exactly the kind of difference this whole area is about.

Interface objects were injected into the sandbox as **enumerable** globals, so every
interface failed idlharness's first check for a reason belonging to the harness. Web IDL puts
them on the global non-enumerable; they are defined that way now.

**The real obstacle is a realm split, and it cannot be papered over in one direction.** The
harness runs in a `vm` context and the implementation lives in the host realm, so
`Object.prototype` is two different objects. Most fixtures compare against host-realm
implementation objects and need the host's injected. webidl2 walks its *own* objects'
prototype chains until it reaches `Object.prototype`, and with the host's injected that loop
runs off the end into `null`.

Removing the injection made idlharness work and **broke seventeen tests in five other
fixtures** — traded one realm problem for its mirror image. The choice is per fixture now and
stated in a comment, because a global answer is wrong for one side whichever way it goes. The
actual fix is for the harness and the implementation to share a realm, which is an
architectural change to this runner and not a line of code.

The four remaining failures are that mismatch and nothing else, and the claim was **checked
rather than assumed**: in the host realm `Object.getPrototypeOf(X.prototype) === Object.prototype`
is true for all four, and false only across the sandbox boundary. Marked not applicable with
that control written into the reason.

### Where this goes next

`streams/idlharness.any.js` and `FileAPI/idlharness.any.js` are pinnable the same way and
are deliberately **not** pinned yet. `ReadableStream` still carries seventeen internal
methods on its prototype, so they would produce a large red surface for a deviation already
measured and recorded. The order is the same one that worked here: privatise the internals,
then the enumerability fix becomes safe, then pin the harness that checks it.

Upstream is **2,602 tests, 2,566 passing, 8 failing** — the corpus grew by 169 today and the
failure count is the same eight structural ones it started at. 814/814 host, frontier
unchanged at 1,407/337.

## The harness has no name for what this runtime is

`FileAPI/idlharness.any.js` was pinned, run, and **unpinned again**, and the reason is worth
more than the fixture would have been.

It reports **`Blob interface should not exist`** and the same for `File`. Not that they are
wrong — that they should be *absent*.

idlharness decides what to expect by asking which global it is running in: a `Window`, one of
the three worker scopes, or — failing all of those — a plain realm, for which it tests only
`[Exposed=*]` interfaces. This runner answers "plain realm", which is the true statement: a
`vm` context with no `Window` and no worker scope.

`TextDecoder` is `[Exposed=*]`. **`Blob` and `File` are `[Exposed=(Window,Worker)]`.** So
`encoding/idlharness` passes not because the environment is classified correctly but because
its IDL is exposed everywhere and the classification never mattered. The first fixture whose
IDL is scoped, the answer becomes wrong in the strongest possible way: the harness asserts
that interfaces this profile deliberately provides must not be there.

**There is a one-line change that makes it pass, and taking it would be the mistake this
ledger keeps recording.** Declaring `DedicatedWorkerGlobalScope` in the sandbox and making
`self` an instance of it produces exactly the right expectation set — this profile's exposure
is essentially the Worker set. It is also a claim about the environment that is **not true**,
made by somebody who already knows what the oracle should say. That is the fourth item in
`docs/records/0207`, applied to myself: *an oracle acquired after a disagreement is an oracle
chosen while knowing what it should say*, and fabricating a global to make a harness agree is
the same move one step further along.

So the honest position: **idlharness's model of "which global am I" has no slot for a
server/mobile runtime that exposes the Worker set without being a Worker**, and every
idlharness fixture whose IDL is not `[Exposed=*]` is blocked on that. It is not a bug in the
harness and not a defect in the implementation. It is a question about what this profile
*claims to be*, which belongs to the governing plan and the repository owner rather than to a
lane that would answer it in whichever direction turns a fixture green.

`encoding/idlharness` stays, because its IDL is `[Exposed=*]` and the classification is
genuinely irrelevant to it. `interfaces/FileAPI.idl` and `interfaces/url.idl` were unpinned
with the fixture: support that nothing loads is an unrouted mechanism, which this lane gates
against elsewhere and should not exempt itself from.

Upstream steady at **2,602 tests, 2,566 passing, 8 failing**, 814/814 host.

## Symbol keys, proved on `Headers` before anyone tries it on streams

The previous entry named symbol-keyed members as the mechanism that closes both remaining
Web IDL deviations at once, and left it as a cross-module refactor not to be done in passing.
`Headers` is that refactor at a size where it can be checked: four internals, seven consuming
modules, and one test file.

**`Headers` now has nothing non-standard on its prototype, and its members are enumerable.**
It is the first interface in this runtime that is fully conformant on both counts.

One of the four never needed a symbol at all. `writable` was already TypeScript `private` and
called only from inside the class — it was on the prototype purely because TS `private`
compiles to an ordinary method and enforces nothing at runtime. That is the same fact that
made the brand checks free, seen from the other side: **`private` is a compile-time comment,
`#` is a runtime guarantee, and only one of them affects the shape a consumer sees.**

The other three — `raw`, `isImmutable`, `makeImmutable` — are genuinely cross-module and are
symbol-keyed now. `Object.getOwnPropertyNames` does not report symbols, so they leave the
enumerable surface entirely while staying reachable from the seven modules that need them,
and the keys are deliberately **not** re-exported from the public barrel: reachable inside
this runtime, invisible to a consumer.

### What the change cost, and what it proved

Frontier unchanged at 1,407/337. Upstream unchanged. Two host tests broke and **that was the
change working**: `core.test.mjs` reached `headers.raw()` directly, and a test is a consumer
like any other, so it now imports the key the same way the runtime does.

Two sabotages, and the more interesting one could not run. Dropping the enumerability pass is
caught. Renaming a symbol-keyed member back to a name is **refused by `tsc` at every call
site** — the type system prevents that regression outright, which is a stronger guarantee
than a test and is a property of the mechanism rather than of the discipline around it. So
the third sabotage asks the question that is still open: adding a *new* named method to
`Headers` is caught, by the assertion that a cleared interface exposes no non-standard names.

**The number that matters for whoever does streams**: 63 → 45 by privatisation, 45 → 41 here.
The remaining 41 are the ones needing this same treatment, and `ReadableStream`'s seventeen
are the bulk of it. A name-based scan counts 202 call sites across them, but that number is
**conflated and useless**: `enqueue`, `read` and `desiredSize` are legitimate Web IDL members
on controllers and readers as well as internals on the stream, and only a type-aware pass can
separate the two. Do not do that one with a regular expression.

814/814 host, upstream 2,602 tests with 2,566 passing and the same eight failures.

## `Request` and `Response` join them, and `protected` turns out to be the same story

One internal each, and it was the same shape a third time. `contentType` is `protected
abstract` on the shared `Body` base and overridden by both — and `protected`, like `private`,
is a compile-time notion that leaves an ordinary method on the prototype. Three access
modifiers now, three times the same lesson: **`private`, `protected` and `#` are not three
strengths of the same thing. Two are comments and one is a runtime guarantee, and only the
guarantee changes what a consumer sees.**

Symbol-keyed on the base, so one declaration covers both subclasses and the hook stays exactly
as reachable as it was.

`Request` and `Response` now carry nothing non-standard and their members are enumerable.
That makes **seven fully conformant interfaces** — `Headers`, `Request`, `Response`,
`TextDecoder`, `TextEncoder`, `TextDecoderStream`, `TextEncoderStream` — and takes the
non-standard prototype surface from 63 at the start of the day to **39**.

Frontier unchanged, upstream unchanged, 816/816 host.

The rest is `ReadableStream`'s seventeen, `EventTarget`'s seven, `Event`'s seven, `WebSocket`'s
six and `AbortSignal`'s two. The mechanism is settled and demonstrated three times; what is
left is the type-aware pass over the streams module that a name-based scan cannot do safely.

## `AbortSignal`, and the rename a regular expression cannot finish

The two remaining `AbortSignal` internals are symbol-keyed now, across fifteen modules and
five test files. `AbortSignal` carries nothing non-standard and its own members are
enumerable. **Eight fully conformant interfaces**, and the surface is 63 → **37**.

The keys live in `core/abort-brand.ts` rather than `core/abort.ts`, which is what that module
already exists for: naming this identity without an import cycle. `abort.ts` re-exports them
so consumers keep one import path.

### `tsc` found fourteen call sites and could not find the fifteenth

Converting `subscribe` to a symbol broke compilation in nine modules I had not touched, which
is the mechanism working exactly as intended — a rename that misses a call site is a type
error, not a silent behaviour change. Iterating on the compiler's output until it was quiet
took three passes and needed no judgement at all.

**Then a host test failed, and the reason is the limit of the whole approach.**

    "subscribe" in signal && typeof signal.subscribe === "function"

The `AbortSignal` duck-type check in `events.ts` names the member as a **string**. No
parenthesis, so the call-site pattern never matched it; and it is a *reflective* use, so the
type checker had nothing to complain about — the property genuinely might not exist, which is
what the check is asking. It compiled cleanly and answered `false` for every real
`AbortSignal` in the runtime, which made `addEventListener(..., { signal })` reject its own
signals.

So the rule for the rest of this work: **`tsc` finds every syntactic use and none of the
reflective ones.** `in`, `typeof x.name`, `hasOwnProperty`, a string in a table — all
invisible, all silent, and the only thing that caught this one was a test asserting behaviour
that a passing type check said was fine.

That is the second time today a green compiler has been the wrong instrument, and both times
the test that caught it was checking something the compiler is structurally unable to see.

816/816 host, upstream unchanged at 2,566 of 2,574, frontier unchanged at 1,407/337.

## A dependency neither corpus can see, and the overclaim it exposed

The Node lane reported five sites of the shape `!("aborted" in signal)` — in
`internal/validators.ts`, `util/src/main.ts` and two files under `stream/src/iter/` — which
brand-check this runtime's `AbortSignal` **by name, reflectively**.

That is the exact defect this lane shipped and caught an hour earlier, pointed the other way.
A reflective check is invisible to `tsc`, because the property genuinely might not exist —
that is what the check is asking. So symbol-keying or removing `aborted` would produce no
compile error here, no failing conformance test here, and five silent rejections of perfectly
valid signals over there. Their `validateAbortSignal` would begin throwing
`ERR_INVALID_ARG_TYPE` for correct input, in three modules, and nothing on either side would
say a word.

`aborted` stays named because Web IDL says so. What is new is that this is **written down and
asserted**, so the decision is made knowingly rather than discovered.

One reassurance for that lane, found by sabotaging it: symbol-keying `aborted` **does not
compile** — `AbortSignalOperations` declares it, so the internal operations interface already
guards it at the type level. That guard is incidental rather than designed, so the assertion
earns its place; but the exposure is smaller than it looked. Removing the accessor outright
does compile, and both new assertions catch it.

### The assertion found something on the way in

The suite already checked that no *extra* names appear on a cleared prototype. It had never
checked the other direction — that every standard name is **still there**, which is precisely
what symbol-keying a public member would break while remaining invisible to
`getOwnPropertyNames`.

Adding that check immediately failed, and it was right. **`Request` and `Response` are not
fully conformant and I had listed them as such.** They include the `Body` mixin, and Web IDL
says an included mixin's members are *copied onto the interface prototype*; here they are
inherited from a shared `Body` base class. `Request.prototype.hasOwnProperty("json")` is
`false` where every other implementation says `true`. Every value reads correctly and
`instanceof` is unaffected, which is why nothing had noticed.

Recorded rather than fixed — making the mixin members own properties means the prototype
chain stops inheriting from `Body`, and four interfaces sit on that hierarchy — and pinned in
the direction it currently holds, so that fixing it fails the test and the note has to be
removed rather than quietly outliving its reason.

**And the first version of the new check was itself vacuous.** It asserted
`"aborted" in new AbortController().signal` with no import — so `AbortController` resolved to
**node's global**, and the assertion checked node's signal rather than this runtime's. It
passed, and it would have passed forever. Caught by asking why a brand-new test was green.

816/816 → 818/818 host, upstream unchanged at 2,566 of 2,574.

## `EventTarget`, and the reflective check asked for in advance this time

`EventTarget`'s seven internals are gone from its prototype: `removeRecord` and
`compactListeners` are private identifiers, since they are used nowhere but inside the class;
the five `protected` ones are symbol-keyed, because `AbortSignal`, `EventSource` and
`WebSocket` genuinely need them. **Seven fully conformant interfaces**, surface 63 → **30**.

That is the third access modifier and the same lesson: `protected`, like `private`, is a
compile-time notion that leaves an ordinary method on the prototype.

**The reflective-use check was run before the rename this time, not after it.** Zero string
occurrences of any of the seven names anywhere in `runtime/web-platform` or `runtime/node`,
and zero uses in the Node lane at all. That took one command and it is the step whose absence
cost a broken `addEventListener` on the previous slice. `EventTarget` sits upstream of twelve
of that lane's twenty-two modules, so guessing was not an option.

**And `reportError` was conflated exactly as predicted.** `Scheduler` has one too, and the
mechanical pass converted `scheduler.reportError(...)` to the `EventTarget` symbol. `tsc`
caught it — a symbol key on a type that does not have it is an error — but it is worth
recording that the failure mode of a name-based pass is *silent on reflective uses and loud
on conflated ones*, and only the second half is free.

Frontier unchanged. 819/819 host, upstream unchanged at 2,566 of 2,574.

What remains is `ReadableStream`'s seventeen, `Event`'s seven and `WebSocket`'s six. The
streams set is still the hard one and still needs a type-aware pass.

## Five of `WebSocket`'s six, and a device measurement that reversed its own conclusion

Five `WebSocket` internals were `private` and are private identifiers now. `closeForRuntime`
is the sixth and is held: it is called from `provider/web-platform-runtime.ts`, and `provider/`
is paused while the Node lane's sweep runs. Surface 63 → **25**.

### The bypass reason was understated, not wrong

The JVM lane corrected its own measurement, and the correction reverses the conclusion I had
already written into a comment on their evidence.

They first showed `DefaultProxySelector` honouring `http.nonProxyHosts` — measured through a
bare `app_process` with the property **set by hand**. On that basis I rewrote this lane's
comment from "the platforms disagree, so hedge" to "these are two different lists". Both of
us treated a fact about the selector as a fact about the platform.

They then built a real APK. On API 26 the framework propagates the proxy's host and port to
an application and **does not propagate `global_http_proxy_exclusion_list`**: with the list
set to `localhost,127.0.0.1`, `http.nonProxyHosts` arrives empty and a request to `127.0.0.1`
routes to the proxy.

So the original hedge was not wrong, it was *understated*. The double application is not a
second opinion on that version — **it is the only thing keeping a loopback request off the
proxy.** Both facts are now in the comment, because the difference between "the selector
honours the list" and "a device gives the selector the list" is the whole point.

A test pins both halves: with no caller list a loopback host goes to the proxy, because the
resolver's answer is honoured and nothing here invents a loopback exemption; with the caller's
list it does not.

**And the near-miss they reported is the same instrument failure this ledger keeps recording.**
`settings put global http_proxy host:port` **clears** the exclusion list. They set the list
first, the proxy second, read back an empty list, and were one step from publishing their own
configuration as Android's behaviour. Their check now asserts the list took before believing
anything downstream — a verified precondition, which is the `head -14` truncation in different
costume, walked into by someone who had read about mine.

The check reports the bypass result rather than requiring one direction: a later Android that
propagates the list would answer `DIRECT`, which is an improvement and must not read as a
regression. What it asserts is that the two halves agree.

820/820 host, upstream unchanged at 2,566 of 2,574.
