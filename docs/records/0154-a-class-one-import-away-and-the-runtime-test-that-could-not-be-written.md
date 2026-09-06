# A class one import away, and the runtime test that could not be written

Two results, opposite in kind, from one afternoon in the same corner.

## The class one import away

    chunk instanceof Buffer
    NTS1001 an `instanceof` against something this compiler has no class for

`Buffer` is `runtime/node/buffer`'s class. It has a layout, a descriptor and a
constructor, and the module using it is one `import` away.

`lower_instanceof` resolves its right operand through the **symbol** the class
declares, deliberately — "two modules may each declare a `Point`, and a name
would pick whichever the map happened to hold". That is right, and it was asking
the wrong symbol. A reference to an imported name resolves to a symbol declared
at the **import site**, and a class's type is filed under the *declaration's*. So
the search of the type table found nothing and the refusal reported a missing
capability.

`denoted_symbol` already existed for exactly this, one hop, used by every read of
an imported value. One line:

    let symbol = self.denoted_symbol(symbol);

**18 sites in `runtime/node`, and 46 occurrences.** The reproduction is four
lines — a class in `box.ts`, `v instanceof Box` in `main.ts` — which is how it
was found: not by reading the pass, but by asking why a list of refused
`instanceof` right-hand sides contained `Buffer`, `Socket`, `Stats` and `URL`,
which are classes this compiler lays out.

The total refusal count fell by six, not by forty-six. That is the expected
shape and worth saying: code that now lowers reaches gaps further in.

## The runtime test that could not be written

`Array.isArray` of a value whose type is open is 32 sites, and its refusal said:

    which needs a runtime tag

I built the tag. An erased value carries a reference tag, a header carries a
descriptor, and `NtsDescriptor::kind` separates an array from an object already —
so `nts_is_array` is four lines. The one wrinkle is a **heterogeneous tuple**,
which is a struct here and an `Array` in the language, and that needed a
`NTS_KIND_TUPLE` that costs nothing: every existing read of `kind` asks
`== MAP`, `== ARRAY`, or falls to a `default` answering `NTS_TAG_OBJECT`, and
the object answer is right for a tuple in all three. Layout gained an
`array_like`, `same_shape` compared it, both emitters rendered it. It built.

Then I wrote the two-line fixture it would have to answer:

    const plain: number[] = [n, 2];
    const typed = new Float64Array(2);

    static const NtsDescriptor nts_desc_double = { NTS_KIND_ARRAY, ... "double[]" ... };

**One descriptor.** `number[]` and `Float64Array` are the same representation
here — `Managed(Array(Float { bits: 64 }))`, one static, one address — and node
answers `true` for the first and `false` for the second. The element type does
not separate them either: `elements` narrows an integer-only `number[]` to `i32`,
which is also `Int32Array`.

So the whole of it came out again. `array_like`, `NTS_KIND_TUPLE`,
`nts_is_array`, the emitter arms, the `same_shape` parameter. A flag nothing
reads is scaffolding, and the standing rule against it is what made the decision
rather than sunk cost.

What is left is the honest refusal, which now names the cause:

> `Array.isArray` of a value whose type is open -- a runtime test can see that
> it is an array and cannot see whether it is a *typed* one, because `number[]`
> and `Float64Array` are one representation here and node answers differently
> for them

and a row in §16, which is where a fact the checker knows and the IR drops
belongs. It is the first row there that is a **representation** loss rather than
a carriage loss, and the distinction is the section's own: carriage is bounded
work with a known answer, and this is a change to what `ManagedType::Array`
means.

### Why the old message mattered

*"Needs a runtime tag"* is a sentence that reads like a plan. It says what to
build, it is plausible, and it is wrong — the tag exists and is not the
obstacle. Anyone picking that row up would have built what I built and found
what I found, which is the argument for a refusal naming the cause rather than
the remedy. Two hours, and the only thing that separated the plausible answer
from the true one was writing the two-line program and looking at the C.

Same species as the two false ledger rows in 0153, one turn earlier: a claim in
prose about what the compiler cannot do, with nothing comparing it to what the
compiler does.

## Ratchets

- `examples/cross-file-class` — three exported functions added, 174 cases
  against node on C, LLVM and under counting: `instanceof` against an imported
  class, against its imported **base** — which is what separates following the
  alias from finding any type of that name, since the hierarchy has to relate
  two symbols from one module after the hop — and the negative.
- `compiler/core/tests/hir_lowering.rs` — `instanceof_follows_an_import_alias`,
  two halves. Dropping the hop fails it with the three refusals.
- `tooling/memory/cases/imported-instanceof` — 0 / 0, argued before measuring.
  `instanceof` reads a header field and compares a pointer: it takes no
  reference to its subject, and a lowering that did would read non-zero here
  while still agreeing with node.
- **No benchmark row.** `benches/cases/instanceof` already times the operation,
  and an imported class emits the same operation: byte-identical C for the two
  programs except `static` on the constructor, which is an export question and
  not this one's. Measured, not asserted.
- `docs/conformance/typescript.md` §4 — the `instanceof` row says imports work
  and that they did not; a new ✗ row names the three separate reasons a
  natively-represented right-hand side is refused, because naming them together
  would hide all three. §16 gains the representation row.
