# A refusal needs the arms it must not take

A `throw` raised inside a call reaches no handler on any backend. The row said
✅, and was true of the half it had been tested on. Refusing the call took three
attempts, and the two failures are worth more than the landing.

## What it compiled before

    double crossing(double v0) { v1 = deep(v0); return v1; }

A `try`/`catch` compiled to neither, with no diagnostic. `deep` ends the process
through `nts_uncaught`; node returns `-1`. Measured as `10 case(s) the compiled
program declined`, and the JVM emitted no exception table at all.

## Version one refused too much, and an example said so

The first predicate was "does this call reach compiled code" — a callee with
declarations in the snapshot. `runtime/node` agreed with it and `cargo test`
did not: six failures in `array_buffer.rs`, from

    try { return new ArrayBuffer(bounded(n)).byteLength } catch { … }

`bounded(n)` is compiled and is also arithmetic. Refusing it takes a working
example away to fix a defect it does not have. The predicate that is actually
wanted is **can this reach a `throw`**, which is a fixpoint over the call graph
rather than a property of one call.

## Version two refused nothing at all, and nothing said so

`throwing_symbols` walked nodes, matched `FunctionDeclaration`, and read
`node.symbol` on it. That field is `None` there. The set came back empty, every
lookup missed, and **the refusal stopped firing without a single diagnostic
changing**: 719 tests passed, clippy was clean, the single-file suite moved by
zero, and the emitted C still said `v1 = deep(v0); return v1;`.

A gate that has gone vacuous and a gate that passes are the same observation
from outside. What separated them was running the probe that had failed before
the change and watching it not fail — `crossing` emitted where it should have
been refused. The fix is to walk `snapshot.symbols` and take each record's
`declarations`, so the key is a property of the iteration rather than a hope
about the node; the consumer asks about the symbol it read off the callee
identifier, and now so does the producer.

## Version three refused the async half

`examples/async-catch` is eight functions of `try { await failing(n) } catch`,
and all eight broke. An `async` function never raises synchronously — a `throw`
in one rejects the promise it already returned, and that rejection is a real
edge into the handler, wired by `lower_unguarded` and recorded in the row above
this one. So async declarations are excluded, and the exclusion is stated as
what is true rather than as what makes the tests pass.

## The general form

Each of the three versions was caught by a different existing fixture, and by
luck in the order that made each cheap. The arms are now written together, in
`examples/a-throw-that-stays-in-its-function`, differing in the callee and in
nothing else:

    crossing              calls something that throws        refused
    sameFunction          throws in its own body             compiles
    callingSomethingPure  calls something that cannot throw  compiles
    awaitingARejection    awaits something that rejects      compiles

87 cases across the three, agreeing with node on every one, and
`compiler/core/tests/throw_across_a_call.rs` asserts each by name — including
that `crossing` is *absent* from the program, which is the assertion version two
would have failed.

**A refusal is a claim about two sets, and a fixture holding only the refused
one cannot fail in the direction that matters.** `example-refusals` carries the
count `1` for this example for the same reason: a 2 there means the refusal has
grown a case, which is the failure both earlier versions had.

## What it costs

Two censuses over `runtime/node`, the same binary either side of the set being
populated:

    distinct root causes    844 -> 850   (+6, in 15 modules over 32 sites)
    things blocked behind   1452 -> 1416 (-36)

**Thirty fewer things are blocked in total**, which reads backwards until you
see why: a function refused at its own `try` stops being a path that drags its
callees into the cascade. The refusal's own row enters the table at 15 things,
of which nine were already refusing for some other reason — so the count that
matters is the six, not the fifteen, and a ranking by the message would have
said otherwise.

The single-file suite moves by zero, and that was checked against a binary
built from `HEAD` in a pinned worktree rather than against the number in
`README.md`, which was stale by two files and would have read as a regression
this change did not cause.

## What the refusal admits

Stated as the set rather than the rule, because the rule has been wrong twice:
an unresolved callee — `fns[0]()`, `this.handler()` — joins the throwing set
unconditionally. That is the one thing this refusal exists because the compiler
cannot establish, so assuming it is safe would be assuming the conclusion.
