# Tightening a rule drops what it was covering by accident

A `for...of` over a generator resumes the frame, and the resumption is a
separate top-level function named after the generator. The walk had to name it,
and it took the name from the call that produced the frame:

```rust
let made_here = match &self.values[value.0 as usize].kind {
    OpKind::Call { callee: Callee::Direct(name), .. } => Some(name.clone()),
    _ => None,
};
```

That is wrong, and it is wrong in the way that is hardest to see: it reads as a
statement about generators and is a statement about *calls*. Any direct call
matches. So a plain function that merely hands a generator back —

```ts
function relay(n: number): Generator<number> { return upTo(n); }
for (const v of relay(3)) …
```

— named `relay__resume`, which nothing declares. It refused rather than
mislinking, and the diagnostic said `relay__resume`, so it named its own
mistake. That part went well.

## The fix, and what the fix cost

`OpKind::Call` records that a call was direct. It does not record what the call
*called*, and those are different questions. The site that lowers a call does
know — it reads the callee's declaration out of `self.generators` to decide the
result type — so the fact was recorded there, in a set of "values that are a
generator frame this site made", and the walk consults the set instead of the
op.

That is the right shape. It also **broke two things the loose rule had been
getting right**, and the gate caught it:

```
a fixture is measuring less than it says:
  a-generator-method refuses 4 and is not in tooling/gate/example-refusals
```

`new Counter().named()` is a generator method, and `for (const v of counter)`
is an implicit `[Symbol.iterator]()`. Neither is a plain call, so neither goes
through the site I had taught. Both fell to the dispatch path and refused.

Three places produce a generator frame, and each reaches the declaration its
own way: a plain call through `call_targets`, a method call and an implicit
`[Symbol.iterator]()` through `member_declaration`. I had taught one.

## The shape

This is the opposite end of [0305](0305-the-comment-stated-the-general-rule-and-the-code-did-not.md)
and worth having both written down.

|  | there | here |
|---|---|---|
| the loose rule | stated correctly in the comment, never implemented | implemented, and too loose to be true |
| what it did | missed cases it should have caught | caught cases it had no right to, and one it got wrong |
| the fix | implement the general rule | replace it with a precise one |
| the cost | none | the precise rule was **partial** |

**A loose rule can be right by accident over most of its domain.** Replacing it
with a correct one is not a strict improvement until the correct one covers
everything the loose one did — and the list of what it covered is not written
anywhere, because nobody enumerated it when the loose rule was written. It was
`OpKind::Call`, so it silently covered every producer of a call.

So the question to ask when narrowing a rule is not "is the new rule right"
— it was — but **"how many producers does the old rule's domain contain, and
have I taught all of them?"** Three, and I had taught one, and the arithmetic
was available before the gate ran.

## What made it cheap

`example-refusals` measures a number nobody would look at otherwise. `nts check`
exits 0 when an exported function refuses, so `examples/a-generator-method`
went on reporting *agreed on every case* with four of its five functions gone.
The step that failed is the one that counts refusals per fixture, and it failed
on the count rather than on the answer — the answers were all still correct.

Related: [0302](0302-one-placement-wrong-three-ways.md) is the same arithmetic
one layer down, and the memory `the-narrower-derivation-asked-the-general-question`
is the case where the general rule was the right one all along. Here it was not;
it was merely broader than the thing that replaced it.
