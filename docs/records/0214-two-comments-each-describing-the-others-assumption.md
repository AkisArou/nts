# Two comments, each describing the other's assumption

`runtime/node/async_hooks` emitted this, for a call whose HIR is correct:

    void nts_node_enqueue_microtask(NtsObj_Ctor_TypeError *);
    ...
    nts_node_enqueue_microtask(v17);        /* v17 = &nts_fnval_NtsObj_Ctor_TypeError */

The HIR says `%17 = const closure.static : managed<closure#524274>`. The emitter
resolved that id to the `TypeError` **constructor token's** layout, because they
are the same id.

    fn closure_type(index: usize) -> TypeId { TypeId(u32::MAX - index) }
    pub const CONSTRUCTOR_TOKENS: u32 = u32::MAX - 15;

Sixteen ids, twice. A program's fifteenth closure had the id of `Ctor_Error` and
its fourteenth `Ctor_TypeError`; closures sixteen through thirty-one landed in
`PROVIDED_ERRORS`. `Program::layout` finds a layout by asking which one holds an
id, so it returned whichever it met first.

## The evidence was in the file, in two places, and they agreed with each other

> `closure_type`: Numbered down from the top, so it cannot collide with anything
> the snapshot assigned.

True. And not the whole question, because the top of the id space is not the
snapshot's.

> `CONSTRUCTOR_TOKENS`: At the top of the id space rather than beside
> `SYNTHETIC_CLOSURES`, **because closures are numbered upward from there** by a
> counter this cannot see: a program with enough of them would reach any fixed
> offset.

Also true — of a compiler where closures are numbered upward. Each comment is
internally consistent, each is correct about its own reasoning, and each
describes the *other's* assumption rather than the code. The repository's
standing note is that a comment outliving its condition is evidence and has
marked the spot four times; this is the first where two comments marked each
other and neither reader noticed that they could not both hold.

The assertion could not catch it either:

    debug_assert!(id >= SYNTHETIC_CLOSURES, "more closures than the id space holds")

That is the **floor** of the band. A counter descending from `u32::MAX` passes it
for half a million closures while walking straight through the ceiling it was
never asked about.

Closures are numbered upward from `SYNTHETIC_CLOSURES` now, which is the
invariant both comments assume.

### Asserted over the partition, not over a program

    #[test] fn no_closure_id_lands_in_a_reserved_band()

Four thousand closures, checked against both bands and the floor. **No
differential can see this defect**: two backends compile the lie, and the C only
failed because the emitted prototype met a hand-written header that disagreed
about the parameter type. A program that reproduces it needs sixteen closures
*and* a class used as a value — a shape nobody writes on purpose — and even then
the answers agree, because the two layouts are both empty.

An example was written, run on both binaries, and deleted: it passed on the
broken compiler.

## The half that made it visible

The prototype was generated from the *call's* argument types, so the compiler
declared `nts_node_enqueue_microtask` with whatever class the argument had.
`nts_node.h` declares it `NtsHeader *` and its comment says naming it otherwise
"is what produced the incompatible-pointer clang error in three modules".

Neither side could be changed to match the other: a hand-written binding cannot
name `NtsObj_Closure14`, because that name is invented per compilation, and the
call site cannot know the binding. So an object crossing to a binding the
compiler declared itself is `NtsHeader *` in both the prototype and the call.

`async_hooks` and `diagnostics_channel` go from two clang errors each to zero.

## What else came out of one file

`runtime/node/internal/errors.ts` is imported by twenty-one of the twenty-two
node modules, and `determineSpecificType` is a `switch (typeof value)` under
every argument check in the profile. Each arm is its own narrowing and each was
its own refusal.

**`typeof v === "bigint"` on an `unknown` is false, not unrepresentable.** There
are eight tags and none is a bigint; `erasable` refuses to put one in; the napi
crossing answers `None` for `HirType::BigInt`, so no caller can hand one in
either. `hir::tags` had already written this down — "correctly false against a
string the runtime never returns" — and the lowering refused anyway. The branch
is dead code and is lowered as such.

The node lane made that argument. I had sized it as a representation change
because I reasoned from *what the branch does with the value* and never asked
whether the branch could run; they asked the cheaper question first.

**And the arm behind it was a stale whitelist.** `NTS_TAG_SYMBOL` has existed
since a symbol got a tag of its own, the C backend's `erased_tag` has mapped it
ever since, and only the two lists in `lower.rs` never learned — the fourth time
that family has gone stale, predicted by its own comment. A symbol is erasable
and readable back now, and `typeof v === "symbol"` folds to a tag comparison
instead of allocating a string per test.

### A cone sizes a queue, not a step

Clearing bigint uncovered symbol; clearing symbol uncovered `String(symbol)`,
and behind that `toString(16)`. The node lane's `cascade-reach` computes the
transitive cone of a refusal, which is the right measurement — and **a cone is
an upper bound on what one fix unblocks only when the refusal at its head is the
only one in that function.** Otherwise it sizes the queue rather than the step.
Both numbers are true and they answer different questions.

## And an export that folded away

    export const fromLiteral = 50;            silently absent from the artifact
    export const fromComputed = 2 ** 53 - 1;  present

A `const` whose initializer folds is *a value rather than storage*: the reader
gets the number and nothing is allocated. That is right for a name only its own
module reads, and `publish_surface` publishes a **global** — so folding an
exported one away left the export table with nothing to point at.

The asymmetry is what makes it a defect rather than a policy, and it is the node
lane's argument: a backend declining to export values would decline both. Their
first attempt put nine exports in one file and gave the opposite answer, which
read as a rule about small integers; isolating one variable at a time gave the
real one.

Both now — the constant keeps folding for every internal use, and the global
costs one static whose initial value *is* the number and which nothing writes.
Asserted in a test rather than an example, because **a differential drives
exported functions and cannot see an export table at all**.

## A command whose output does not match what is built

`emit-c` read `--main` and `--rc`; `emit-llvm` and `emit-jvm` read neither, so
both always emitted the *library* reading with every export a root — and a root
is a wall, its parameters as wide as their declared types. The CLI showed
`(Queens;DD)Z` for a method the benchmark compiles as `(Queens;II)Z`.

`--main` alone was not enough: its entry is module initialization and a bench
case's is `work`, so it pruned the case to nothing. There is a repeatable
`--entry <name>` now, and `nts emit-jvm --entry work` renders the program the
row actually runs.

The JVM session found it by emitting one case both ways and noticing the
descriptors differed. The web-platform session lost an hour to the same thing on
the C side, where the flag existed and was undocumented.
