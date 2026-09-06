# A clamp where the language throws, and the driver that could not see it

    "ab".repeat(-1)     node: RangeError     nts: ""

`nts_str_repeat` clamped a negative count to zero. Five cases in
`examples/strings`, and it had been wrong for as long as it had existed.

## Why nothing saw it

The differential's node driver called each case in sequence with no
`try`/`catch` around the synchronous arm. A case that threw ended the module,
and **every case after it went unasked** — so the one input that would have
disagreed also removed the evidence that anything was missing. The JVM session
fixed the driver; `examples/strings` went red the same day, on a defect nobody
had introduced.

That is the fourth instrument this week whose *scope* was the thing that was
wrong, and the sharpest: it did not report a wrong answer, it reported fewer
answers, and a smaller denominator reads exactly like a smaller problem.

## What the language says

`ToIntegerOrInfinity(count)`, then throw where the result is negative or
`+Infinity`. So the test is `n < 0 || n === Infinity`, and each half earns its
place: `-Infinity` is caught by the first, `-0` is not negative and must not
throw, and a **`NaN` fails both** — which is right, because
`ToIntegerOrInfinity(NaN)` is `0` and `"ab".repeat(NaN)` is `""`. The runtime's
clamp was correct about exactly one of the three values it was clamping.

Two branches rather than a disjunction: this IR has no boolean `||`, because a
short circuit is control flow, so `n === Infinity` is evaluated only where
`n < 0` was false — which is what the source says anyway.

## Why the throw is at the call

A runtime helper cannot throw. `OpKind`'s own comment says why: *a handler is a
block and a `throw` is a jump the lowering emits, so nothing below the lowering
can reach one.* Aborting instead would be a different observable —
`try { s.repeat(-1) } catch {}` catches in node and would end the process here.

So `guard_repeat_count` emits the test, and `throw_provided_error` builds the
error and hands it to `throw_erased`, which is the entry point the rejection
rethrow already uses.

## The class a program never named

    a thrown `RangeError`, which this program has no type for

`examples/strings` contains no `RangeError`, so the checker never interned one
and `type_named` answered `None`. **A class this compiler provides cannot depend
on the source having mentioned it** — that is what *provides* means.

So there is a reserved band, `PROVIDED_ERRORS`, below the constructor tokens and
above anything a snapshot uses, and the layout is built from
`builtin::error_fields()` and the class's own name. The snapshot's id is
preferred where there is one, so a program that *does* name `RangeError` gets
one type and one layout — and where both arrive they merge, because
`collect_layouts` refuses only two error layouts of **different** names.

Second time this session that a reserved id band has been the answer to "the
compiler needs a type the program did not write", after the constructor tokens
of 0162. The two are the same shape and it is worth saying so: an id space the
checker does not own, for facts the checker has no reason to hold.

## An uncaught throw is not a crash

With the throw in place the differential still failed — six aborts:

    the compiled program aborted: nts: uncaught RangeError: Invalid count value

`stopped_with` treated any `nts:` line that was not a refusal as a defect, which
was right while every throw ended the program **by construction**. It is not
right now. Node's driver reports the same event as `threw`; ours prints
`nts: uncaught` and stops. Both sides have no answer at that index, and the pair
should be dropped.

So `UNCAUGHT` joins `REFUSED` and `EXHAUSTED` in the two places that ask whether
the program said something before it stopped. A signal death with none of the
three is still a crash, which is the classification that matters.

## Ratchets

- `examples/strings` — 1,229 of 1,239 cases against node on C, LLVM, JVM and
  under counting, with the ten the pool makes negative or infinite declined on
  both sides. It needed no new fixture: the hostile pool had been feeding it the
  failing values all along and only the driver could not carry the answer back.
- `compiler/core/tests/repeat_count.rs` — two tests, two mutations. Removing the
  guard fails both *and* the differential; removing `UNCAUGHT` from the
  classifier turns five disagreements into six aborts, which is the second
  half's own ratchet.
- `tooling/memory/cases/repeat-guard` — **17 / 17**, argued before measuring and
  exact. The subject is the guard, which appears in neither number: a lowering
  that built the `RangeError` before testing, or on every call, would read 34
  **and still agree with node on every case**, because the object would be
  discarded unthrown and no differential can see an allocation that changes no
  answer.
- No benchmark row. The guard is two comparisons and a predictable branch on a
  helper that allocates and copies `n * len` code units; `benches/cases` has no
  `repeat` row and adding one would time `memcpy`. The written reason is that
  the change is a branch in front of an allocation, and the allocation is the
  row.
