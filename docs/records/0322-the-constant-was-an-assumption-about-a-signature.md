# The constant was an assumption about a signature

`AggregateError` is now provided. The interesting part is not the class — it is
that adding a second *shape* to a list broke a check that had encoded the first
shape as a number.

```rust
// `new Error(message, { cause })`. The second argument is an options
// object whose only member is `cause`, which this compiler does not provide.
if arguments.len() > 1 {
    return Err(self.unsupported(id, "an `Error` with options"));
}
```

The comment states the rule: *the options object is the argument after the
message*. The code states a number: **1**. The two agree exactly while every
provided class takes one argument before its options, and `new
AggregateError(errors, message?, options?)` takes two — so the first legal
`AggregateError` with a message was refused as "an `Error` with options".

Counting from where the options argument actually is costs one `usize::from`.

**This is the same shape the JVM lane hit in `backend_examples` the same night**,
from the other side: prose on the line stated an invariant ("this floor equals
the corpus"), the code held a constant, and the two coincide only while the
corpus does not grow. Both are a comment that is true, a constant that is true,
and a coupling between them that nothing checks. The comment is where the
reasoning lives and the constant is what runs, and they diverge on exactly the
event the comment was written to anticipate.

## How the class was found, which was not by counting throws

`AggregateError` is thrown almost nowhere. What its absence cost was three links
away:

```text
AggregateError absent from builtin::ERRORS
  -> NodeAggregateError extends it, so has no layout
     -> `value.code` over five instanceof-narrowed arms refuses, as
        `code` on a union one of whose members has no layout
        internal/errors.ts:1256, imported by every module
```

No census row names the root. The census names the message at the **end** of the
chain, because that is where the compiler prints. `hir::builtin` had written
down that this would happen — *"a class absent from this list does not merely
fail where it is thrown; it refuses its caller, and its caller's caller"* — and
the sentence had been sitting above the list through two previous additions.

A probe ruled out the obvious alternative first: a user class carrying an array
field compiles and reads `.code` through a union perfectly well. So it was the
**base being unprovided**, not the array — which is what the `instanceof` ledger
row had reasonably guessed, and it was one guess away from being right for the
wrong reason.

## Two decisions about the field, both of which could have been silent

**Erased, not `Array(Erased)`.** The first spelling made the verifier reject the
store: `new AggregateError([new Error("x")], "m")` passes an
`Array(Object(Error))`, and an array of pointers is not an array of tagged
values. That is a per-element conversion, not a cast, and nothing at a
`field.set` is entitled to insert one. Erasing the whole array is one `Erase`.

**Stored, not omitted.** Nothing in `runtime/node` reads `.errors` — zero sites,
checked — so omitting it would have cost nothing a reader could see. Three sites
*construct* one with it. A constructor argument accepted and discarded is a
wrong answer that runs, and it is precisely what `builtin::OMITTED` cannot
express: that list names a member so that **reading** it says why it is absent,
and says nothing about writing.

The two failure modes are worth keeping apart. The first was caught by a
verifier in seconds. The second would not have been caught by anything: no
diagnostic, no crash, the same answer for every program that does not read a
field nobody reads.

## And the read had to be refused, which the gate is what established

Storing works everywhere. Reading it back does not, and the two backends
disagreed about *how*:

```text
C       compiled, and agreed with node on every case
LLVM    error: '%v87' defined with type '{ i32, i64 }' but expected 'ptr'

%v87 = load { i32, i64 }, ptr %v87.at          <- the erased field
%v88.at = getelementptr i8, ptr %v87, i64 20   <- indexed as an array
```

**One backend refused to compile and the other answered correctly by
coincidence** — and not marginally: C agreed with node on 203 cases. Every
instrument except the one that could not build it reported the feature working.

That is `agrees-on-device.sh`'s *nine comparisons none of which ran*, inverted.
There a line claimed agreement for comparisons that did not happen; here **203
real comparisons agreed about an emission that was invalid**. Agreement across
backends is not independent evidence when one backend's correctness is an
accident of representation, and no differential can see that, because it
compares answers and the answers were right.

So the read is refused by name rather than filed as a known limitation. A
limitation that three-quarters of the harness reports as working is not a
limitation anyone will remember.

The run that caught it also caught a *misdiagnosis*. Under the JVM floor's
previous constant form, `198 >= 198` would have passed and the only red would
have been the two LLVM floors — so the old instrument would not merely have
missed it, it would have pointed at LLVM. One red reads as one problem.

## The gap that remains, and it is the same one

`SuppressedError` carries `error` and `suppressed`. The premise that kept both
out was that a provided error holds `{ message, name }` and nothing else, and
that premise has now moved rather than been removed — `error_fields` takes the
class it is building. So the second instance is a smaller change than the first,
which is the usual shape and worth saying out loud: **the first member of a
family pays for the mechanism.**
