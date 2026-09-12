# A bit that cost no layout

`"x" in o`, `Object.keys(o)`, `Object.hasOwn(o, "x")` and `for (const k in o)`
all refused on a type with an optional property. Four refusals across three
ledger rows, and one missing fact behind them: an optional property's slot
exists whether or not anybody wrote it, so a struct cannot tell `{}` from
`{ x: undefined }`.

The ledger said a presence bit would answer it and called that **a layout
change for a question no program in the profile asks**. Both halves were wrong,
and neither was wrong by a little.

## It cost no layout

    NTS_TWO_BYTE 1   NTS_GROWN 2   NTS_BUFFERED 4   NTS_DYING 8
    NTS_COLOR_MASK 0x30

Bits 0 through 5 of a `uint32_t` every object already carries. **Twenty-six were
free.** No size change, no ABI change, no allocation change — `nts_object_new`
already `memset`s, so "absent" is the default for nothing.

The write is one `or` into a word the store is already touching; the test is one
`and`; a *required* property still folds to a constant with no test at all. A
class's optional fields are set by a single constant-mask store at
construction rather than one call per field, because the set is known at compile
time.

## The profile did ask, and not where I said it did

I justified this with the census's 24 distinct things over 41 sites in 17
modules and then measured, and **that item did not move at all**. It is a
different question in a different lowering path:

    "k" in o   where `o` has a type that declares `k`      <- this row, closed
    "k" in v   where `v` is `object` and some type
               somewhere declares `k` optionally           <- the 24, untouched

The second is the whole-program candidate walk: with the value typed `object` an
instance of *any* type can reach the test, so the set of classes to ask is every
class in the program. The presence bit makes each of them answerable — the test
becomes "is it a `C` **and** is `C`'s bit set" — but that is composing the bit
with the class test, which is the next piece rather than this one.

What this closed, over the same corpus, two censuses either side:

    distinct named things   850 -> 849
    sites                   1429 -> 1427

**One thing and two sites.** The feature is still right — it closes a ledger row,
and the `delete` row's soundness argument was written as resting on `in`
refusing — but a reach number quoted as a yield is the mistake this project has a
name for, and quoting it here without measuring would have been it.

## Node said the design was backwards

The first implementation followed the ledger's sentence: an optional property is
absent until written. The first run against node disagreed on three of six
functions.

    class field declared, never assigned    "maybe" in b   true
    object literal without it               "maybe" in o   false
    object literal with `maybe: undefined`  "maybe" in o   true

A class field *declaration* defines its property even with no initialiser —
ES2022 class-field semantics, which `target: ESNext` selects. Constructing a
`Box` **writes** `maybe`. An interface's values are object literals, where
nothing is written unless the literal writes it.

So the second version answered `true` from the type for any class-declared
optional property and skipped the bit entirely. Free, static, and wrong for one
program: `delete b.maybe`. JavaScript removes a class field like any other, and
no static answer can follow that. `delete_expression.rs` said so, by asserting
that a deletion reaches the runtime for nothing.

The third version is uniform. Both shapes carry a bit; they differ only in
whether *construction* sets it, which is a fact about construction rather than
about the question.

## Three tables, and only two fail loudly

Adding a runtime helper means naming it in three places:

    hir::runtime          the conversion the middle end inserts
    codegen/llvm          the declaration and its LLVM types
    codegen/c ERASES_CLASS  the `NtsHeader *` cast at the call

The C backend's has a test that derives it from the header and fails. LLVM's
refuses the call by name — `NTS3001 ... declares only as a static inline and so
exposes no symbol for`. **`hir::runtime` does neither.** Missing from it, the
`uint32_t` index was widened to a double on the way out whatever the lowering
said, and the LLVM module was rejected with `integer constant must have integer
type` — the same sentence `codegen/llvm/src/signatures.rs` opens with about
`nts_tag_name`. The lowering was correct the whole time and `nts hir` said so —
`%2 = const 3 : i32` — and only `nts hir --prepared` showed the rewrite to
`%21 = const 3 : f64`. **`--prepared` is what a backend sees**, and the default
mode prints a function no backend receives; four hours of a previous session
went into learning that and it was worth exactly one command here.

## What is checked rather than assumed

A bit is a position in **one** layout, so every type a value can be has to
number a shared property identically. Base-first layout is why a subclass and
its base do — and the lowering checks it per union rather than relying on it,
because base-first is established by a pass that runs *after* lowering and a
wrong shared bit is a wrong answer rather than a failure.

That check is **unreachable today** and is written down as such. Two arms can
only number a property differently by laying their fields out differently, and
such a union is already refused one step earlier as a pointer cast between
structs that disagree about their shared fields. Tried, and that is the refusal
that came back. The two rest on different facts, and the cast refusal is the
largest single item in the census — so the day it lifts is the day this stops
being redundant.

## One derivation, enforced

Fourteen sites pushed a `FieldSet` directly. Recording presence at each would
have been fourteen chances to forget, and a forgotten one is not a crash: the
bit stays clear, `"x" in o` answers false for a property that is there, and
nothing says so. They are now two named operations — `field_set` and
`field_delete` — which record opposite facts, and a deletion routed through the
write path emitted a set immediately followed by a clear.
