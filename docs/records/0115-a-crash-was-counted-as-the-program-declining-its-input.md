# A crash was counted as the program declining its input

The JVM session found a real defect: an optional field's slot is erased, and on
that backend a reference field zeroes to **`null`** — a different value, and a
legal TypeScript one — where the C lane's zeroed `NtsValue` *is* `undefined` for
free. An unwritten optional reference threw.

Two instruments should have caught it. Neither did, and the second is the
finding.

## The example did not have the shape

`examples/optional-access` builds its objects from **literals**, and a literal
writes every field it declares — so an optional slot there is always assigned,
even when what it is assigned is the absence. The shape that breaks is a
**constructor** that does not write the field, which TypeScript permits
precisely because the field is optional.

Verified rather than assumed: `examples/optional-access` passes on the JVM lane
built at the commit *before* the fix.

## The harness turned its failures into skips

This is the part worth keeping.

`Check.java` runs the generated entry point reflectively, catches `Throwable`,
prints a stack trace and exits 1. Exiting is not a signal, and an ordinary
runtime exception has no fixed name the classifier's list of link-time errors
could hold — so both of `stopped`'s rules missed it and the fallthrough filed it
as **`Declined`**: the program correctly refusing its input.

Measured, on the same program with the fix removed:

    checked 4 of 174 cases; the rest were not reached
    agreed on every case

A hundred and seventy `NullPointerException`s, each counted as a decline. **An
example that had the right shape still could not have caught this**, because the
harness converts a crash into a skip and then reports agreement over what is
left. Adding the example was necessary and would not have been sufficient.

The rule that was missing: a **stack frame** — a line whose first token is `at`
carrying a parenthesised location — is a defect. `Check.java` prints one only
for an uncaught throwable; a refusal is an `NtsRefusal` and goes out as a `nts:`
line, so the two cannot be confused.

And the message names the **cause** rather than the wrapper. Reflection means
the outermost throwable is always `InvocationTargetException`, which says
nothing; the last `Caused by:` is the `NullPointerException` that names the
field. With the fix removed the run now says:

    the program threw rather than refusing:
      java.lang.NullPointerException: Cannot read field "tag" because "<local3>" is null
    Error: the compiled program aborted 17 time(s) for a reason that is not
           the program correctly declining its input

## The first version of the rule was too broad, and the gate said so

A stack frame is a defect turned **nine passing examples into failures**, and
all nine were right to pass. Two exemptions, both found this way rather than
reasoned:

**A refusal that arrives as a throwable is still a refusal.** `examples/arrays`
was reporting `nts: refused: index -0.500000 is outside [0, 3)` — the program
keeping the promise its `!` made — with a stack trace attached. `Check.java`
*has* a `catch (NtsRefusal)` arm and **it is dead**: the entry point is called
reflectively, so reflection wraps the refusal in an
`InvocationTargetException` and only the `Throwable` catch-all ever sees it. The
old fallthrough classified those correctly for the wrong reason, which is why
nothing had noticed the arm was unreachable.

**Running out of heap is not reached.** The pool asks for a loop bound of nine
quadrillion and a program that allocates per iteration does what that asks. The
C lane recognises its own `nts: out of memory` and counts the case as not
reached; `OutOfMemoryError` is the same fact in the JVM's words.

So the rule is: a stack frame is a defect **unless the throwable is an
`NtsRefusal` or an `OutOfMemoryError`**. Two names rather than a growing list,
because those are the only two throwables this runtime raises on purpose.

That the gate found this is the system working, and it is worth saying which
part: not the unit tests, which I wrote from the failure I already knew about,
but running the whole example suite against the new rule. **A classifier is
exactly the kind of change whose false positives live outside the case that
motivated it.**

## What it found, within the hour

The rule's first full gate run reported the JVM lane at **93 of 102**. Nine were
the false positives above. The other five were real, and every one had been
counted as a pass:

| example | what it was doing |
|---|---|
| `callbacks`, `array-references` | `ClassCastException: NtsValue cannot be cast to …` — a narrowing the middle end proved and the descriptor cannot carry. `NtsValue` is not a supertype of anything; it *contains* the reference |
| `growable`, `array-from` | `ArrayIndexOutOfBoundsException` on a subscript emitted `checked: false` — and past the length **but inside the capacity** it did not throw at all, it returned a stale slot from an earlier grow. A wrong answer, silently, in a window exactly as wide as the last growth |
| `async` | `NullPointerException` reading an array length |

All five are fixed on that lane now, and the floor is back at 102. The one worth
pausing on is `growable`: the exception was the *lesser* half of the defect.
Bounding by capacity threw where the index was past both and lied where it was
past only one, and only the throw was visible — to a classifier that was
discarding throws.

**The C lane declines those same seventeen cases** with *"an index its `!`
promised was in range and was not"*. So the two lanes disagreed about what the
program *did* rather than about what it computed, and a differential that
compares answers is blind to that by construction: neither lane produced an
answer to compare.

## Three ways to pass without passing

This is the third costume in two days, and writing them together is worth more
than any one of them:

| | what it looked like | what caught it |
|---|---|---|
| 0110 | a green with **no way** to be green — a wrong string constant agreeing with node | knowing what the answer must be |
| JVM 0111 | a red that looked **nearly** right — 87 of 99 | one `javap` dump of the artefact |
| here | a green that was **cheap** — agreed on 4 of 174 | asking why the count was low |

The third is the most dangerous because the harness is being honest. It prints
what it did not reach, immediately above its verdict — and *"agreed on every
case"* is the line a reader takes away. A count is not a footnote to a verdict;
it is a qualifier on it, and the two should be one sentence.

## Ratchets

- `examples/optional-unassigned` — 290 cases across ten functions, agreeing with
  node on C, LLVM, the JVM and under counting. A constructor that writes none of
  seven optional fields; the absence read through `?.`, `??`, `=== undefined`;
  a `boolean` whose `false` and whose absence are different; **`null` written
  into an optional reference, which `??` cannot distinguish from absence and
  `===` can**; one level of nesting; and the assigned path beside it, so a
  backend answering "absent" to everything fails too.
- **Verified red before the fix**: built against `93abbab~1`, the example
  reports the `NullPointerException` by name and the run fails. That is the
  claim an example of this kind has to make, and it can only make it because of
  the harness change above.
- `tooling/differential` — four tests on the classifier. A stack trace is a
  defect and names its cause rather than the reflective wrapper; a refusal that
  happens to contain the word `at` inside a path is still a refusal; a refusal
  **wrapped by reflection** is still a refusal; and an `OutOfMemoryError` is not
  reached. The last two are the nine examples the first version broke.
- `tooling/memory/cases/optional-unassigned` — 0 / 0 against a naive 17, argued
  before measuring. The absence is the zero the allocator already left, so
  reading it is a tag test and costs nothing.
- No benchmark row: the change is a harness classification and an example. There
  is no new code on any hot path to time.
