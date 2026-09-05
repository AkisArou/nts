# An `async` method was refused for a reason that expired

    an `async` method

**161 occurrences at 63 distinct sites in `runtime/node`** — the largest single
*language* refusal there, behind only the type-representation ones. And the
reason beside it:

    // As for a function: `Promise<T>` has no representation, so an `async`
    // method resolved to `-> void` and returned an `f64` from it anyway.

`ManagedType::Promise` has existed for some time. `async` **functions** have
worked throughout — `examples/async` is in the suite and the ledger has said
`async`/`await` under both providers for as long as it has said anything. Only
the *method* lowering never got the prologue that allocates the promise.

The fix is that prologue: `begin_async`, the same call `lower_function` makes,
plus settling on the fall-through path instead of `close_body`. `hir::suspend`
splits the result by the same rule it already used, and a method's receiver is a
parameter like any other — so it goes into the frame beside the rest and comes
back out on resumption.

That is the fourth reason this stretch to have expired without being reread:
`declared_readonly`'s comment described an algorithm it did not implement,
`specialize.rs` named an optimisation and attributed it to a compiler not
performing it, `suspend.rs` said spilling was not done after it was, and this.
**A refusal that states its cause precisely is the hardest kind to notice has
gone stale**, because the sentence keeps making sense long after it stops being
true.

## The count went down

    profile refusals, distinct sites   2201 -> 2159
    of which this one                    63 ->    0

The first change this stretch that *reduced* the total. `readonly` and the
parameter defaults each raised it — a function that stops being refused lowers
further and meets a different refusal — and this did not, because an `async`
method is usually the last thing standing between a class and being lowered
whole.

## What it found in the memory suite

There was no `async` case. Not one, since `async` existed.

Writing one showed everything leaking, and the smallest possible program said it
loudest: **one `async` function, no `await` at all, one allocation, one leaked.**

Not a compiler defect. An `async` body's cleanup lives in its *resumption*,
which runs on the loop, and `tooling/memory/harness.c` called `work(1)` and read
the counters immediately. It was measuring an unfinished program. Six lines —
`nts_checkpoint` until `nts_has_pending_work` is false — and the leak went from
seven objects to one.

The last one was the harness's own: it declares `double work(double)`, so an
entry point returning a promise hands back a pointer it reads as a number and
never releases. The case's `work` is deliberately not `async` for that reason,
and the reason is written in the case.

**The suite was perfectly capable of catching an async leak and had never been
pointed at one.** That is the JVM session's *a check whose subject is absent*,
at the level of a whole instrument rather than one assertion.

## Measured

    async-method (memory)   ideal 35   allocated 7   actual 35   alloc 7

    1  the `Counter`
    2  a promise per `accumulate`, which every `async` call makes
    2  a frame per `accumulate`, the only body that awaits
    2  a promise per `scaled`

`scaled` allocates no frame: it is `async` and never awaits, so `hir::suspend`
leaves it whole. **I argued thirteen and it is seven** — I counted a frame for
`scaled` and a promise for `work`. The over-count was in the direction that
would have hidden a regression, which is the wrong direction to be wrong in.

The operations line is the weakest in that file and says so: thirty-five against
a naive thirty-nine, which is five counted operations per object for a program
where every promise and every frame is handed on rather than shared. It is
written down as a number to beat rather than a floor I can derive.

**No benchmark row.** `benches/cases` has no async row at all, because the
harness times a synchronous `work(seed)` and an async one returns before its
work is done — timing it would measure the call rather than the program. That is
a gap in the benchmark harness of the same shape as the one just closed in the
memory harness, and it is named here rather than worked around.

## Ratchets

- `examples/async-methods` — 290 cases against node on C, LLVM, the JVM and
  under counting, across ten functions: `this` read after a suspension, two
  suspensions with the receiver live across both, a local beside the receiver,
  a method settling with `undefined`, an `await` inside a loop, a path that
  never awaits, static methods, an overridden `async` method where the dispatch
  slot holds two state machines, and two receivers interleaved so a frame
  confused with another object's would show one counter's base in the other.
- `compiler/core/tests/async_methods.rs` — five tests, two mutations. Removing
  the prologue fails four **and produces invalid HIR**; skipping the settle on
  the fall-through path failed **17 differential cases and no test**, which is
  why the fifth test exists.
- `tooling/memory/harness.c` — `drain()`, and the first `async` case in the
  suite.
