# I optimised the check and the cost was two calls beside it

The performance contract says to benchmark deterministic computation once
correctness stabilises. It has, so I did, and the first two typed-array rows
disagree with each other:

    case          C++      nts C    nts JVM       Java       node    jvm/Java
    elementwise  153.6us   149.5us    61.2us     58.8us    932.2us      1.04x
    bytes        444.7us   468.7us   952.4us    681.2us    509.9us      1.40x

`elementwise` is 1.04x hand-written Java and fifteen times node. `bytes` is
1.40x Java and 1.8x node — on a lane where the C backend beats node.

`bytes` is Adler-32: 262,144 `Uint8Array` reads. Record 0182 had already
measured a view read at 0.823 ns/element against 0.177 for a bare array and
found the difference *was* the bounds check. So the diagnosis wrote itself: the
accessor re-checks the range, a bare array gets the JVM's own check, and C2
eliminates that in a counted loop. Trade a check the JIT cannot remove for one
it can.

I built it. Nine unchecked readers, wired to `ArrayGet { checked: false }`.

    before   952.38 us   1.40x Java
    after    926.13 us   1.41x Java

Nothing. And then the reason, which is worse than the number:

    total unchecked sites across the corpus: 0

**`checked: false` never occurs for a typed array anywhere.** Every indexed read
in the corpus is written `data[i]!`, and the `!` is the author asserting what the
compiler could not prove — which is exactly what makes it `checked: true`. I had
added a fast path for a case the language's own idiom prevents.

## What the cost actually is

Reading the emitted loop rather than reasoning about it:

    invokestatic nts/rt/NtsView.elements   (NtsView)I
    invokestatic nts/rt/NtsRuntime.bounds  (ID)I
    invokestatic nts/rt/NtsViewU8.getInt   (NtsViewU8;I)I

**Three calls per element**, where a bare array is one `baload`. Two of them are
the subscript, not the accessor:

- `elements` recomputes the element count *per access*. For a tracking view it
  reads the buffer's length and shifts; for a fixed one it is a field. Either
  way it is a call inside the loop.
- `bounds(I, D)` — the `D` is the giveaway. The index arrives as a **double**,
  so `view_subscript` takes the path meant for a possibly-fractional index,
  which exists because `xs[0.5]` is `undefined` in JavaScript. It takes that
  path even in `run$whole(int)`, the specialised variant.

The accessor's own range test — the thing I spent an afternoon removing — is the
third of three, and the cheapest, because it is the one C2 can see through after
inlining.

## What I did wrong, precisely

Record 0182 measured a *microbenchmark of the runtime* and correctly attributed
its cost. I carried that attribution to a *compiled program* without
re-measuring, and the compiled program has two costs the microbenchmark does not
have, because the microbenchmark called `getAt` directly and never went through
a subscript.

A measurement is about the thing measured. I treated it as about the mechanism.

The revert is the whole change; nothing of it survives.

## Then I was wrong twice more, which is why this stops here

**"The specialised variant carries `f64` loop counters, and that is why the
subscript takes the double path."** True of `bytes`. Also true of
`elementwise` — every block parameter there is `f64` as well, and it runs at
1.04x Java. Not the discriminator.

**"Then it is the view path itself."** So I built the control: the same
Adler-32 with `number[]` instead of `Uint8Array`, same lane, same harness.

    Uint8Array   838.80 us/op
    number[]    2882.85 us/op

The view is **3.4x faster than the alternative it replaced**, for the reason the
case's own header gives and which I had read without using: a `number[]` is a
`double[]`, so 4096 elements are 32 KB where the typed array is 4 KB, and one
fits in L1. The representation is not the cost. It is paying for itself
enormously against the only other thing a program could write.

So the 1.40x is against **hand-written `byte[]` with `baload`**, and that is the
whole of it. Three hypotheses, three refutations. What is established and worth
carrying forward:

- the accessor's internal range test is not it (measured, reverted)
- the index kind is not it (both rows are `f64`)
- the representation is not it (3.4x in its favour)

Whoever picks this up should profile the emitted loop before changing anything.
I spent an afternoon on three guesses that one profile would have ordered
correctly — which is the mistake the top of this record is about, committed
three more times after writing it down.
