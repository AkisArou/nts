# Seven tags, and the eighth

`String(v)` and `${v}` on an `unknown` refused at 178 sites in `runtime/node`,
161 of them in one file. I built it, measured the row from 179 refusals to 3,
and reverted the whole thing on one case the sweep found. The measurements are
worth keeping and so is the reason.

## The message could not be decomposed

    a conversion to string from this type

That sentence covers an object wanting `ToPrimitive`, an array wanting
`Array.prototype.toString`, and an erased value wanting a dispatch on its tag —
three features, and no census could tell them apart. The ledger row guessed
`valueOf`/`toString` dispatch, which is what 178 undifferentiated sites look like
from outside.

`describe(snapshot, ty)` already existed and `unrepresentable` already used it.
One line put the type in the message:

    176  unknown
      2  a union of an object | null
      1  a union of an array | number | string

and 161 of the 176 are in `internal/errors.ts`. **`valueOf` is not in this row at
all.** That finding survives the revert and is now written into the row.

## The feature was already built

`nts_value_to_string` exists in `runtime/c`, in LLVM's signature table and in the
JVM's ops, and the lowering already emits it. What gates it is one predicate —
`spells_itself` admits a union of scalars and absences and refuses `Unknown`,
with the reason stated where the decision was made: an `unknown` can hold an
object, and the object tag had no answer.

So it was never an unbuilt feature. It was one deliberate decision waiting on the
tag it excluded.

## The object tag is answerable

    descriptor->methods[nts_to_string_slot]   a declared `toString`
    a null entry                              "[object Object]"
    NTS_KIND_ARRAY                            join(","), recursing
    NTS_KIND_TUPLE                            refused, by name

All of that worked. 145 cases across eight arms agreeing with node on C and LLVM,
refusals 179 → 3, total 20509 → 20324, addons 24 of 24 with none regressed.

## The function tag is not

`String(fn)` in node is the function's **source text**. This compiler keeps none:
`Origin` carries a file and a line rather than a span, and the text would have to
be carried per closure into every backend.

I knew that and admitted `unknown` anyway, intending the function tag to abort at
run time — "loudly wrong" rather than quietly wrong. `tooling/sweep` generates
`String(v)` over every shape, including a closure, and it did not even get as far
as the abort:

    NTS2006 closure class `Closure14` reached code generation with no method to
    call

A closure that is *only* erased and never called. Before the change the function
holding it was refused, so the layout never reached codegen; admitting `unknown`
made it reachable and found a second latent defect underneath the first.

## Why the whole thing went back

Seven tags right and the eighth unanswerable is the shape this project refuses.
The alternative was a feature that compiles a case it cannot answer, in a program
the sweep deliberately generates — and the sweep is the instrument that exists to
find exactly that.

Three narrower escapes were considered and rejected: restricting the predicate to
types that exclude functions (an `unknown` never does), a whole-program test for
whether any closure is erased (`runtime/node` erases plenty, so the corpus sites
refuse again), and teaching the sweep's generator to skip the case (gaming the
instrument).

So the row stays ✗, and it now says what it is blocked on — **function source
retention**, which is a different feature from anything in the conversion — and
what was already proved about the other seven tags. The blocker fixture carries
the same, so the next person starts from the measurement rather than from the
guess.

## What did survive

Two things found while building it, both independently correct and both landed:

**`of_reference` never returned `SYMBOL`.** `hir::tags` defines it and documents
it — *"`typeof` answers `"symbol"`, so it sits below `OBJECT` for the same reason
`FUNCTION` does"* — and the word `Symbol` appeared nowhere else in the file. Free
for as long as nobody asked: the C backend asks the descriptor what a reference
is, so nothing here depended on the prediction. The JVM's `Erase` does, and
`lower_settle` does — a `Promise<symbol>` carried `OBJECT`, and no program in the
corpus settles one.

The JVM lane's listing is the clearest statement of why a wrong tag is worse than
one wrong answer: the only live test compares the tag against 5 while the value
carries 6, and then narrowing — which is *correct* — excludes the symbol arm and
folds `typeof v` to the literal `"string"`. A false premise with sound reasoning
on top.

**A class token had no base.** A closure gets the signature layout of its
function type from `relate_closures_to_signatures`; a class token is the other
thing that is a value of a function type and was not getting it. Measured rather
than argued, because a relation that states something true and changes nothing
should be deleted:

    a token where its own `typeof` is declared
      without the base   jvm declined 1 function
      with the base      agreed on c, llvm and jvm

It does not close the union case. `cond ? TypeError : RangeError` agrees on C and
LLVM and declines on the JVM, because the checker collapses the conditional to a
single constructor type and the token then meets a slot declared for the other
class — two genuinely different signatures rather than two ids for one. I nearly
flipped that row to ✅ on a two-backend reading, which is the per-backend trap
exactly.

One function serves both token arms now, because the first version went into one
arm and the failing example took the other.
