# A field test needs a descriptor without an allocation

Measured on 2026-10-10, main `735038cb5dda` against `924200860c85`, with
the same tsgo frontend `4ec6b1a5235e473fe20e6cef4972dfc867b6ea1b9fad1351a31d8557d66e7776`.

`runtime/web-platform` emitted C successfully but its generated translation
unit could not compile. A field chain tested `WebSocketUpgradeAccepted` and
`WebSocketUpgradeRefused` with `nts_is_class`, naming descriptors which the
emitter had not defined. Both record layouts survived, but neither had a
surviving allocation. The descriptor-demand scan covered allocations, static
closures, published construction and `instanceof`, omitting open field tests.

Descriptor demand now includes every arm of `OpenFieldGet` and `OpenFieldSet`.
The existing descriptor builder still determines layout, reference offsets and
class identity. Neither the runtime ABI nor the field test changes.

## The reduced case and its control

Commit `37b3cc483` records `a-field-test-names-an-unallocated-record` against
main's pin (`de9d0b1ce10c119f`): C compilation rejects the undeclared `Refused`
descriptor. Only `Accepted` is allocated, but a union read must still test
both arms. Its control reads a field whose offset is shared by both arms and
needs no descriptor test. A separate probe allocating both arms already
compares 87 cases across three functions on main.

The fixed fixture moves to
`examples/a-field-read-tests-an-unallocated-record`. The native test compiles
with `-O2 -Wall -Wextra -Werror`, executes both read and shared-offset control,
and repeats under reference counting with AddressSanitizer.

## Why the gate missed it

`profile` emits Node modules, and `addons` compiles and loads those modules.
Neither includes the standalone web-platform project. `snapshot-cache`
compares its C text without compiling it; `integrity-runtime` reads HIR, and
`assembles` checks LLVM. Those checks can all pass beside uncompilable C.

The new `c-compiles` step checks all 29 runtime programs with
`clang -std=c11 -fsyntax-only -I <emitted> <emitted>/program.c`. This checks
the generated translation unit without Node headers or linking unrelated
native providers. Refusals can leave valid compiled bodies, but a nonzero,
missing or empty emission cannot count as a pass. There is no known-failure
allowlist. A missing C compiler is reported as not measured and fails.

When `profile` runs in the same gate, the check reuses its Node C only with
the same compiler hash and a successful module emission status. Each fresh
emission has a separate directory, so an empty one cannot reuse another
project's file. Workers use the gate's tokens. The owed-check map covers the
C backend, runtime sources, and the profile inputs consumed through reuse.

The check reports 28/29 on main, with web-platform's missing descriptor named.
The candidate reports 29/29 over 88.1 MB of C, reusing 28 emissions. Its
six-worker measurement takes 21.7 seconds, 31.9 CPU seconds, recorded in
`tooling/gate/times.tsv`. Instrument controls delete a descriptor definition,
exercise empty and failed emissions, change cache provenance, and remove the
C compiler; each is rejected or reported unmeasured.

## Reach and generated code

The census remains 51,679 functions over 29 projects, with every module's
count unchanged. All 28 Node `program.c` files are byte-identical to main.
Web-platform differs only by two descriptor definitions and their reference
offset arrays: no function body or dispatch table changes. A fresh `-O2
-ffunction-sections -fdata-sections -fPIC` compile produces a valid object
with 543,441 allocated bytes. The scalar benchmark suite is not rerun for
unchanged executable code.

The existing 494 C examples remain unchanged. The new case agrees over 58
cases on the candidate; the two-binary differential reports its baseline as
NOT MEASURED because main's C does not compile, rather than counting that
as a correctness result. The pinned outcome above records that failure.
All 495 LLVM and JVM examples remain unchanged. All 134 existing outcomes
retain their expected results, and the blocker checks pass.
