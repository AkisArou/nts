# Native dispatch tables need only their readers

Part 1 + 1b recovered structural method dispatch while adding dense-table
padding (record 0346). Part 3 removes that padding without merging selectors.
The implementation pin is `c0b4497ad2dd`; its control is `deffc0dae399`, with
the same tsgo frontend `4ec6b1a5235e473fe20e6cef4972dfc867b6ea1b9fad1351a31d8557d66e7776`.

## The plan is a projection

At the end of `prepare_unverified`, after every pass that can change functions
or layouts, `hir::native_dispatch` sorts all surviving native readers. Each
logical selector they name gets a distinct native column. Logical calls,
`Layout::methods`, closure/raising slots, reachability and the JVM keep their
existing selector identities. C and LLVM share the plan and row projection.
Raw HIR without a plan keeps identity tables for existing emitter consumers.

For every layout, every retained column holds exactly the logical entry's
body or null. No possible receiver set or interface-storage assumption is
needed: a structural or erased receiver missing a method still has no body.
Rows with no surviving body need no table. Every call keeps its indexed load
and indirect call; the runtime and its descriptor ABI are unchanged.

Selector coloring was measured offline first. Merely discarding unread
columns already exceeded both the table-byte and per-object targets. Sharing
co-filled columns is deferred until there is a measured need, since it would
also require proving that a reachable null cannot acquire another body.

Readers are virtual and closure calls, `PromiseSubscribe`, symbolic
`DispatchSlot` values, context bridges whose closure body is unknown, and the
exported `nts_closure_call_slot`. The verifier checks the compact, injective
map and walks readers separately from the planner. Both native emitters also
require a column at every actual load or published slot constant. A sabotage
test removes a real virtual reader: the verifier and both emitters reject it.

## Symbolic slots and the operation audit

Lowering's dynamic-import job, thenable job and timer callback arguments were
numeric constants. They become `DispatchSlot(logical)`, with the runtime's
f64 ABI and no numeric fact until emission. C/LLVM spell the native column;
the JVM spells the original logical value and rematerializes it as a literal.

The explicit operation arms changed are `fold::fold` (skip),
`simplify::substitute` (no operands), `simplify::leaves_fields_alone` (pure),
`dce::has_effects` (false), `verify::operands` (empty), `own::quiet` (true),
the three emitters, JVM rematerialization, and CLI rendering. Type verification
requires f64. Default arms in flow and specialization are deliberately TOP
and false, with comments: neither may infer its number or narrow its ABI.
Simplification, native ABI checking and obligation constant recovery return
no exact value; narrowing excludes it. CSE only merges unerases. Escape and
RC consult operands, allocation and ownership/type facts: this scalar has
no operands, allocation or reference count. Memory/debug lowering and N-API
introduce no additional scalar-constant behavior. Core tests check unknown
facts, no folding, empty operands and removal of an unused symbolic slot.

The handwritten reader audit found Node process, net, DNS, fs, dgram, timers,
child_process, crypto and internal async callbacks using the exported
`nts_closure_call_slot`; internal microtask enqueue and the managed-ABI test
library do too. `nts_runtime.c`'s callback task reads `entry->slot`, supplied
by a mapped compiler callback argument or the exported constant. Literal zero
slots belong to standalone C tests with handwritten tables. `nts_cf_host.c`'s
`methods[at]` registers Objective-C methods and is a separate ABI. No managed
table reader in N-API was found outside emitted C.

Tests execute promise and timer callbacks through a moved closure column for
fifty rounds on C and LLVM, with reference counts balanced under RC. A context
bridge loads through an unknown signature closure, also on both backends and
providers. Two fresh preparations emit byte-identical C.
Five core tests and three native boundary tests pass; the sabotage reader's
selector differs from the exported callback selector, so its emission errors
come from the actual call. Workspace Clippy passes with warnings denied.

## Coverage and backend checks

The prepared-HIR census remains 51,679 functions across all 29 runtime
modules. The normalized refusal-site comparison adds none and removes none.
Four differential configurations (C, LLVM, JVM and C with RC) each report
495 unchanged examples, with no fixes, regressions, changed answers, unstable
answers or missing measurements. Blockers remain 305/305 expected;
outcomes remain 67 holds and 67 reproductions. No fixture record is changed.

The JVM lane independently emitted both pins over 28 runtime modules:
24,050 class files have identical SHA-256 hashes. Stream, HTTP and fs each
contain 27 DispatchSlot operations, so this checks the new JVM emission arm.
Web-platform and the timer/promise JVM probes were stopped for the quiet
native benchmark window. Integer rematerialization has a maintenance comment:
DispatchSlot must gain an integer arm there if narrowing ever admits it.

## Runtime performance

The C lane is measured in two interleaved control/candidate pairs, holding the
measurement lock throughout and with the other lanes quiet. `nts-bench` links
the compiler itself: changing `NTS_BIN` would not select the control compiler.
The control runner was copied from the gated `deffc0dae399` build, and the
candidate runner was built from `c0b4497ad2dd`. Both use the same worktree inputs,
runtime support, frontend and C toolchain. C++, C and Node checksums must agree
before the runner publishes a timing row; all 62 C cases are measured.

The two raw geomeans are 1.00000x and 0.99990x. The C++-normalized geomeans
are 1.00126x and 1.00102x. No raw or normalized row is outside 3% in both
rounds. Every arm completes all 62 cases with matching checksums; its 62
generated C executables are byte-identical between rounds. Only three
executables differ between control and candidate. The window is 41 minutes,
with no other compiler or gate running beside it.

## Size

All 29 runtime modules emit valid C and compile at `-O2`; `c-compiles` separately
passes 29/29 with `clang -std=c11 -fsyntax-only`, reusing the 28 Node emissions.
Node output matches the independently projected offline C after removing
blank lines. The projection has no other generated-C change in those modules.

Table bytes count every emitted nonempty `nts_vtable_*` row, including nulls,
at eight bytes per column on x86-64. Optimized `program.o` uses
`-std=c11 -O2 -ffunction-sections -fdata-sections -fPIC`; bytes are allocated
text + data + bss from `size`, excluding shared runtime, addon, debug and
relocation-file overhead. These are the same measures as record 0346.

Across the 28 Node modules, tables fall from 2,569,032 to 58,952 bytes (97.7%)
and objects from 13,611,084 to 11,180,165 bytes (17.9%). All 28 objects are at
or below their pre-1b ceilings, whose total was 13,023,217 bytes; tables are
also below the pre-1b 2,064,848-byte target. DNS is 180,304 bytes against its
182,948-byte ceiling. Web-platform falls from 23,400 to 3,840 table bytes and
from 543,441 to 522,798 object bytes.

| Project | Emitted columns control / Part 3 | Table bytes control / Part 3 | Pre-1b object ceiling | Object bytes control / Part 3 |
|---|---:|---:|---:|---:|
| assert | 72 / 13 | 81,792 / 832 | 490,566 | 504,364 / 422,369 |
| async_hooks | 13 / 5 | 13,104 / 120 | 104,926 | 104,926 / 91,874 |
| buffer | 10 / 3 | 10,000 / 48 | 184,065 | 184,065 / 174,093 |
| child_process | 106 / 19 | 148,400 / 4,408 | 735,443 | 771,885 / 630,082 |
| cluster | 111 / 20 | 163,392 / 4,960 | 789,819 | 831,383 / 676,148 |
| console | 71 / 13 | 85,200 / 1,560 | 499,928 | 512,614 / 431,725 |
| crypto | 137 / 19 | 209,336 / 5,776 | 837,299 | 878,773 / 690,634 |
| dgram | 109 / 20 | 152,600 / 4,320 | 755,448 | 795,900 / 650,813 |
| diagnostics_channel | 10 / 2 | 10,000 / 32 | 99,062 | 99,062 / 89,026 |
| dns | 14 / 2 | 15,120 / 128 | 182,948 | 195,236 / 180,304 |
| events | 71 / 13 | 81,792 / 832 | 476,224 | 491,234 / 409,110 |
| fs | 169 / 21 | 258,232 / 5,712 | 930,579 | 986,039 / 748,788 |
| http | 157 / 25 | 244,920 / 7,200 | 933,147 | 996,129 / 770,691 |
| net | 109 / 20 | 151,728 / 4,320 | 759,285 | 799,593 / 655,378 |
| os | 10 / 3 | 10,000 / 48 | 190,637 | 190,637 / 180,665 |
| path | 10 / 2 | 10,000 / 32 | 116,163 | 116,163 / 106,191 |
| perf_hooks | 79 / 16 | 101,752 / 3,200 | 539,202 | 565,336 / 468,768 |
| process | 154 / 23 | 236,544 / 6,440 | 928,158 | 990,500 / 771,561 |
| punycode | 3 / 2 | 48 / 32 | 8,695 | 8,695 / 8,695 |
| querystring | 10 / 3 | 10,640 / 240 | 260,069 | 260,069 / 249,705 |
| readline | 74 / 14 | 88,208 / 1,568 | 595,070 | 619,084 / 532,849 |
| stream | 135 / 19 | 178,200 / 2,736 | 706,146 | 744,316 / 573,761 |
| string_decoder | 10 / 3 | 10,000 / 48 | 190,043 | 190,043 / 180,071 |
| timers | 15 / 4 | 15,360 / 128 | 132,724 | 143,331 / 128,055 |
| tty | 0 / 0 | 0 / 0 | 118 | 118 / 118 |
| url | 13 / 5 | 14,248 / 560 | 351,010 | 352,066 / 338,566 |
| util | 72 / 13 | 82,368 / 936 | 498,986 | 512,784 / 430,789 |
| zlib | 136 / 19 | 186,048 / 2,736 | 727,457 | 766,739 / 589,336 |
| web-platform | 75 / 24 | 23,400 / 3,840 | — | 543,441 / 522,798 |
