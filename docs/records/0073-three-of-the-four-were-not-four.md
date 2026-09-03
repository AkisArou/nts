# 0073 — Three of the four, and one of them was already done

§2 of the conformance table had four `✗` left. This closes three, and the
fourth is refused on purpose.

## `for...of` over a string was not a gap

It works, and it works *correctly* — `for (const c of "a😀b")` yields three
elements, not four, and the middle one is two units long. It agrees with node.

Nothing was written for it here. Something implemented it and the row was never
updated, which is the third stale claim in three records: 0071 found a comment
saying `Error` could not be constructed, 0072 found one saying `new Promise<T>`
poisoned a file's other promises, and this is a `✗` on a feature that ships. The
pattern is worth naming: a note about a limitation outlives the limitation, and
the next person budgets for work that is already done.

## A label is matched by text, because it is not a binding

`outer: for (…) { break outer }`. The label is not a construct of its own: it
names the loop written under it, so the loop takes the name when it pushes what
`break` searches, and everything else is the same jump to the same block with a
different one of them chosen.

The checker gives a label **no symbol** — it is not a binding — so there is no
id to match on and the name is matched as text. Nesting is what makes that safe:
the innermost loop carrying the name is the one the name refers to, which is
what a reverse search finds.

A label on anything other than a loop or a `switch` is refused. `outer: { …
break outer … }` is legal — a labelled block, whose `break` is a forward jump —
and it wants a breakable with an exit and no latch, which is not a shape this
builds. Refusing it also keeps the pending-label slot honest: with nothing
between the label and the loop, the next construct to push is always the one the
label was written on, so a name cannot land on a loop nested inside something
else. The first version cloned the label instead of taking it, both loops took
the same name, and `continue outer` continued the inner one — all 29 differential
cases disagreed, which is the failure being loud rather than quiet.

## `{ a: b }` and `{ a = b }` are the same two identifiers

The encoder gives a binding element its *fields* and no tokens, so there is no
`=` to look for:

    `{ a }`        [name]
    `{ a: b }`     [property, name]
    `{ a = d }`    [name, default]
    `{ a: b = d }` [property, name, default]

Two children with two identifiers is ambiguous, and the only thing telling them
apart is which name the element **declares**. That question has an obvious form
and the obvious form is wrong: the checker records the declaration as the
*binding element*, not as the identifier inside it. Asking whether the
identifier's symbol lists the identifier answers `false` for every rename — and
every rename in `examples/destructuring` then lowered as a property with an
expression for a default, so `{ x: across, y: down }` reported "`down`, a name
from an enclosing scope". The example caught it; the unit tests did not.

A nested pattern declares no symbol either, so `{ inner: { name } }` needs the
second half of the rule: a pattern binds too. That one the example caught as
well.

### Only `undefined`, and only where `undefined` fits

A default is not `??`. `{ a = 5 }` where `a` is `null` keeps the `null`. So this
does not reuse `absence_of`, which tests for both — it tests the tag against
`undefined` alone for an erased read, and for a *reference* read, where one null
pointer stands for both absences and the representation cannot tell them apart,
it asks the type: exact when the property can only be missing, refused when it
can also be `null`.

Where the representation has no room for an absence at all, the default is not
emitted. Not folded away later — never lowered, because the language says a
default is evaluated only when the value is missing, and this one never is.

## What writing the test cost, which is the useful part

Three attempts at a test for an optional property failed on *unrelated* gaps
before one worked: an optional `number` field cannot hold `undefined` at all,
and a conditional between two object literals produces an erased value that will
not go into a declared type. Neither is about defaults. It took a factory
function with two `return`s to get an `Options` whose `name` is sometimes
missing.

That is worth writing down because it is a fact about the compiler's *shape*: an
optional reference field is easy to consume and hard to construct, so a feature
that reads one is easy to get wrong and hard to notice.

## The bug the example found, which was not about defaults

`examples/destructuring` needed an object with an *optional reference* field to
have anything to default. Adding one made the gate's `llvm-rc` step fall from 86
to 85, and the program **segfaulted** — inside the collector's own walk:

    nts_release            <- reading 0x7fd40000000b as a pointer
    nts_each_reference
    nts_release_contents
    nts_destroy
    nts_release            <- the program releasing an `Options`

It reproduces with no default anywhere near it, so it is not this feature's bug.
It is older, and it was invisible because no example had the shape.

A descriptor carries two tables. `offsets` holds slots read as `NtsHeader *`;
`erased_offsets` holds slots read as `NtsValue`, a tag beside a payload. A
`name?: string` field is the second kind — and **both backends put it in both
tables**, because both built the pointer table from `may_hold_a_reference()`,
which an erased slot answers yes to. So the walk visited the slot twice and read
the tagged value as a pointer the second time.

The fix is one predicate with one name, `HirType::holds_a_pointer`, used by both
descriptor emitters — the same shape as the `costs_nothing`/`counted_here` split
in 0071, and the same lesson: two places deciding one question will eventually
disagree, and the way to stop that is to make it one question.

The object has to be on the *heap* for this to fire at all. A frame object has
no destructor, so its fields are given back by code the compiler emits rather
than by the runtime reading a descriptor — which is why every existing case with
an optional reference field missed it, and why the regression test is
`examples/destructuring` under the gate's `rc` and `llvm-rc` steps rather than a
memory case. A memory case was written and *not* committed: its honest floor is
nine operations, the teardown, and it measures thirty-seven. The suite refuses a
case above its floor, which is the ratchet working.

## `for...in` is refused, and stays refused

It is the one `✗` left in §2. The node profile — the code this compiler exists
to compile, and the list the queue is ordered by — contains **zero** of them.
Ordering it ahead of anything with a use would be ordering by what looks
incomplete rather than by what is needed, which §16 says not to do.
