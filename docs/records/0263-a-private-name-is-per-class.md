# A private name is per class, and one slot served two

    class Base    { #count = 0;   bumpBase()    { return ++this.#count; } }
    class Derived extends Base
                  { #count = 100; bumpDerived() { return ++this.#count; } }

    node      2102
    compiled  102502

Two fields in JavaScript — that is what the `#` is for — and one slot here. The
base-first layout construction matched them by name and dropped the derived one,
so both classes read and wrote the base's storage. **28 of 28 cases disagree**
with node on an eleven-line program. No crash, no refusal, nothing in any
instrument that was not looking for it.

## It is `http.createServer`'s 274 files, two steps down

`net.Server` declares `#connections = 0`. `http.Server extends NetServer` and
declares `#connections = new Set<HTTPDuplex>()`. The types differ, so the corpus
got a refusal rather than a wrong answer:

    http/src/server.ts:154:17  a value of type Managed(Set(Managed(Object(…))))
                               where Float { bits: 64 } is wanted

That is the diagnostic behind `http.createServer` — **274 failing test files by
the Node lane's ranking, the largest single item on the compiled axis** — and it
names a `Set` where a `Float` is wanted, which is the symptom two steps from the
cause. Until this morning it was not even that: the function was reported as `a
declaration outside every walk`, which was false (record 0261).

So the top of the axis was a false message in front of a symptom in front of a
wrong answer.

## Three reductions failed, for a reason worth naming

A private field holding a `Set` of a class compiles. Of an interface, compiles.
Of an interface with method-syntax and optional members — `HTTPDuplex`'s exact
shape — compiles. None of them has a **base declaring the same private name**,
which is the precondition, and minimising deleted it three times.

That is the shape already written down as *reduction removes the precondition*.
What found it was reading `nts layouts` and seeing `#connections : Int { bits:
32 }` on a field initialised with a `Set` — the layout saying plainly what three
probes could not.

## Refused, not fixed

The fix is to give a private field a name of its own so the two slots can
coexist — `#count@Derived` beside `#count` — and that name is read back at
**twelve** `index_of` sites. The access site can compute the right one, because a
`#` member is only reachable inside the class that declares it, so the enclosing
class is the qualifier. The base's copy has to keep its index, since an upcast is
a pointer cast and base-first layout is what makes that free, so it is the
derived's that gets the new name.

Doing half of that to a defect that is currently a wrong answer would be worse
than refusing it, and the refusal is what stops the miscompile today.
`blockers/a-private-name-is-per-class` carries the reduction, the measurement and
the design.

## And the wrong answer has no agreement case, deliberately

One was written and removed. With the construct refused, the emitted addon
carries a dangling symbol and fails to *load* — which `agreement.mjs` reports as
a disagreement, alongside `node 2102`, when nothing ran at all. Its own header
says a case that did not build is counted apart; a case that did not **load** is
not, and that gap is worth knowing separately from this defect.

The measurement lives in the blocker's header instead, where a refused case
belongs by that file's own rule.
