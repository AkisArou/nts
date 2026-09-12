# The conclusion stopped following

`"k" in v` where `v` is typed `object` refused whenever *some* type in the
program declared `k` optionally. The refusal's reasoning was written down and
was correct:

> with the value typed `object`, an instance of **any** type can reach here, so
> one that declares the key optionally makes the question unanswerable —
> including it answers true for a property that was never written and excluding
> it answers false for one that was.

Both halves are still true. The conclusion stopped following the day the object
header began recording whether an optional property was written, and nothing in
the refusal said which fact it depended on.

## What it becomes

The class test was already being emitted for the types that declare `k`
*always* — `is the value one of these`. A type that declares it optionally now
contributes the same test with a second conjunct: `is it a C` **and** `is C's
bit set`.

A plain `and` rather than a short circuit. `nts_presence_has_value` answers
false for anything that is not a reference, so the arm that failed the class
test cannot fault in the second — which is what lets this be two tests joined
rather than blocks the backend has to build.

## The trap, twice in one session

Deciding whether to emit a presence arm used `presence_of_key`, a **non-creating**
lookup. The class test beside it calls `layout_of`, which **creates**. So the
two arms disagreed about which types exist: an interface whose layout had not
been built when `has(given: object)` was lowered lost its arm entirely, and
`"port" in given` answered **false for an object that had one**, with nothing
emitted to say so.

There was a comment asserting this was harmless — *"such a type contributes no
comparison to the class test either"* — false about the line directly beside it.

`in_by_presence` had hit the identical thing an hour earlier, on the receiver's
own type, and it was fixed there without generalising. The rule, stated so the
third instance does not need finding: **a non-creating lookup is right where the
question is "does the program carry this" and wrong where the caller is about to
emit something that needs one.**

## What it cleared, and what that means

Two censuses over the same corpus, either side:

    the refusal                gone from the table entirely
    distinct named things      849 -> 873
    sites                      1427 -> 1443
    cascaded behind something  1416 -> 1399

**The count went up.** Twenty-four functions that stopped at this refusal now
walk further and reach their real reasons: `a union whose members lay their
fields out differently` rises 38 to 57 and takes the top of the table.

That is the chokepoint moving rather than the axis, and `README.md` already
warns about exactly this — a refusal count and a *lowered* count are different
currencies and do not convert. It is why the ranking that sent me here said 24
things over 41 sites in 17 modules and why the honest report of the result is
"the question is answered", not a number that went down.

## Why this was not the earlier row

The receiver's-own-type `in` landed the same day and moved this item by **zero**,
which I measured and reported at the time. They are different lowering paths:
one asks the type in the declaration, the other walks every type the program
has. Two rows that read as one question, and the site count belonged to the
second.
