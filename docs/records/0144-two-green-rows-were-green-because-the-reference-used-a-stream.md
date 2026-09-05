# 0144 — Two green rows were green because the reference used a Stream

`array-predicates` published **0.71x** against hand-written Java this afternoon,
after a fix that was real. The reference used `Arrays.stream(xs).anyMatch(...)`
and three more stream pipelines. Rewritten as the loops a person optimising
this would write:

    reference with streams   7.47 us     we are 0.71x
    reference with loops     1.18 us     we are **4.78x**

**6.3x.** The row was not measuring our codegen against a person's Java; it was
measuring it against the JVM's stream machinery, thirty-two pipeline
constructions per operation over a 256-element array.

`pipeline` had the same shape and less of it:

    reference with streams  68.24 us     we are 0.84x
    reference with loops    57.27 us     we are **1.01x**

Two rows that read green read green partly because of how the reference was
written. Both are now loops and both are red. The column goes from 25 under to
23.

## The rule, and why the letter of it did not catch this

The standing rule is *"no `Iterator<Double>` or `Stream` where the subject boxes
nothing"*, and by the letter these were fine: `Arrays.stream(int[])` is an
`IntStream` and `Arrays.stream(double[])` a `DoubleStream`, and neither boxes.
The reference even says so -- *"a person would not box them, and `IntStream`
exists so they do not have to"* -- which is correct reasoning that arrives at
the wrong reference.

The clause the letter missed is the one before it: **anything that puts a cost
in one lane only.** Boxing is one way to do that and not the only one. A stream
pipeline over 256 elements is another, and it is worth 6.3x.

## Why a loop is the right reference and not a convenient one

The TypeScript is `xs.some(...)`, `xs.every(...)`, `xs.filter(...)` -- higher
order, and a stream is the faithful Java *shape*. That argues for keeping it.

What settles it against: **this compiler inlines those callbacks.** The profile
of that row has no closure call in it, only `NtsArrayD.get`. So our lane pays
nothing for the abstraction and the reference paid 6.3x for it, and the ratio
stopped being about code generation -- which is the one thing this column exists
to isolate, and the reason it is worth having at all.

A reference that loses for a reason the subject does not have is the same defect
as one that wins for a reason the subject does not have. The second kind is
easier to notice.

## How it was found

Reading the reference while looking for something else, and remembering the rule
named `Stream` by name. The row had passed the per-family work guard, because
that catches implementations doing different *amounts* of work and these do the
same amount -- slowly.

Nothing automated would have caught it. It is the residue the audit named:
*"a reference that is simply worse code... nothing automated can catch that --
it rests on review."*
