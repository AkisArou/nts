# Three sites for one fact, and the third was missed

`async (a) => a + 1` did not work. Not partly: at all.

```text
async (a) => a + 1        emitted invalid C — (NtsPromise *)v1 on a double
async (a) => await p      a top-level `await`
```

An `async` function allocates its promise before its body runs, so that every
`return` has one to settle and the allocation happens once rather than on each
path out. `lower_function` calls `begin_async`. `lower_method_of` calls
`begin_async`. **`lower_closure` did not**, and everything above follows from
that one omission.

The second message is the one that names it. `lower_await` refuses when
`self.async_result` is `None`, because that is what module scope looks like from
inside — so an `await` in an async arrow reported a true sentence about a
different program. **The same two sentences an async generator produced the day
before**, from the same missing call, in the second of the three sites.

## Found from the far end, through a function that was innocent

The JVM lane reported four closures stored where a signature layout was
declared — `Closure754` into `Fn2029_2043__25` — and pointed at
`relate_closures_to_signatures`, which is the function whose job that is.

That function was doing its job. An async arrow's `call` answered `f64` where
the declared signature said `Promise<f64>`, so the two signatures did not match,
so no layout claimed the closure and it got no base. The missing base is the
*last* link of the chain and the only one visible from a backend.

A correct report, naming the right symptom and the wrong function, because the
reporter could not see past their own end of it.

## Three probes that proved nothing

The corpus site is `stream`'s `tap`, which returns an async arrow into an inline
signature with an optional parameter. I built three probes varying one feature
at a time from a working case — a named type alias, an inline signature, an
optional parameter — and all three passed.

**None of them varied `async`.** It was in the part of `tap` I had read past, so
it was not in the space I was searching, and a single-variable walk cannot reach
a bug outside the space it walks. Three careful experiments, correctly designed,
searching the wrong dimension.

What worked was reproducing the corpus site verbatim. The JVM lane reached the
same conclusion the same hour, from the other side: **reduce from the failing
case rather than build up from a working one.** A reduction that still fails
contains the cause by construction; an augmentation that passes has proved
nothing about what it added.

## And a description of a reduction is not a reduction

There is a second bug in this area, still open, and the first attempt to hand it
over failed on exactly this. The report said the arrow "captures". I built a
capture — of a `number` — and it passed, and reported that I could not
reproduce. The real reductions capture a value of **function type**, and in two
of three that function returns a promise.

"Captures" was true of both programs and load-bearing in only one. Four verbatim
files reproduced on the first run.

So the artefact rule has a sharper form than "send code": **a prose description
of a reduction is a hypothesis about which of its features matters**, written by
the person least able to test that hypothesis, since their program has all of
them. The reduction carries every feature whether or not the writer noticed it.

## What it was worth

`examples/an-async-arrow`, 232 cases across eight exports on C, LLVM and the
JVM. In the corpus: `a top-level await` goes **3 → 0**, and total `NTS1001`
roots move in **no** module — three cleared, three surfaced behind them. The
other spelling never occurred at all.

I predicted, in writing, that this would be the largest number of the day. It is
three. The prediction being wrong in public is the only reason it is a finding
rather than a number nobody checked — and the honest reading is that **a demand
count measured on a corpus that already routes around the gap cannot tell
"nobody needs this" from "nobody could use it"**. Every site that wanted an
async arrow was refused before it could be counted.
