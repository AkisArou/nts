# Literal methods fill their own dispatch rows

Part 1c extends structural method inference to literal implementers. Its control
is main `ede19442c81c`; the final measured compiler binary has SHA-256
`a3928e73cbbb672ebb4b5a8ea767c25a07e8a4c691a6c818b32264684d044a27`.
The frontend is the same tsgo used in record 0348.

## Evidence belongs to the allocation

The allocation and supply census share one contextual-owner collector, including
array elements and tuple positions. Every initial function and possible method
write must fit the slot's real contract. TypeScript's bivariant contextual method
signature cannot prove that a narrowed authored parameter accepts the call.
A literal owner shared with a declared class cannot assume that class has its
closure field. Classes and literals share the conservative candidate predicate;
the class-only prefilter control changes no runtime refusal site or census count.

A direct method names its actual owner body, including inherited declarations.
A stored method's table body loads the current closure field and invokes it
through the existing uniform ABI. This preserves captures, replacements and the
literal's receiver. The raising entry is tested before result recovery; a concrete
result is checked before decoding, and a void face releases the discarded result
under RC. Adapter sharing includes precise input and result absence, and shared
bodies receive the meet of input facts. Field adapters never grant permission to
omit a forwarding body. Newly materialized layouts use the canonical merge.

Private helper writes use every known incoming supply, through the same closed
function-call evidence as erased-parameter copies. Exported, escaping or reassigned
helpers do not provide that proof. A separate whole-callee proof allows source
copies only when method values are used transitively for identity, strict comparison
or typeof. Mixed value-and-call faces preserve the globally classified legacy
path, pending Part 2's accessor that returns the implementer's original closure.
The existing mixed-flow narrowing wrong answer stays pinned as an outcome.

## Coverage and limits

All four differential lanes (C, LLVM, JVM and C with RC) report 497 unchanged
examples, 12 fixed, and zero regressed, changed, unstable or unmeasured. There
are 14 added examples, including promoted crash and exception-loss outcomes,
current-closure replacement, contextual arrays, inherited and generic supplies,
void-result disposal, identity-only copies and a mixed class/literal Wakeable
array. The additional Thenable try/catch export compares all 58 cases per lane,
with both throwing and non-throwing supplies.

Seven core tests check row targets through preparation, exact absence, unsafe
writes, closed-helper evidence, identity copies and the mixed-flow fallback.
Native boundary tests reject a counterfeit erased result before decoding and
check stable live RC bytes after 1,000 discarded managed results. All final
boundary tests and workspace Clippy with warnings denied pass. The full gate
is still required for landing.

The blocker set has 317 expected refusals. Nine outcomes are promoted to examples
or honest blockers; the remaining 137 outcomes report 67 holds and 70 reproductions.
The independently pinned class/string tuple storage defect and empty-record cast
to dictionary defect remain outcomes, as does mixed method identity and invocation.
Two native-correct fixtures deliberately stop on the JVM when absence or callback
contracts require distinct bodies under one Java method projection. Both decline
shapes are classified; no JVM renaming is added here.

The 29-module runtime census remains 51,679 functions and 36,266 refusals, with
zero normalized sites removed or added. Every module emits verified C and
compiles at O2. Dispatch tables remain 62,480 bytes in total. Optimized objects
change from 11,702,963 to 11,702,981 bytes: 18 bytes in fs for checking closure
raises before result decoding. Seventeen generated C files differ; unused
interface struct declarations account for the other modules' differences.

Both GTK and libadwaita host-driver tests pass on C and LLVM. The full GTK counter
still refuses 769 functions, drops its entry invocation and exits without output.
Its next entry-chain stop is `then@raises`: initial React Thenable supplies fit
Wakeable, but unknown computed writes conservatively block their interface edges
and therefore the raising slots. The write-precision follow-up must prove which
writes cannot replace `then`; it must not bypass the unknown-write guard.

Legacy-only classification covers 127 interface occurrences across 14 runtime
families, at most 13 in a module (stream 12, HTTP 13). GTK counter and GTK state
have zero; Wakeable is never legacy-only. The families are AsyncIterator,
AsyncWriter, ClassicReadableLike, ClassicWritableLike, CookieJarStore,
DestroyableStream, ErrorOrDestroyStream, HTTPDuplex, LegacyReadableSource,
SocketConnector, StreamAbortSignal, SyncWriter, TlsUpgrader and Utf8StreamFileSystem.
Wakeable write precision is next, followed immediately by Part 2's accessor slots.

## Performance carry-forward is an executable proof

All 62 generated benchmark C files are byte-identical to main's control and the
actual timed Part 3 artifacts. Runtime and support sources and compilation flags
are unchanged. All 62 generated objects also have identical SHA-256 hashes.

The first replay linked the generated object before the runtime, whereas the
benchmark harness links runtime and optional Unicode objects before generated
code. That changed data ordering and relocated operands in 41 binaries. Repeating
with the harness's original object order produces 62 byte-identical timed
executables. Thus record 0348's two quiet interleaved timing pairs are carried
forward; this change claims no fresh timing run. This proof does not measure
compiler latency or new literal-adapter workloads.
