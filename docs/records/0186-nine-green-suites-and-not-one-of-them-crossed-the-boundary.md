# Nine green suites and not one of them crossed the boundary

The JVM and Android lane had nine test suites when I started this: sockets, TLS,
proxies, HTTP over gzip, the environment loop, the cross-thread inbox, callbacks,
the Android primitives, and 3,497 lines of typed-array oracle. All green. Every
one of them calls `nts.rt` from a Java `main`.

So all nine would have stayed green if the JVM backend could not emit a call to
the runtime at all.

The plan says "actual TypeScript compiled to JVM invoking the fixed intrinsic
ABI; host Java tests alone are insufficient". I had read that as a note about
coverage -- one more suite to add. It is not. It is a statement about what the
suites I had could *distinguish*, and the answer was: nothing about whether a
program can reach any of it.

## What the first compile said

The fixture is fifteen lines. Four `declare function` declarations and four
exported functions that call them.

    declined: NTS4001 a call to `nts_jvm_web_open_count`, which this backend
              has no name for (in `openCount`)
    declined: NTS4001 a call to `nts_jvm_web_close` (in `closeUnissued`)
    declined: NTS4001 a call to `nts_jvm_web_network_changed` (in `networkChanged`)
    declined: NTS4001 a call to `nts_jvm_web_close` (in `closeThenCount`)

The backend behaving exactly as it should -- refuse by name, never half-emit --
and the lane being further from done than nine green suites had suggested. The
Java was written, tested and shipped in the jar. The table that lets a program
name it was empty.

## The version that would have passed anyway

The first fixture called each intrinsic with nothing open and printed what came
back. Every answer was zero, and it ran green the moment the table had entries.

It would also have run green against a table that mapped all four names to the
wrong method, as long as the wrong method also returned a `double` and also
answered zero on an idle provider. A test whose every expected value is the
zero the system produces when it is doing nothing cannot tell working from
absent.

So the driver opens three real sockets first, and the compiled TypeScript counts
them:

    open 3
    after close 2
    after cancel 2
    changed 2
    open 0
    changed 0

Three rather than one, because one cannot tell a count from a boolean and two
cannot tell a count from a toggle. `changed` twice, because the second sweep has
nothing to close and has to say so rather than repeat the first answer. State is
created on one side of the intrinsic boundary and observed on the other, which
is the only arrangement in this lane where a wrong table entry moves a number.

Sabotaged two ways, both of which bite:

    close mapped to cancelConnect      after close 3
    the family dropped from `external` the four refusals, back again

## Four of nine

`runtime/jvm/web-platform/intrinsics.d.ts` -- at `runtime/web-platform/android/` when this was written -- declares nine. Five take an
environment handle or a byte view, and neither a common environment type nor
`ManagedType::View` exists, so those five cannot be written in TypeScript at
all -- they are marked GATED there and absent here.

Wiring four rather than waiting for nine was the right call and not for the
reason I expected. I did it because four was available. What it bought was the
discovery above, which the five gated ones would have delayed by exactly as long
as the missing types take to arrive.

## What this changes about the rest of the lane

Every remaining obligation in this lane has the same shape as the one that was
missing: a runtime half that is built and tested, and a compiler half that is
invisible from Java. The typed-array runtime is eleven classes and 3,500 oracle
lines with **no lowering that reaches it** -- `nts_view_get` and its family sit
in `ALWAYS_DECLARED` and nothing in `hir` emits one. That is the same gap this
record is about, one type larger, and it is not mine to close.

The rule I should have been keeping, and now am: a suite that drives the runtime
from the runtime's own language is a test of the runtime, and it is not evidence
about the lane. The lane is what a *program* can do.
