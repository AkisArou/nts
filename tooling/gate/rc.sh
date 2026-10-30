#!/usr/bin/env bash
# Every example again, with reference counting on both halves.
#
# The retains and releases in the emitted C are the compiler's own work, and
# until this existed nothing ran them. `NTS_PROVIDER_RC` appeared only in
# hand-written runtime suites; every compiled example ran under the bump
# allocator, where nothing is freed -- so a release too few leaks where nobody
# looks and a release too many is never observed.
#
# Both halves are selected together. The provider decides what the *compiler*
# emits, not only what the runtime does with it, and choosing one without the
# other compares a program that never releases against an allocator that
# expects it to. `NTS_RC=1` in the differential sets both.
set -eu
cd "$(cd "$(dirname "$0")/../.." && pwd)"

# Known to fail, and each for a stated reason. The list is a ratchet: a new
# failure breaks the gate, and fixing one of these tightens it.
#
# `invalid` and `unsupported` are not oracle cases under any provider: one does
# not typecheck and the other refuses on purpose.
#
# The other two hold objects they never give back, which the run measures: the
# driver records what is live after the first case and again at the end, forcing
# a collection at both so that what is merely awaiting the cycle collector is not
# counted as held. Growth between the two is a leak.
#
#   timers        Was 29 cases times 2 objects -- a pending 60-second timer and
#                 the callback it had not run. The note here said "not a leak",
#                 which was true and was not a separation: a pending timer is
#                 the *host's* state, and the check claims to measure what the
#                 program still holds. The driver now drains the host before it
#                 measures, so the number means what it says and this is 0.
#
# Both stay listed rather than excused: the check cannot tell state a program
# still needs from state it has lost, and a *change* in either number is worth
# stopping for even though the numbers themselves are correct.
#
# Five others were here and are not. `captured-by-reference` was a frame object
# whose fields nobody gave back; `arith`, `strings` and `signatures` were the
# differential's own driver keeping every string argument it built.
#
# `module-state` was the fifth, and it was not a baseline artifact after all --
# the note here said it was. `let history: number[] = []` at module scope had
# its initializer *refused* and silently dropped, so the array first appeared
# when `replaced` ran: one object more at the end than after the first case,
# exactly as a leak looks. Initializing it where the source says to made the
# count stable, and the explanation written here for two months was wrong.
#
# One example was passing this check while segfaulting on every case:
# `map-and-set`. The driver crashed before flushing a line, so the run had
# nothing to compare and `agreed()` did not ask whether anything had been
# checked. It does now, which is what surfaced `nts_map_set` handing back the
# table without retaining it.
# `this-in-a-field-initializer`, from 2026-09-12. A class's field initialisers
# moved into its own constructor -- which is where JavaScript runs them, and
# fixed a derived initialiser reading a field before `super()` wrote it -- and
# that put an object *and* a closure capturing it on a path where two ownership
# analyses disagree.
#
# The cycle itself is handled. `Program::cyclic_layouts` was following a field's
# declared type and stopping at the fieldless *signature* layout, so a class
# holding a closure that captures `this` was emitted with `cyclic = 0` and
# `nts_possible_root` returned on its first line. Following the edge to the
# subtypes of a base fixed that, and three probes bound it: a plain two-object
# cycle, a closure cycle at the allocation site, and a closure cycle formed in a
# callee -- the third leaked and now does not.
#
# What is left is a **double count**, which no collector can reclaim because the
# object does not look like garbage. The caller retains the receiver before the
# constructor call, as though the callee takes ownership; the callee retains it
# again when storing it into the closure. `own.rs`'s `consuming` decides the
# second and something else decides the first, and they are two derivations of
# one fact -- the shape this tree has been bitten by four times. Instrumenting
# `consuming` says the receiver is never even considered: it reports parameter 1
# and not parameter 0, so the receiver fails `counted` and is skipped in
# silence.
#
# Listed rather than left failing, and listed with the cause rather than the
# symptom: a name here with no explanation is how `module-state` sat as a
# "baseline artifact" for two months while being a dropped initializer.
# Listed rather than left failing, and listed with the cause rather than the
# symptom: a name here with no explanation is how `module-state` sat as a
# "baseline artifact" for two months while being a dropped initializer.
# `an-element-of-a-mapped-array`, from 2026-09-20. Reading an element of an
# array that `map` produced --
#
#     const ys = xs.map((s) => s + "!");
#     ys[0]
#
# -- answers freed memory here and is correct on C, LLVM and the JVM. What
# separates it from the shapes that pass is **how the result is read**: `ys[0]`
# and a `for...of` fail, while `ys.join(",")` and `ys.length` pass, because
# those two read the storage inside the runtime rather than through an
# `array.get` the compiled program performs. The callback also has to *produce*
# a new string: `xs.map((s) => s)` passes.
#
# **The fixture was first named for a cause that turned out to be wrong**, and
# the name went with it: it arrived as `a-mapped-tuple-in-a-concatenation`, with
# a boundary saying it needed two or more elements, a number conversion and a
# tuple element. All three were measured and the conclusion was still wrong,
# because each comparison changed more than one thing. The smallest failing
# program has none of them.
#
# Not the ownership optimiser -- `NTS_RC_NAIVE=1` fails identically -- and not
# the frame-allocated string, the source array, or the uninitialised result
# array, each ruled out rather than assumed.
#
# Pre-existing, and measured to be: the binary from before the
# enumeration-order work fails it identically. It surfaced because
# `the-order-own-properties-enumerate-in` was the first fixture in the corpus to
# write such a shape.
#
# Listed rather than left failing, and listed with the cause rather than the
# symptom: a name here with no explanation is how `module-state` sat as a
# "baseline artifact" for two months while being a dropped initializer.
# Empty since 2026-10-07: `this-in-a-field-initializer` passes once a kept
# parameter is released where it dies (a2), and `promise-reactions` once a
# collection runs to a fixpoint. The history above stays as the record.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec node "$root/tooling/differential/check-consumers.ts" rc "$@"
