# The walk listed four kinds, and a getter is not one

    get n(): number | undefined { return c ? this.n : undefined; }
    NTS1001 `null` or `undefined` where what it stands in for is not a reference

    n(): number | undefined { return c ? this.n : undefined; }
    compiles

Same body, same return type, same class. 59 occurrences in `fs`, the
sixth-largest lowering root by distinct things.

## The message names a condition it does not have

"where what it stands in for is not a reference" sends a reader to widen a
representation. There was no representation. `lower_absent` asks
`contextual_type`, which walks to the enclosing `return` and then to
`enclosing_callable` — which listed

    FUNCTION_DECLARATION | METHOD_DECLARATION | ARROW_FUNCTION | CONSTRUCTOR

and not `GET_ACCESSOR`. So the walk went **past** the getter, found nothing, and
`undefined` had nothing to stand in for at all.

The Node lane's three controls are what placed it, and each says what the defect
is *not*: the same body as a method compiles, so it is not the union; a getter
that never mentions `this` refuses too, so it is not the receiver; a `string`
getter refuses identically, so it is not that the target is a non-reference —
which is what the message claims.

That last one is the useful shape. **The message asserted a condition, and a
one-line control falsified the assertion while the defect stayed put.** A
diagnostic is a hypothesis about its own cause.

## Omitting a kind is not the same as answering nothing

A getter nested inside a method would have taken **the method's** return type —
a wrong answer rather than a missing one, silently. That is why the repair is at
the walk rather than at the refusal: `lower_absent` could have been taught to
give up more gracefully, and the wrong-answer case would have survived it.

`SET_ACCESSOR` and `FUNCTION_EXPRESSION` are added with it, for the same reason
and without a site demanding them.

## The list forty lines up was already right

`first_this` spells `FUNCTION_EXPRESSION | FUNCTION_DECLARATION |
METHOD_DECLARATION | CONSTRUCTOR | GET_ACCESSOR | SET_ACCESSOR |
CLASS_DECLARATION`. One file, two lists of "what is a callable", and this was
the short one.

Third time in two days: `erasable` and `erased_tag` drifting apart over
`ManagedType::Table`, `class_names` and the wrapper disagreeing about what is
more than its fields, and now this. **A predicate written twice will differ, and
the one with fewer cases is the one nobody tested.** Neither of these two has a
test holding them together; the erasure pair now does, and that is what it cost.

## Checked by pairs, because a fixture of getters alone proves nothing

`examples/getter-returning-undefined` has seven exports and every getter is
paired with a method of the same body. 203 cases, all agreeing with node.

A fixture of getters only would pass on a compiler that got getters and methods
wrong in the same way — which is exactly the state a representation bug would
produce, and exactly what the original message claimed was happening.
