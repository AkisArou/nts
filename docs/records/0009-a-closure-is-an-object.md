# 0009 — A closure is an object, and a higher-order call is a direct one

Closures went in without a single new mechanism, and then took four changes to
stop being forty times slower than V8. Three of the four were not about closures
at all: they were places where the compiler treated a dispatch as unknowable,
and a closure is the first thing in this language that is *only* ever reached
that way.

## The design

A closure is captured state plus code. So is an object. Saying so — rather than
inventing a second mechanism — means it gets the object machinery as written:

- a **base-first layout**, with the arrow's signature type as the base. The
  signature has no fields, so a pointer to the closure is a pointer to the
  signature and an upcast costs nothing.
- **escape analysis**, so a closure that does not outlive the call stays in the
  frame. `twice` allocates nothing at all.
- **reference counting**, with the same rules as any object. A closure over an
  array retains it on the store and gives it up when the closure dies.
- **dispatch through a slot**, one slot shared by every closure in the program.
  A slot per function type would make every table as long as the number of
  signatures for a distinction nothing can observe.

`collect_closures` fixes the capture list before any lowering, so both sides
agree on the field order. It refuses to capture a variable something assigns to:
this captures by value and JavaScript captures by reference, and for a name
nothing writes to those are the same thing.

## The number, and what moved it

| | ns | against C++ | against node |
| --- | ---: | ---: | ---: |
| first working version | 40,500 | — | 14.3x |
| dispatch contributes parameter facts | 25,990 | — | 9.15x |
| a concrete closure call is direct | 13,720 | — | 4.58x |
| `hir::monomorphize` | 5,890 | 4.40x | 1.60x |
| loop bounds feed back; field facts | **1,220** | **1.01x** | **0.34x** |

The C++ reference is a lambda and a `template <typename F>`, which
monomorphizes and inlines — the hardest bar this shape has.

## The four things

### A dispatch was opaque to every interprocedural pass

`interprocedural::analyze_program` collected call sites from `Callee::Direct`
only. A function reached solely through a slot therefore had *no visible
callers*, so its parameters sat at BOTTOM — and a body with no possible inputs
folds to a constant. The closure compiled to `return 0`, and the benchmark
noticed only because it compares its checksum against node.

This was already true of class methods; it had never bitten because a virtual
method's `this` is a pointer, and the numeric domain has nothing to say about
one. A closure's parameter is a number.

The tables *are* the complete list of what a call through a slot can reach, so
`Program::slot_targets` says so once and escape analysis, parameter facts and
return facts all use it. Escape analysis had the same hole from the other side:
treating a dispatch as opaque meant no closure passed anywhere could ever stay
in a frame.

### A closure class is final

Nothing extends it, and only its own arrow fills its slot. So a call whose
receiver's static type is the class rather than the signature has exactly one
possible body, and the lowering emits a direct call.

clang cannot recover this. To fold `f->header.descriptor->methods[0]` into a
known function it must prove the callee does not write `f->header.descriptor`,
and it cannot know the callee without folding the load. The disassembly showed
the consequence exactly:

```
mov  0x10(%rsp),%rax     ; reload the descriptor, every iteration
mov  0x18(%rax),%rax     ; reload the table
call *(%rax)             ; and an indirect call
```

### A function that receives a closure needs one copy per closure

Inside `drive(f: (x: number) => number, ...)`, `f` is the signature type and the
call through it is a real dispatch. A C++ programmer writes `template <typename
F>` and gets one `drive` per callable; `hir::monomorphize` makes one `drive` per
*closure class*, for the same reason and with the same result. The difference is
that C++ needs the author to have written a template, while the concrete type
here comes from the call site.

It clones only when the parameter is used *solely* as the receiver of a call.
Retyping one that is stored, returned or passed on would have to retype
everything downstream, and the profit is in the call.

### The two fixpoints were not nested

`loops::accumulator_caps` counts a loop's iterations, which the value domain
cannot do on its own. It ran *after* the interprocedural fixpoint had settled,
and its results fed nothing but the final analysis. So `f(i)` called from
`for (i = 0; i < 4096; i++)` gave `f`'s parameter the widened `[0, 2^31)`
instead of `[0, 4096]` — and `x * 2654435761` over that range is not provably
inside 2^53, so it stayed floating point, with three runtime helper calls per
iteration for arithmetic that fits in a register.

The parameter fixpoint now runs again with the loop bounds in hand.

## Two general things that came out of it

**Field reads were TOP.** Every `this.count`, every capture, every record
member. `hir::fields` joins every store into a field, and base-first layout
makes the aliasing question exact and cheap: two layouts share a field's storage
when they agree on the whole prefix up to it, because that is precisely when a
pointer to one is a pointer to the other with the same offsets. Zero is joined
in as well, because that is what an allocation leaves.

This is not a closure feature. It is every program that uses objects.

**`same_shape` now compares dispatch tables.** Two classes extending one base
and adding no fields had identical field lists and different `area` methods, and
merging them gave one the other's behaviour. Closures made it common rather than
possible: their fields are what they captured, and two closures capturing one
number each are the same shape and different code.

## What is left

- A closure that captures a reassigned variable is refused rather than boxed.
  The refusal names the reason, which is the right place to stop until a boxed
  cell is worth its cost.
- A *function-valued property* — `{ run: (x: number) => number }` — is refused,
  because tsgo's decomposition does not distinguish a method (no storage, a
  static call) from a property holding a closure (a field). That needs a schema
  bit, not a lowering change.
- Monomorphization stops at ten clones. Past that a program is asking for a
  dispatch, and code size is a cost.
