# The row was an indirect call, and the profile it was supposed to help has no callers

`optional-chain` measured **8.79x** against its C++ reference — the largest gap
on the C lane, and the JVM session had localised it. Their bytecode showed the
`?.`/`??` lowering materialising a tag at a join and testing it twice, with the
tag a literal on each incoming edge and constant nowhere else. It is a real
shape, it is in the IR, and on this lane it costs **nothing**.

    b7: %22 = const undefined : erased      ; tag 0
    b8: %26 = erase %24 : erased            ; tag 2
    b9(%25: erased):
        %27 = tag.of %25
        %29 = eq %27, 0
        %31 = eq %27, 6
        br %29 or %31 ...

clang jump-threads it. The branch condition is constant per predecessor, so the
fallback `1.0` is moved into the result register before the test and the present
path overwrites it. **There is no comparison against 0 or 6 anywhere in the
disassembly**, and the frame object is gone too.

Reading the loop instruction by instruction instead is what found the row:

    ca:  mov  0x0(%rip),%rax      ; descriptor
    d1:  mov  0x18(%rax),%rax     ; ->methods
    dc:  movsd %xmm1,0x8(%rsp)    ; spill the accumulator
    e2:  call *(%rax)             ; indirect
    ec:  movsd 0x8(%rsp),%xmm1    ; reload it

Two dependent loads and an indirect call clang cannot see through. The loads are
the small half: `Closure0__call` compiles to **two instructions**, so not
inlining it is nearly all of what it costs — the call blocks the inline, the
inline blocks the constant fold, and the fold blocks the unroll. The reference
writes a bare function pointer and clang does all three.

Patching that one line of the emitted C to a direct call, before writing any
compiler code: **87.90 → 35.16 us**. The shipped pass then measured **35.17**,
and the agreement to a hundredth of a microsecond is the part worth trusting.

    case             C++       nts C      nts LLVM    node        nts/C++
    optional-chain   9.51 us   35.17 us   33.42 us    352.33 us   3.51x

Control row `absences` unchanged at 1.01x across the same pair of runs.

## The analysis, and why a field

A closure call is a dispatch, and it stops being one when the receiver can only
be one closure. `fields::closures` joins every store into every field over a
three-point lattice — absent, one class, many — with the aliasing rule
[`fields::analyze`] already uses and the soundness argument it already carries:
*a field holds what was stored into it, nothing else can store into it, and
every store in the program is a `FieldSet` in this HIR*.

A field, because that is where callbacks are. Of the 50 closure call sites in
`stream`, `events`, `buffer` and `net`, **35 have a field receiver** — an
optional handler stored on an object and called if present is what a stream is
made of.

## And it fires on none of them

Zero devirtualisations across `stream`, `events`, `buffer`, `net`,
`async_hooks`, `url` and `querystring`. That is the finding, and it is worth
more than the row.

Of 30 live sites there, **23 have no closure class anywhere in the compilation
that names the receiver's type as its base**. Not "several candidates and we
cannot choose" — *none*. The closures called at those sites are never
constructed in that compilation at all, because `runtime/node` is a library and
its callbacks are supplied by its consumers. One site has exactly one candidate.
The rest have four or eleven.

That is the second instance this week of one boundary. Record 0127 closed
generic classes and then had to open a row saying a generic class **exported but
never instantiated in its own compilation** emits nothing, because a copy needs
type arguments only a caller has. This is the same sentence with "closure" for
"type argument": **a library compiled alone cannot see what its callers
supply**, so no closed-world argument is available to it.

Two different optimisations, one boundary, and it predicts that whole-program
compilation of an application *plus* `runtime/node` would unlock both at once.
That measurement has not been taken by anyone here.

There is a third limitation in the same direction and it is sharper than it
looks: the analysis is keyed by **layout**, and layouts are structural. Two
holders spelled `{ fn?: (x: number) => number }` in one program are one layout
and therefore one answer, so five callback holders of one shape means the field
holds five things and every call stays a dispatch. The fixture carries a
distinct extra field per case for exactly this reason, and says so.

## What the memory case measured, and the 2×2 that saved it

    tooling/memory/cases/callback-field, counting operations

                           erasure fix off   erasure fix on
      devirtualisation off        35               35
      devirtualisation on          1                0

**The second fix is worth nothing on its own.** Measuring only the diagonal
would have shipped it with a number that belonged to the other change.

A dispatch is opaque twice. `own::mutating` cannot borrow a reference across a
call it cannot name, which is 34 of the 35 — record 0091's shape exactly, where
a call nothing could see through cost 34 operations on objects escape analysis
had already framed. And `inert_slots` gives up on the **whole function** the
moment it meets a call that is not harmless, since such a call can write through
anything handed to it. So until the call has a name there is no inert analysis
running for the second fix to improve.

The last operation was a release at loop exit, giving back the holder's callback
field as the frame-placed holder dies. `costs_nothing` already answered `true`
for a static closure and `false` for one stored into an **erased** slot — and
every optional callback field is erased, because `fn?: (x) => y` is
`T | undefined`.

**Fifth sighting of one shape.** 0091 found erasure hiding frame-locality from
the reference counter; 0095 found it hiding ownership transfer; `deleted-field`
has 51 against 17 waiting on it; this is it hiding *immortality*. Every time the
fact was already computed and the erasure stood between it and the pass that
wanted it.

The fifth is the JVM session's and it is the one that names the cause.
`codegen/jvm/unbox.rs` exists because a union whose arms are **all objects**
needs no box on that platform — `java/lang/Object` holds any reference and
`instanceof` reads the class word that is already there — and the backend cannot
see that from the type. Record 0108 measured what not seeing it cost: 15.48 us
against hand-written Java's 1.42, and 212,944 bytes per operation against zero.

Which points at the same place all five times. `HirType::Erased` is a bare
variant:

    /// One machine value that can hold anything reachable, together with a tag
    /// saying what it currently holds.
    Erased,

It says a tag is present and **not what the arms are**. Every one of these five
is a pass wanting something the arms would have told it — that they are all
frame-placed, that one of them is a static closure, that they are all objects.
Four of them were fixed by teaching one pass to look through one operation,
which works and does not compose: the sixth will be a sixth local rule. That is
an argument for `Erased` carrying its arms, and it is not an argument made on
the strength of one afternoon — it is what five separate measurements have each
independently wanted.

**And the arms are necessary rather than sufficient**, which is worth writing
down so nobody reads the above as promising five one-line fixes. The JVM
session's is the instance that shows why: `unbox.rs` could not have been a local
rule at all, because "every arm of this union is an object" is a question about
the *value* across the whole program rather than about any one use — it is a
union-find over values joined by block-parameter edges. It needs a second fact
the type cannot carry either: that **every use** of the value is one the
unboxed representation can serve, which `InstanceOf` and `Unerase` are and
anything else is not. Arms on the type make that analysis possible and sound;
they do not make it local, and the whole-program pass stays.

**The suite is what forced it.** I argued a floor of 0, measured 1, and my first
move was to rewrite the fixture so the question would not arise — moving the
holder to module scope, which made it a global and measured **36**. The suite
then refused the version I would otherwise have settled for, in its own words:

    expected contradicts itself: 0 allocations cannot need 1 operations

An instrument that rejects the fudge is worth more than one that reports it.

## Three mistakes, and what caught each

**A unit test that was right about the wrong value.** The first version retyped
the existing `Unerase` in place. That value has another reader — `f?.(x)` tests
the receiver against null before calling it — so the comparison became
`Closure1 *` against `Fn2__2 *`, and `reconcile` made two mismatched operands
comparable the only way it knows: by converting both to the numeric type. Two
pointers, cast to `double`, compared.

    error: pointer cannot be cast to type 'double'      (clang, four times)
    NTS4001 a conversion this backend has no opcode for: an object to an f64

Three unit tests passed on that program. They assert the receiver is an
`Unerase` at a closure class, which was **true** — the shape they check was
exactly right and the program was unemittable. The defect lived one hop away in
a value they did not look at. The example caught it and the other backend caught
it, and neither of those is a test of this pass. The fix is a *fresh* `Unerase`
reading the same erased field at the narrower class, used only as the receiver.

**A mutation that survived, and the fixture that could not kill it.** Treating
an unknown store as `Absent` rather than `Many` failed nothing — because
`throughAParameter` has *only* the unknown store, so the join was absent either
way and nothing was rewritten. The mutation is the dangerous one: an unknown
store read as absent leaves a single known closure looking like the only one the
field can hold, and half the calls go to the wrong function. `mixedSources` is
the fixture that kills it — one known store and one unknown one into the same
field.

**A diagnosis accepted from a good source without checking it on my own lane.**
The tag-at-a-join was handed to me with bytecode behind it. It was right there
and false here, and the difference is a jump-threading pass one compiler has.
The cost of taking it on faith would have been a peephole over the tag lattice
that measured nothing.

## Ratchets

- `examples/callback-fields` — 174 cases against node on C, LLVM and under
  counting, over six exports. Two must be rewritten and **four must not**: two
  closures reaching one field, a store from a parameter, a field nothing ever
  stores into, and one known store beside one unknown one.
- `compiler/core/tests/devirtualize.rs` — three tests, three mutations, each
  caught: joining two stores to whichever was seen first, reading an unknown
  store as absent, and calling directly without stating the narrowing in the IR.
- `tooling/memory/cases/callback-field` — 0 / 0, with the 2×2 above.
- `benches/cases/optional-chain` — 8.79x to 3.51x, prediction and result
  agreeing to 0.01 us.
- No new benchmark row: the case that measures this already existed, and it is
  the one that moved.
