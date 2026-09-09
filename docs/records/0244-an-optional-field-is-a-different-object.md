# An optional field is a different object

    interface Optional { limit?: number; }
    type Listener = (n: number) => void;

    function throughAnErasedUnion(
      options: Optional | Listener | undefined,
    ): Optional | undefined {
      const opts = options;
      if (typeof opts === "function") return undefined;
      return opts;
    }

    throughAnErasedUnion({ limit: 19 })!.limit ?? -2

    node  19
    nts   -2

**A silently wrong answer, on a program that compiles clean.** No `{}`, no
refusal, nothing in the diagnostics. It reproduces on a compiler with every
change of this session reverted, so it is not new — it is what nobody had
written a case for.

## The two objects are not the same shape

`Optional.limit` is *optional*, so its field is `Erased`: the absence is a tag,
and a fresh allocation's zero is already `undefined`. The literal `{ limit: 19 }`
has the checker type `{ limit: number }`, whose field is a plain `f64`.

Assignable in TypeScript, and two different structs here. The union parameter is
erased, so:

    %5 = object.new : managed<{limit: f64}>     one f64 at offset 0
    %6 = erase %5
    ...
    %8 = unerase %7 : managed<obj#1>            one NtsValue at offset 0

`unerase` trusts the static type. The read takes eight bytes of double as a
tagged value, the tag is nonsense, and `?? -2` supplies an answer that `typeof`
agrees with.

**Controlled three ways.** The same program with `limit: number` *required*
agrees with node — so it is the optionality and not the union. The same literal
through a parameter typed `Optional | undefined`, which is a nullable pointer
rather than an erased slot, agrees — so it is the erasure and not the literal.
And it needs no empty object literal anywhere, which is how it was separated
from the change that found it.

## How it was found, and what that says about the search

It was found by *fixing something else*. `options = {}` — node's sentinel for
"no options were passed" — refused as "an object literal that is not an object",
because `{}`'s type erases while its value is still an object. That refusal is
under `net.createServer` (91 of net's 148 failing files) and `http.createServer`
(241 of 405), the largest concentration the Node lane has measured.

Allocating the empty literal and erasing it made those compile — and made **this
hole reachable**, because `opts` then holds an empty layout that the same
`unerase` reads as `Optional`. The change was reverted. A refusal is worth more
than a wrong answer, and that trade is the whole reason this compiler refuses
things.

So the fix for `options = {}` is not the literal. It is that an object crossing
an erased slot must come back as the shape it went in as, and today nothing
checks.

## The three ways out, priced

**Give the literal the contextual member's type.** When a literal is
contextually typed by a *union*, TypeScript picks the member it matches;
`contextual_type` returns the union's representation instead, which is `Erased`
and tells the literal nothing. Fixing that makes `{ limit: 19 }` allocate an
`Optional` and the round trip exact. It does not close the general hole — any
`erase` of A followed by `unerase` as B has it — but it closes the shape node's
code actually writes.

**Check the descriptor at `unerase`.** Every object carries one, and comparing
it turns every case of this into an abort rather than an answer. That is the
discipline this compiler states, and it is a branch on a path that currently has
none.

**Make an optional field's representation match a required one.** It cannot: the
absence has to live somewhere, and a tag is where.

The first is the one to build, and the second is what should sit under it while
the first is only true of the cases anyone has written down.

## Why no fixture

`blockers/` asserts refusals and this is not one. The `calls` form the Node lane
built asserts an expression against a loaded addon, and this program needs no
addon. An `examples/` case cannot hold it either: an example must agree with
node, and this one is here precisely because it does not.

So the reduction lives in this record, and the honest statement is that the
tree has no instrument that would have caught it. That is the finding underneath
the finding.
