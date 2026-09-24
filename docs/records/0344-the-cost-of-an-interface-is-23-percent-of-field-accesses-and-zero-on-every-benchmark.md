# The cost of an interface is 23% of field accesses, and zero on every benchmark

The two largest lowering families — a class passed where an interface is wanted,
and the intersection/erasure family — both wait on one question: what an
interface's representation is when both an object literal and a class instance
can inhabit it.

Nine cheaper answers have been built, measured and reverted. Records 0258, 0259,
0294, 0310 and 0331 are five of them. `blockers/method-syntax-in-an-interface`
lists the rest and rules on what is left:

> **Indirection** — pass the object with an offset table, or read fields through
> an accessor rather than a fixed offset. It is the only option in this list that
> does not have to choose between correctness and coverage, and it is also the
> only one that costs something on every field read rather than at a boundary.

And the narrow version — indirection only where a class could actually inhabit
the interface — is not implementable, because it needs the set record 0294 ruled
out: *"**And it needs a set nobody has.**"*

So the implementable rule is the broad one and its price is every field access
through an interface. Asked whether that price was acceptable, the answer was
"whatever is best for correctness and performance" — which cannot be known
without the number, and the number was in no dump. This record is the number.

## The instrument

`nts receivers <tsconfig>`, `--sites` for the detail. Snapshot-only, beside
`nts erasure`, which is the same kind of instrument for the same reason: it
exists *before* the representation, because the numbers decide whether the
design is right.

The unit is stated with the number, because this ledger keeps paying for ones
that travel without it:

> **One field access — one place a compiled program computes a field's offset and
> touches it.**

Population: every such place in the program, **including inside functions the
compiler refuses**. That inclusion is why it reads the snapshot and not the HIR,
and it is the first thing the blocker asked for that turned out to be wrong: it
asked for "a temporary counter in the lowering". A counter there would have
failed twice. Lowering erases the fact — `OpKind::FieldGet` keys by slot index,
so `nts hir --prepared` prints `field.set %2.0` and interface-ness is already
gone — and lowering only ever sees code that compiles, so it would have been
blind to the 77 refused sites that are the entire reason the question is open.

## The number

| | field accesses | through an interface | |
|---|---|---|---|
| `runtime/node`, 185 files | 17,521 | **4,174** | **23.8%** |
| the same, through types this program lays out | 15,681 | **4,174** | **26.6%** |
| `benches/cases`, 61 cases | 694 | **10** | **1.4%** |

**The share is bracketed, not picked.** 1,840 accesses go through a library
receiver, and a library receiver is two different things that nothing here can
separate: `Math.PI` reads no slot this program lays out, while a
`PropertyDescriptor` inhabited by an object literal we built reads at a fixed
offset and would become indirect. A symbol with no declaration in the decoded set
says nothing about which. So both denominators are printed and the answer is
**between 23.8% and 26.6%** — the same discipline as the inhabitability arms.

Reads, writes and compound assignments together, because `FieldSet` goes through
the same offset. A spread is held on its own row, because one `{ ...v }` is *N*
reads rather than one access: 56 sites carrying 635 further field reads in
`runtime/node`, 619 of them through an interface.

## Three findings, none of which was the question

**1. No benchmark would detect the cost.** 57 of the 61 cases have zero interface
field accesses. Every hot loop is zero — `fib`, `loop`, `json-parse` with 127
field accesses of its own, and all seven `awfy-*` rows. The four that have any are
`in-narrowing` (3 of 3), `json-stringify-doc` (3 of 66), `node-utf8` (2 of 2) and
`optional-chain` (2 of 2).

This is a finding about the benchmarks, not a licence. **"The benchmarks did not
regress" could not be evidence that indirection is free**, because no row
exercises the construct. A row that reads a field through an interface in a loop
would have to be written first. `node-utf8` is where to start: `benches/README.md`
calls it the only case that is real code rather than a probe, and it is 2 of 2.

**2. The broad rule's waste is 4x to 26x its useful work.** Of the 4,174, **158**
are through an interface some class names in an `implements` clause, and at most
**883** through one whose required members any class in the program covers by
name. 344 interfaces carry the accesses, and the heaviest are records and options
bags that no class can inhabit: `UrlRecord` 158, `URLRecord` 154, `Key` 144,
`StoredCookie` 132, `Context` 111, `TransportRequest` 96.

Neither of those two is the real relation and neither is implementable — the
first misses a structural satisfier, the second compares names and not types, and
0294 still rules out the complete set. They bracket the argument rather than
settling it. But **the bracket says the set a narrow rule needs is small**, and
that is a different question from the one 0294 answered: not "can the complete
set be had" but "is a sound over-approximation of a few hundred interfaces
reachable". That question did not exist before these numbers.

**3. The `schema.rs` comment on `node_types` is stale, and it was load-bearing.**
The census keys on receiver expressions, which is only sound if a receiver
reliably carries a type. `schema.rs` says of `node_types`: *"Sparse on purpose:
only nodes the lowering actually needs a type for are queried"* — which would make
the census undercount **in proportion to what the lowering happened to ask
about**, an instrument whose error correlates with its subject. `resolve_types`
says the opposite: *"Resolve a type for every addressable node of one file"*,
excluding only list nodes and an `import.defer` callee.

Rather than believe either, the census counts the disagreement:
`Excluded::untyped_receiver` reads **0 across 184 files**. The comment is wrong,
and `every_receiver_carries_a_type` is the test that would fail first if the
frontend ever narrowed what it resolves.

## What the counting rules cost

Each mirrors `hir::lower`'s own derivation, cited beside it, because two
derivations of one fact disagree. Four of the five were found by a number being
wrong, not by reading:

- **`this` is a type parameter constrained to its class.** The first run reported
  7 field accesses and 0 writes for `examples/a-structural-cast-that-is-a-prefix`,
  whose three constructors write five fields between them. The numerator was
  right and the **denominator** was short by every `this`, which inflated the one
  percentage the census exists to produce: 42.9% where the answer is 25%. Fixed by
  following the constraint, which is what lowering does.
- **A symbol key is spelled `__@kRefed@2`.** Found by the undeclared-member row
  rather than by inspection: `examples/symbol-keys` read 4 accesses with **9
  undeclared**, against a fixture whose entire subject is symbol keys. Now 13 and
  0. Across `runtime/node` that row fell from 166 to 1. Mirrors
  `symbol_property_name`, including its refusal to resolve when two symbols share
  one description.
- **A literal key is a field.** `names_a_property` routes `v["name"]` into
  `lower_property_access`, discriminated by the index's *type* and never its
  text — the rule whose inversion once refused `Buffer.from` and under it the
  whole of `string_decoder`.
- **Destructuring and spread have no property-access node.** `const {a,b} = v` is
  two accesses and zero such nodes.
- **`MemberKind::is_stored` decides storage, not the type.**
  `describe(): string` and `describe: () => string` declare members of the same
  type and only the second is a field. 2,300 excluded on this.

**And the honesty row found the instrument's own defect, which is what it is
for.** `unclear` — receivers whose type the decomposer had not reached — read
**305**, and not one of them was an undecomposed type. They were **module
namespaces**: 170 `zlib/src/constants`, 54 `fs/src/async`, 44
`fs/src/constants`. `names_a_property` states the rule the census had missed —
*"A module's member is not one: there is no receiver, so a call through it is a
plain call and an access is a plain name"* — so `constants.Z_OK` resolves a name
at compile time and loads no slot. The denominator was inflated by 305 accesses
that never touch memory, and the first figure published was 23.4% where it is
23.8%.

They are excluded now and **`unclear` is zero**, which matters more than the
digit: the census has no open bucket left, so what it cannot account for is
nothing rather than 1.7% of its own subject. The numerator never moved, because a
module is not an interface.

What remains reported-rather-than-rounded is the lower arm's blind spot: 17
interfaces whose declared type carries no member list, which is the thing that
decides whether that arm is a bound at all.

## Verification

Two examples with different hand-counted answers, because a check whose answer
does not depend on its input is not a check:
`examples/a-structural-cast-that-is-a-prefix` at 3 interface reads, 4 class reads
and 5 class writes with the four `.length` accesses excluded, and
`examples/interface-dispatch` at **0** against a 20-access denominator with 21
method members excluded. The second is the one that matters: `Holder.sink` has an
interface *type* and `this.sink` is a field read whose **receiver** is a class, so
a census that put it in the numerator would be answering about the result's type
instead of the receiver's.

Then 13 tests over a two-file fixture — two files because an import names an alias
carrying none of the declarations the interface test reads — and five sabotages,
each failing the test that guards it: any-object-is-an-interface, no `is_stored`
gate, no element accesses, no `this` constraint, no destructuring.

The corpus was bracketed against a binary pinned before the edit, itself checked
for provenance by confirming it does **not** know the `receivers` command. The
`NTS[0-9]{4}` counts and refusal lines are identical across all 26 modules, which
is what a change that adds a subcommand and touches no lowering owes.

## What this does not do

It does not build indirection, and it cannot settle whether the cost is
affordable — that is a benchmark question about a feature that does not exist,
and finding 1 says the benchmarks could not answer it today even if it did. What
it produces is the cost, the share of it that is provably wasted, and the
observation that the design step's next question is narrower than 0294 left it.

The corpus was 184 files at the first run and 185 an hour later, **both totals
unchanged**, and the figures are identical after an unrelated `SCHEMA_VERSION`
bump invalidated every snapshot cache. That is the evidence that the number is a
number rather than a reading of one afternoon.

Landed as `ff468115`.
