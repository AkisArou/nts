# A global of function type holds a closure, and `const` is the whole argument

`const double = (x: number): number => x * 2` at the top of a file was refused.
An *alias* of a declared function, `const thrice = triple`, was not. The
difference is worth the record, and so is the number I used to justify working
on it, which was wrong by a factor of five in the direction that flatters the
work.

## The refusal knew

    if probe.is_function_typed(name) {
        return Err("a module-scope variable holding a function".to_owned());
    }

with a comment above it describing the cause exactly:

> A function type is `Managed(Object(..))` like any other object, and a global
> of one holds a **closure** — a different object, with its own layout. Both are
> references, so nothing between here and the backend objected... It surfaced as
> clang refusing to assign an `NtsObj_Closure0 *` to an `NtsObj_Fn2 *`.

That is the third sighting this week of one species: **a coarse representation
asked a question only the fine one can answer.** An array of `i32` reached a
slot of `f64` because both are `Managed(Array(..))`. A method and a field
holding a function were one member because both are function-typed. Here a
closure reached a slot of its own function type because both are
`Managed(Object(..))`. In each, every layer agreed and the last one — clang,
the JVM verifier — is where the disagreement became visible.

## The fix is not a wider slot

The slot takes the **closure's** type. `closure_typed_global` pairs a
module-scope binding's initializer with its `ClosureInfo` and answers with
`closure_type(index)`; `declare_a_closure_global` pushes the global and defers
the initializer to `module#init`, because an arrow is code and never a constant
to fold. `collect_closures` moved above `collect_module_scope` so the layouts
exist when the binding is typed — it reads only the snapshot, so the order was
free.

**`const` is the entire soundness argument.** A binding that cannot be
reassigned holds exactly the closure that initialised it, so a slot typed by
that closure is a slot that is always right. A `let` can be given a *second*
arrow, and a second arrow is a second layout:

    current = v3;
            ^ incompatible pointer types assigning to 'NtsObj_Closure2 *'
              from 'NtsObj_Closure3 *'

One slot cannot be both. So `let` keeps a refusal, and it now says which of the
two it is rather than covering both.

## The number, which I did not check

I carried "nineteen module-scope arrows in `runtime/node`" from the scoping into
the example, the benchmark and two messages to another session before counting
them. There are **four**: `nop` in `stream/writable.ts`, `nop` in
`stream/end-of-stream.ts`, `fn` in `stream/utils.ts`, `shorthand` in
`zlib/main.ts`. The first count had matched an arrow anywhere near a top-level
binding, so it collected `const hexTable: string[] = Array.from(`, a string
constant, and `const ROOT = 1`.

**And the seven it displaced are the finding.** Every remaining module-scope
binding holding a function in `runtime/node` is a `let`:

    let unicodeOf: (host: string) => string = (host) => host;
    let asciiOf: (domain: string) => string | null = (domain) => domain;
    let domainToAsciiImpl: DomainToAscii = (domain) => domain;
    let createReadStreamImpl: ReadStreamFactory = ...
    let composeImpl: (a: unknown, b: unknown) => unknown = () => { ... }

Seven of these against four `const`. They are all one idiom — a slot declared
with a stub and reassigned once when the real implementation is available — and
that idiom is *why* they are `let`. So the case this compiler now handles is the
minority case, and the majority case is the one the soundness argument excludes.

That is not a reason to have skipped it. It is a reason the motivation should
have been counted before it was quoted: a number repeated in four places without
being measured once is a claim wearing a measurement's clothes, and this project
has a rule about exactly that.

## What the seven need, and who else needs it

Each of those `let` bindings carries an explicit function type, and both arrows
assigned to one satisfy it. So the slot *can* be typed by the function type — if
each closure declares that type as its **base**. Which is precisely the thing
`Lowering::closure_layout` throws away:

    methods,
    // Every closure is its own class and extends nothing.
    base: None,

while `examples/closures`, five lines into the file, says *"a base-first layout
(the signature type is the base, and it has no fields)"*. A documented invariant
with nothing comparing the document to the code — the same shape as
`Hierarchy::base`, comment and all, and the second time today a design was
written down and not built.

The JVM lane hits this at every closure call site, one scope below my globals,
and needs more from it than C does: `Closure5` must *actually extend* `Obj8`, a
nominal relationship checked at class load rather than a compatible pointer.

**And neither of us can take it yet, for a reason I hit two days ago on object
literal methods.** `layout_of` names an anonymous type from whichever `TypeId` a
builder saw first, so the identical literal type produced `Type17#step` at a
definition and `Type14#step` at a call site. An inline `(host: string) => string`
is an anonymous type. Closure bases drawn from one would give `Closure5 extends
Obj8` in one place and `extends Obj14` in another — harmless-looking in C, a
`VerifyError` on the JVM. So three separate pieces of work — object literal
methods, closure bases, the seven `let` bindings — are one missing thing: a
program-wide naming authority for anonymous types. Agreed with the JVM session
that a base that is sometimes the right class is worse than no base, because no
base is a refusal and a wrong base is an artifact.

## Measured

Memory, floors argued in `expected` before the run and met exactly:

    module-closures   naive 68   actual 0   ideal 0   100%   alloc 0   floor 0

Two capture-free arrows called 4096 times cost nothing. The argument for zero
was that a closure with no fields bound to a `const` is one immortal object with
no state — which is a static, and this compiler already emits statics for named
functions used as values. The measurement agreed with the argument rather than
the argument being fitted to it.

## Two things the hostile inputs found that are not this

**Unbounded recursion takes the signal.** `const fact = (n) => (n <= 1 ? 1 : n *
fact(n - 1))` segfaults, because `NaN <= 1` is false and `NaN - 1` is `NaN`, so
the base case is never reached and there is no stack limit. Node answers with a
`RangeError`. A recursive *function declaration* does exactly the same, so this
is not the new feature's — it is a missing check, and it is now the reason the
example writes `!(n > 1)`, which takes `NaN` to the base case.

**And a test I wrote asserted something false.** I claimed `const thrice =
triple` would produce a global holding a closure like the rest. It produces no
global at all: the alias resolves to the function and the call is direct. The
assertion failed on the first run, which is the only reason I know it — the
sentence had already gone into a comment as though it were a fact.

## The gate

Two steps failed on another lane's files before mine could run: a `#[must_use]`
on a constant, then a test asserting that BigInt has no JVM descriptor, which
their bigint work had just given it. Neither had anything to do with this
change. Reported rather than fixed — the file-ownership split is the point of
having one — and the second is the case that argues their scoped-clippy fix was
right, since it is a file they were committing.

One of my own tests needed narrowing, and it is worth saying why that is not the
same thing. `an_unsupported_construct_is_refused_rather_than_skipped` asserts
that `supported` is the only export of `examples/unsupported`; the refused `let`
I added gave that fixture its first module-scope declaration, so it gained a
`module#init`. Excluding `module#init` **by that exact name** does not weaken the
check — it is synthetic and can never be a written export that lowered when it
should have been refused — and the positive control says so: adding an
`export function extra` that lowers cleanly still fails it.

91 of 91 examples agree with node, on both backends and under counting.
