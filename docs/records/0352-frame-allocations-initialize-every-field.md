# Frame allocations initialize every layout field

A heap object starts with zeroed storage, but native frame allocations only
initialized their header and counted fields. Scalar fields retained stack
garbage. A captured binding's `ready` flag could therefore let a premature
read through, returning a random scalar instead of stopping at the binding
guard. This affected both C and LLVM.

Both emitters now initialize every field at each `ObjectNew`, including
loop-reused allocation sites, and clear the header's flags. The descriptor and immortal reference count retain their frame values. C writes
members by layout index, preserving distinct names for shadowed fields;
LLVM writes each member's typed zero at its placed offset. `NtsValue`'s
undefined tag is zero and its payload is zero, so C `(NtsValue){0}` and LLVM
`zeroinitializer` match the heap's member values. Padding is outside this
contract. This is one rule for every frame object.

Typed stores matter for performance. The initial whole-allocation memset
retained a wide store spanning overwritten values and padding in `upcast`;
two quiet C comparisons measured slowdowns of 8.33% and 7.68%. That form was
not gated. Whole-struct aggregate initialization produced the same retained
memset. Individual typed member stores let C and LLVM eliminate numeric
defaults that the constructor overwrites; optimized output confirms this
for `upcast` on both backends.

An intermediate version also cleared `header.length`. That field is array,
string and foreign-holder metadata, and runtime readers discriminate those
kinds before using it. Ordinary frame objects carry none of those descriptors.
Clearing it widened the flags store and shifted hot-loop code; two quiet
comparisons repeated roughly 10.5% and 11% slowdowns in `upcast` and
`instanceof`. That version was not gated either. The final version initializes
the semantic header members and every declared field. Both affected linked
binaries now match the control exactly. The invariant is documented at
`NtsHeader.length`, where a future reader sees it.

## Evidence

The control pin is `4ed130e6d209`, SHA-256
`5ec74dd0e7530af382e6cfefd5c48b3db1704818147f2e810a964a30a75e4752`.
The final source pin is `6da64cd455b9`, SHA-256
`813e75eb427dea6665ca45bf8636147f4a8edf45852fa1e15911a5d6f55c19fd`.
The tsgo binary is unchanged from record 0351.

A closure called before its captured `const x = 1` declaration witnesses
the defect. Valgrind finds uninitialized reads in the control's C and LLVM
executables, and C MemorySanitizer does likewise. Each has a no-GC and a
reference-counted arm. All six final arms have no uninitialized read and
stop deterministically with the binding's name. C MemorySanitizer uses O0:
at O1, optimization can erase the control's undefined read and hide the
sanitizer finding. The LLVM witness uses Valgrind, not MemorySanitizer.

All 311 existing C and LLVM backend tests pass, along with strict workspace
Clippy. Two additional backend unit tests directly assert integer and boolean
defaults for a frame cell; both pass without a frontend or sanitizer.
Every one of the 29 runtime modules emits valid HIR and compiles at O2.
Native tables remain 62,592 bytes. Aggregate O2 object size changes from
11,703,074 to 11,703,001 bytes. Of the 62 benchmark binaries, 58 are
byte-identical and four change; seven translated objects and 19 C sources
change.
Fresh quiet C timings cover all 14 rows affected during development, in two
interleaved before/after pairs under the gate lock. Raw geometric means are
0.99865x and 0.99951x; normalized to the C++ controls they are 1.00459x and
0.99145x. No slowdown beyond 3% repeats in either measure. Each run verifies
checksums, source identity and the absence of competing compilers; all 56
measured binary hashes match the intended control or candidate artifacts.

The C, LLVM and reference-counted C differential lanes each compare all
512 examples unchanged, with no wrong, changed or unstable results.
The JVM lane also compares all 512 unchanged. Definitions remain 51,680.
The function-state comparison covers all 29 runtime modules with no moves.
All 322 blockers behave as expected. All 139 outcome records reconcile
(67 holds, 72 reproductions). The existing hoisted-var closure outcome is re-recorded from the final source pin: a
nondeterministic wrong scalar becomes a deterministic named stop.

The test262 language record loses exactly two previously failing rows,
`identifier-resolution/S10.2.2_A1_T3.js` and
`statements/const/function-local-closure-get-before-initialization.js`.
Their premature reads now stop instead of returning garbage. The recorder
retains only pass and fail results, so those stops leave its ran-set; no
previously passing case is lost. A final re-record reconciles 8,317 recorded
cases, with the pass count unchanged at 6,627. No floor changes.

## Boundary

This change makes initialization deterministic. A lexical premature read
still needs a catchable `ReferenceError` on every backend. A forward-read
`var` needs a cell representation that holds `undefined`, with its guard
removed in that same change. Removing that guard now would replace a named
stop with a deterministic wrong scalar. Those two semantic fixes precede
the interface access-family stage.
