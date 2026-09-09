# The member the literal matches

An object literal contextually typed by a **union** now takes the union member's
type rather than its own.

That one line closes a silently wrong answer and the largest refusal in front of
this profile, and the two turn out to be the same thing.

## What was wrong

A union of object types erases, so `contextual_type` answered `Erased` for
`options: Optional | Listener | undefined`, the filter rejected it, and the
literal fell back to `type_of(id)` — its own checker type.

    interface Optional { limit?: number }

    { limit: 19 }   one f64 at offset 0
    Optional        one NtsValue at offset 0, because the absence is a tag

Assignable in TypeScript and two different structs here. The object went into the
erased slot as one shape and `unerase` read it back as the other, trusting the
static type.

    f({ limit: 19 })!.limit ?? -2      node 19      nts -2

The Node lane's `agreement.mjs` shows it without the `??` softening it:
`4.26722180037931e+115`, which is eight bytes of tagged value read straight as a
double.

## The scope is wider than "an optional field"

Their six variations moved one thing at a time, and the one that mattered most
was not the one I had:

    interface Mixed { a?: number; b: number }
    { b: 7 }, read back.b      compiled 0      node 7

**A required field, reading zero.** So it is not that an optional field is wrong.
A struct containing *any* optional field is laid out differently from the
literal's, and every field read through the erased slot is wrong, required ones
included. Their string case segfaulted rather than answering, which is what a
pointer-shaped field does when a tag is read as the pointer.

Ten number-and-string seams and seven layout seams agreed on their sweep, so it
is neither general to erasure nor general to layout. It is this.

## Why the same line fixes `options = {}`

`{}` erases for a different reason: in TypeScript it is every value except
`null` and `undefined`, so its *type* is `Erased` while its *value* is still an
object. The first attempt allocated it at the anonymous empty layout and erased
that — which made `net.createServer` and `http.createServer` compile, and made
the hole above **reachable**, because `opts` then held an empty struct that the
same `unerase` read as `Optional`.

That was reverted before it left the tree. A refusal is worth more than a wrong
answer, and 332 test files of wrong answer is a worse position than 332 of
refusal.

Taking the union member fixes both, because `{}`'s keys are a subset of
`Optional`'s and it allocates an `Optional`. One rule, two symptoms, and the
symptom that looked like the work was the one that was not.

## The rule, and what it declines to do

The member whose declared property names **cover** every key the literal writes —
covers, not equals, since a literal may omit an optional property, which is
exactly what makes `{}` match.

**One member or none.** Two members that both cover the keys is a choice this
cannot make on names alone, and guessing would put the wrong layout in an erased
slot, which is the defect rather than the fix. Six literals across the tree still
refuse for that reason and are left refusing.

## The control was the case

The example pairs every shape with its opposite: required against optional, a
literal through a nullable pointer against one through an erased slot, the
sentinel with an object, a function, and nothing. 290 cases, all agreeing.

The first version of this example had one control in it and that control is what
disagreed — the case passed. Then the Node lane's variations found a required
field answering zero, which none of my controls covered. **Both times the thing
that moved was a case nobody had written, and both times it was found beside a
change rather than by looking for it.**
