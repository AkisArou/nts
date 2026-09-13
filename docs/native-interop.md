# TypeScript and C, in both directions

The counterpart to `jvm-interop.md`, for the native lane. It is much shorter,
because much less of it is true yet — and the parts that *are* true are true for
a reason that does not generalise.

The original measurements below were made on 2026-09-13 against the tree at
`79bf7358`. The implementation notes immediately below supersede the historical
gap descriptions; the remaining design sections are proposals.

## Implemented since the measurements below

`emit-c --out` now generates `program.h` with the entry modules' emitted
function declarations, the exact C symbols, stable object aliases named
`<export>_<parameter>_t` / `<export>_return_t`, and checked struct layouts.
The C example includes it and reads the fields of `makePoint_return_t`.
The header also describes the promise checkpoint and declares module
initialization when present. Generated aliases receive a numeric suffix if
needed to avoid a C identifier collision.

Header tests compile and run the same caller across the three anonymous-layout
arms below. A conflicting `int add(int, int)` declaration fails compilation.
They also found and fixed an optimizer assumption: numeric fields exposed to
native callers were treated as if only TypeScript could write them, so an
accessor with no internal stores returned constant zero. Boundary-exposed
fields now retain their declared widths and unknown contents, including nested
objects. A same-program control checks that exposed numeric fields remain
`double` while a private counter still narrows to `int32_t`; both execute.

The original precondition in `compiler/core/src/hir/fields.rs` stated:

> there is no FFI that writes through a pointer here

It therefore joined only visible TypeScript stores and the allocator's zero.
With no visible stores, both constant folding and storage narrowing concluded
that an incoming field was zero. Native callers invalidate that precondition:
they can supply field values that never appear in the program's stores.

The implementation order for the C-facing boundary is:

1. Make field facts and storage widths conservative for objects native callers
   can supply or mutate. This is a prerequisite for accepting object parameters;
   the existing Node-API wrapper declines them and does not expose this defect.
2. Generate the header and replace hand-written caller prototypes with it.
3. Add managed constructors and generator stepping, which remain unimplemented.

The historical gap descriptions below record the original measurements;
header generation, stable aliases, field visibility and checkpoint documentation
are now implemented. Managed constructors and generator stepping remain design.

## What is already true

A `declare function` with scalar parameters lowers and emits a direct call:

```ts
declare function abs(v: number): number;
export function useLibc(n: number): number { return abs(n & 3); }
```

| backend | result |
| --- | --- |
| C | lowers — emits `abs(...)` and lets the C compiler resolve it |
| LLVM | `NTS3001 a call to abs, which the runtime declares only as a static inline` |
| JVM | `NTS4001 a call to abs, which this backend has no name for` |

**The C column is not a feature. It is a silent ABI mismatch**, and that is
stronger than "untyped". Read what it emits:

```c
double abs(double);          /* emitted */
int    abs(int);             /* libc's actual signature */
```

The compiler emits a declaration that **contradicts the real one**. With the
real header absent, the double goes into an SSE register and `abs` reads an
integer one; the answer is garbage and nothing reports it. That is the same
defect `codegen/llvm/src/signatures.rs` records against the runtime's own
helpers — `nts_tag_name` takes a `uint32_t`, the lowering handed it a double,
and `typeof v` answered `"undefined"` — pointed at user code instead.

The callback case is worse, because it compiles and crashes:

```ts
declare function counter_on_change(cb: (v: number) => void): void;
```
```c
void counter_on_change(NtsHeader *);        /* emitted */
counter_on_change((NtsHeader *)v1);         /* a managed closure object */
```

C is handed a **garbage-collected object where it expects a code address**. It
will call it.

So **LLVM refusing is correct**, and the C column is the bug. A native-interop
story that relies on it has not started — it has started wrongly.

What does cross the C boundary today, measured one signature at a time:

```ts
declare function strlen(s: string): number;                          // lowers
declare function memcpy(d: Uint8Array, s: Uint8Array, n: number): void;  // lowers
```

And what does not, which is the one that matters:

```ts
interface Handle { readonly __h: unique symbol }
declare function fopen(path: string, mode: string): Handle | null;
declare function fclose(h: Handle): number;

const h = fopen("/dev/null", "r");   // NTS2006 an object type with no layout
```

The refusal is **where the handle is produced**, not where it is passed. Every
real C API is a handle API — `FILE*`, `GtkWidget*`, `sqlite3*`, `CFTypeRef` — so
this single refusal blocks essentially all of them.

There are **450 `declare function` sites** in `runtime/node`. Every one names an
`nts_*` helper resolved through `hir::runtime`'s hand-maintained signature
table. That is the mechanism working exactly as designed, for a closed set the
compiler ships. It is not an FFI.

## The asymmetry that decides everything: a header is not a type system

The JVM lane has a generator, `.d.ts` output, and a binding table. That is not a
difference in effort. **A class file carries types.**

Two corrections to what that lane actually has, because the first version of
this section credited it with more and a reader would have gone looking:

- **There is no `nts bind` subcommand.** `nts bind --jar x --out y` answers
  `unknown command`. The generator is an example binary —
  `cargo run -p nts-jvm-emitter --example bind -- <classes-dir> <package>` —
  and it takes a **directory of class files, not a jar**, because that crate
  deliberately has no zip dependency. The subcommand appears in the plan's
  worked example and was never built.
- **Only one direction is finished.** Measured on the two fixtures:

  | fixture | refusals |
  | --- | --- |
  | `examples/interop/ts-from-java` | **0** — lowers, runs, prints |
  | `examples/interop/java-from-ts` | **48** — typechecks clean, does not lower |

  Java calling TypeScript works end to end because the output *is* a class
  file. TypeScript calling Java is the direction that stops. Field descriptors, method descriptors, the interface-versus-class
distinction, generic signatures where the compiler kept them — a jar is a typed
artefact the binder can *read*.

A C header is a preprocessor artefact. `GtkWidget *gtk_window_new(GtkWindowType)`
tells you a pointer comes back and nothing about whether you own it, whether it
may be null, how long it lives, or what frees it. Two functions with identical
signatures can have opposite ownership contracts, and the header cannot say so.

So the C lane cannot copy the JVM lane's approach, and the gap does not close by
working harder on a binder. It closes by **the language carrying what the header
cannot**, which is what `native-values-and-resource-flow.md` proposes.

## The state of the RFC

`docs/native-values-and-resource-flow.md` is 1,366 lines and specifies native
values, typed pointers, field access, address-of, inline arrays, and a
`ResourceFlow` analysis over ownership. Measured against the tree:

| symbol | occurrences in `compiler/`, `runtime/`, `examples/` |
| --- | --- |
| `ResourceFlow` | 0 |
| `OwnedPtr` | 0 |
| `BorrowedPtr` | 0 |
| `addrOf` | 0 |
| `zeroed<T>` | 0 |

Its own status line says "no implementation in the compiler has been inspected
or verified", and that is accurate.

**The valuable part is `ResourceFlow`, not the syntax.** Native values and typed
pointers are table stakes — every FFI has them. The reason C bindings are unsafe
is ownership, and ownership is exactly what a header cannot tell you. A checker
that makes an ownership obligation statically discharged is the thing that would
make this lane better than the alternatives rather than equal to them.

## What the existing architecture already reserves

`docs/RFC.md` names this future explicitly:

> Blink, UIKit, AppKit, GObject, WinRT, and Android objects remain owned by
> [their runtimes]

with a table giving GObject/GTK "GObject reference counting" as its memory
policy, and a directory sketch containing `gobject/`. So the shape — a foreign
runtime owning its own objects, with its own reference discipline, reachable
through a handle this compiler does not trace — is already the intended design.

That matters because it means the handle refusal above is not a missing feature
in a vacuum. It is the first step of a design already written down.

## What the JVM lane built that transfers

Three things in `hir::runtime` are not JVM-specific and a native lane should
reuse rather than parallel:

- **`foreign_key(owner, member, descriptor) -> String`** — a canonical identity
  for a foreign callee. The design is that it *will* be the callee name, so
  `lower` and every backend agree without a second plumbing; **nothing emits one
  today**. Stated in the future tense deliberately: a native lane looking for a
  mechanism to imitate would otherwise find a struct definition and no caller.
- **`is_foreign_key`** — shape-based, so a foreign name and a runtime helper
  cannot be confused.
- **`foreign_keeps(key)`** — per-parameter escape facts for a foreign callee,
  defaulting to "everything escapes", which is the sound direction. Also
  unreached today: it returns `None` for every key.

The lesson attached to them is worth as much: the *kind* of call (virtual versus
interface, on the JVM) is not encoded in the key, because a key that names one
method twice is not an identity. It travels with the descriptor, in the table
the rows came from. A native lane has the same question with a different
vocabulary — calling convention, variadic-ness, `errno` discipline — and the
same answer.

## Both directions, and only one of them is hard

`ts-from-c` **works today**, and `examples/interop/ts-from-c` is a C program
that calls compiled TypeScript and runs:

    add(2, 3)        = 5
    clamp(42, 0, 10) = 10

No node, no napi, no runtime initialisation — a scalar export is an ordinary
`double add(double, double)` and C calls it directly. The reason is the same one
that makes `ts-from-java` work: **the output is already the host's native form**,
so there is no boundary, only a function call.

That asymmetry is the single most misreadable fact in this document. It is easy
to see "interop works" and conclude the native lane is further along than it is.
**It is not one capability with two directions; it is two capabilities, and only
the outbound one is free.** The JVM lane has exactly the same split — 0 refusals
one way, 48 the other.

Three gaps in the direction that works, all bounded and none needing the RFC:

- **No header is generated for a program's own exports.** `emit-c` writes
  `program.c` and the runtime's headers, nothing declaring `add`, so a C caller
  hand-writes prototypes — and a hand-written prototype that disagrees with the
  emitted one is the `double abs(double)` bug pointed the other way.
- **A C caller can receive a managed value but cannot make one.** `greet`
  compiles to `NtsString *greet(NtsString *)`; there is no public constructor,
  because the emitted code makes literals as a compile-time
  `static const struct { NtsHeader header; unsigned char data[N]; }`. So the
  usable surface from C today is scalars in, scalars out.
- **`quickjs/*.c` must not be compiled separately** — `nts_runtime.c` already
  includes them, and doing both gives `multiple definition of js_dtoa` forty
  times over. `build.sh` carries the working line.

A generated `program.h` plus a small C-facing constructor API turns "C can call
a scalar function" into "C can use this as a library". Both are small, and the
lessons are cheap to learn in the direction that already runs.

## What a C caller actually sees, by TypeScript surface

Measured by exporting one of each shape and reading the emitted prototypes.

| TypeScript export | C signature | runtime needed |
| --- | --- | --- |
| `(a: number) => number` | `double f(double)` | **no** |
| `(a: boolean) => boolean` | `bool bool_(bool)` | **no** |
| `(s: string) => string` | `NtsString *f(NtsString *)` | yes |
| `(xs: number[]) => number` | `double f(NtsArray *)` | yes |
| `(b: Uint8Array) => number` | `double f(NtsView *)` | yes |
| `(n: number) => Point` | `NtsObj_Point *f(double)` | yes |
| `(o: { a: number }) => number` | `double f(NtsObj_Type25 *)` | yes |
| `async (n: number) => Promise<number>` | `NtsPromise *f(double)` | yes |
| `function* (n: number)` | `NtsObj_counted_frame *f(double)` | yes |

**The scalar row is the important one, and it is verified rather than argued.**
A program exporting only scalars links with **no `nts_runtime.c` at all** — I
compiled one against `program.c` alone and it ran. So the two ways of writing
this are genuinely two dialects, and the freestanding one is real:

- **Freestanding.** Scalars, `c_int`, `Ptr`, `Ref`, `libc.d.ts`. No runtime, no
  allocator, no collector. TypeScript as a systems language, and the output is
  an object file like any other.
- **Managed.** `string`, arrays, objects, `Promise`. `nts_runtime.c` is linked
  and the collector is live.

That distinction should be *visible in the toolchain* rather than discovered at
link time — a program that believes it is freestanding and pulls in the runtime
through one `string` has silently changed category.

## The awkward spots, and what each needs

**1. Names are mangled on collision, invisibly.** `export function bool` emits
`bool_` because `bool` is taken in C. Nothing in the TypeScript says so, and a
hand-written prototype for `bool` links against nothing. *Fix: generate
`program.h` — the mangling stops mattering the moment the caller includes the
real declarations.*

**2. An anonymous object type's C name is a whole-program fact**, which is worse
than "it is generated". Measured, three arms:

| program | emitted C name |
| --- | --- |
| the anonymous type alone | `NtsObj_Type3` |
| plus an **unused** named type of the same shape | `NtsObj_Type5` |
| plus a **used** named type of the same shape | `NtsObj_Pair` |

Layouts merge structurally, so an anonymous type borrows a named one's name —
but only where that named type is *used*, because an unused one never gets a
layout to merge into. And the `TypeN` number moves when unrelated declarations
appear above it. So a generated header would change under edits touching nothing
nearby, and a caller's source would break for a reason with no visible cause.

*Fix: the generated header, which means **this is not a separate problem — it is
a symptom of spot 1**.* An earlier draft of this document proposed refusing to
export a signature mentioning an anonymous object type, on the grounds that a
named `interface` costs one line. That was a compiler-writer's reflex: the
internal name is unstable, so make the author fix it. It is the wrong trade and
our user was right to object — we are aiming for the best DX available, and
"declare an interface you did not want" is a restriction paying for an
implementation detail.

The header pays for it instead:

```c
/* generated program.h, regenerated every build */
typedef struct NtsObj_Type3 sumOf_o_t;   /* alias named from the export */
double sumOf(sumOf_o_t *o);
```

The caller writes `sumOf_o_t`, derived from the export's own name and parameter
— both chosen by the author, so both stable. The churn stays inside, where it
costs nobody anything, because the header is regenerated with the program.

`examples/interop/ts-from-c` carries `sumOf` and `sumOfNamed` side by side, and
the point of the pair is now the *measurement* — that structural merging makes
the internal name a whole-program fact — rather than a recommendation to write
the second one.

**3. C can receive a managed value but cannot make one.** There is no public
constructor: the emitted code builds string literals as a compile-time
`static const struct { NtsHeader header; unsigned char data[N]; }`. So the
usable managed surface from C is **out only**. *Fix: a small C-facing
constructor API — `nts_str_from_utf8`, `nts_array_of_doubles`, and the object
descriptors are already emitted with `_Static_assert`ed layouts, so a caller can
legitimately build one if given the descriptor.*

**4. A generator hands back its frame.** `function*` returns
`NtsObj_counted_frame *` — the suspension frame itself, with `state` and
`yielded` fields whose offsets are `_Static_assert`ed. There is no exported
`next`. So a C caller holds a real object and has no supported way to step it.
*Fix: emit a `next` shim per exported generator. The frame is already a
first-class object; what is missing is one function per generator that resumes
it and reports done-ness.*

**5. A promise needs a checkpoint the caller must know about.** `async` returns
`NtsPromise *`, and the runtime exposes `nts_checkpoint()`,
`nts_promise_state()` and `nts_promise_value()`. Demonstrated end to end in
`examples/interop/ts-from-c` — state `0` before the checkpoint, `1` after, value
`42`. It works and it is undocumented.

There is a trap in *demonstrating* it that the example now carries a note about:
an `async` function with no `await` is **already settled** when it returns, so
the checkpoint changes nothing and an arm written that way prints the same state
twice. The first version of that example did exactly this.
*Fix: document it in the generated header, and consider a blocking
`nts_promise_join` for the common case — a C `main` that wants one answer should
not have to know what a microtask is.*

**6. Classes are better than expected and should be said so.** `NtsObj_Point` is
a real `typedef struct` with a definition and `_Static_assert`s on its size and
every field offset. A C caller can read `p->x` safely, and the assertions mean a
layout change breaks the build rather than the program.

## The DX, as a file rather than a proposal

`examples/interop/c-from-ts` is the native counterpart to `java-from-ts`: a
small C library with one of each shape that matters (a scalar whose C types are
not TypeScript's, an owned handle, a borrowed accessor, a callback, an
out-parameter), the binding sketch a generator *should* produce — written by
hand today, because no importer exists — and the consumer file somebody would
actually write.

It does not compile, and **how** it fails is the useful part:

    39 TypeScript errors, of which 37 are `TS2304 Cannot find name`

`c_int`, `Owned`, `Ref`, `CFn`, `Ptr`, `CStr`, `addrOf`. It never reaches the
compiler, so there is nothing to refuse — the program is not yet *expressible*.
Anyone pricing this work should know it is a language-surface task first and a
lowering task second.

## The one refusal to remove first

```
NTS2006 an object type with no layout
```

An **opaque extern handle**: a nominal type with no fields, no layout, and no
tracing, that can be produced by a foreign call, stored in a local, passed back
to a foreign call, and compared against null. It is not a pointer type in the
RFC's sense, it carries no ownership, and it cannot be dereferenced.

That is a small, self-contained change, and it turns a walking skeleton into
something that runs:

```ts
declare function gtk_init(argc: number, argv: number): void;
declare function gtk_window_new(kind: number): GtkWidget;
declare function gtk_widget_show_all(w: GtkWidget): void;
declare function gtk_main(): void;
```

No ownership, no structs, no callbacks — and a window appears. Everything after
that is an increment with a running program behind it, which is the condition
this project's work goes best under.

## What comes after, in order

**The end state is an automatic generator with the DX of `@types/node`:** point
it at a header, get a `.d.ts` a person would have been willing to write, and
never think about the boundary again. Everything below is ordered so that the
generator is built when it can produce something *safe*, rather than early when
it can only produce signatures. The order is also the one
`examples/interop/c-from-ts/README.md` tabulates against the lines it blocks, so
the two agree by construction.

0. **The scalar types, branded.** `c_int`, `c_long`, `c_size_t` and the rest, as
   branded `number`s (see **Decided**). First because nothing else can be
   emitted without them: LLVM needs a typed `declare`, and a signature that says
   `number` where C says `int` cannot produce one. Blocks `clamped` in the
   example, and silently mis-emits today.

1. **`libc.d.ts`, shipped and curated.** Measured on `java-from-ts`, the second
   item after `method_body` is **10 refusals of "a member of `HashMap`, a class
   this compiler has no type for"** — because `java.d.ts` is hand-written, so
   even once declarations stop being refused, every call into a JDK collection
   still has nothing behind it. **A binder that emits declarations for the
   user's own library still needs a prelude for the platform's**, and the
   prelude is the part nobody budgets for. It is not optional and it is not
   visible until the item above it is fixed.

2. **Opaque handles.** Unblocks every binding; refuses everything unsafe. This
   is the `NTS2006` refusal, and it is the single smallest change with the
   largest reach.

3. **A second source of `declare` lines in LLVM, beside the generated one.**
   The existing table does **not** go away and is not the obstacle: it is 311
   rows *generated from clang's report of the runtime header*, drift-tested,
   and it exists because LLVM has no implicit conversion — reading a signature
   off the call site gave `nts_tag_name` a double where it takes a `uint32_t`
   and made `typeof v` answer `"undefined"`. That is the runtime's ABI and it
   stays.

   What lands beside it is a second source for the *user's* foreign functions,
   whose types come from the TypeScript signature rather than from a header.
   Which is why step 0's scalar types are a prerequisite for this one and not a
   nicety: a `declare` line cannot be emitted from a signature that says
   `number` where C says `int`.

4. **GObject reference counting as the first `ResourceFlow` client.** Not the
   general ownership language — one foreign runtime with one discipline
   (`g_object_ref` / `g_object_unref`), which gives the analysis a real consumer
   and a corpus that can refute it.
5. **`CFn`, `Ptr` and `addrOf`.** Callbacks and out-parameters — the shapes
   that make *ordinary* C libraries reachable rather than only simple ones.
   Blocks `watched` and `readOut` in the example.

6. **Structs by value and the rest of the RFC's value surface.** Once something
   real is using the handles.

7. **The generator — `nts bind --header`.** A name for a thing that does not
   exist, said plainly because the JVM lane's plan carried `nts bind --jar` for
   weeks and an earlier draft of *this* document repeated it as fact. Last, and
   the reason is the whole argument of this document: a header yields **signatures** and cannot yield
   **obligations**. `counter_new` and `counter_name` both return `Counter *`;
   one is an obligation and one is an alias, and no importer can tell them
   apart. Built before the ownership language exists, it would bake in the
   assumption that a signature is enough — and every binding it ever emitted
   would carry that assumption forward.

   Built last, it emits `Owned`/`Ref` where an annotation or an overrides file
   says so and **refuses to guess** elsewhere, which is the difference between a
   generator that saves work and one that manufactures unsafe bindings at scale.
   The JVM lane's `bind.overrides.json` is the precedent: the generated artefact
   plus a small hand-written file for the facts the artefact cannot carry.

## Why not iOS/macOS first

- **Apple/Darwin appears 0 times** in `compiler/`, `runtime/`, `docs/` or
  `tooling/`.
- This machine is Linux. The gate is this project's entire discipline, and an
  ObjC/Swift lane could not run one here — no toolchain, no device.
- The Android lane works because dex and `adb` run on Linux with the device
  optional (`on-device: SKIP: no device`). There is no equivalent for Apple.

GTK is C, on this machine, with a real library to test against, and
`docs/RFC.md` already reserves it. Objective-C also needs `objc_msgSend`, a
variadic call whose signature depends on the selector — which is the RFC's
hardest open question, met on the first day rather than the hundredth.

## Should `Ptr`, `Ref` and the rest be exposed to TypeScript?

**Yes, and the reason is the ABI rather than ergonomics.**

The argument that settles it is the `double abs(double)` measurement above. LLVM
requires a typed `declare` for every symbol it calls, and the runtime's own
signatures are **generated from clang's report of the C header** precisely
because reading them off the call site was unsound. A foreign function needs the
same thing — and the only place its types can come from is the TypeScript
signature, because there is no header importer and no class file.

`number` is an f64. It cannot say `int`, `long`, `size_t`, `float`, or "pointer
to the first of n". So without `c_int` and friends, a foreign declaration cannot
carry an ABI, and the compiler is left to guess — which is what it does today,
wrongly.

`Ptr` / `Ref` / `Owned` are the same argument one level up. A header cannot say
which `Counter *` is owned and which is borrowed:

```c
Counter    *counter_new(const char *name);    /* owned: caller destroys */
const char *counter_name(const Counter *c);   /* borrowed: do NOT free */
```

Same C type, opposite obligations. The distinction has to live in the
TypeScript signature or nowhere — and "nowhere" means every binding is
hand-audited, which is the status quo for every FFI that does this badly.

**What this does not justify** is exposing the whole RFC surface at once.
`c_int`, an opaque handle, `Owned`/`Ref`, and `CFn` are what make ordinary C
libraries reachable. Inline arrays, `zeroed<T>`, struct-by-value and
address-of-a-place are the second half, and `examples/interop/c-from-ts` marks
which of its lines need which.

## Can the `as c_int` casts go away?

Half of them already should. Measured on a branded `c_int`:

| direction | needs a cast |
| --- | --- |
| `c_int` result used as a `number` | **no** — a branded number *is* a number |
| plain `number` passed where `c_int` is wanted | yes — `TS2345` |

So every `as number` on a *result* is dead weight, and the example carried six
of them. One remains and it is real. The inbound direction is the question.

**There are two designs and the second is better, which weakens an argument made
earlier in this document.**

**(a) Branded parameters.** `clamp(v: c_int, …)` — every call site casts.
TypeScript then stops you passing `3.7` where an `int` goes. That is the version
the example currently shows, and six casts in twenty lines is the DX cost.

**(b) Plain `number` parameters, ABI in the binding table.** The `.d.ts` says
`clamp(v: number, …)` and the row beside it says the C type is `int`. No casts
anywhere, and the compiler still knows exactly what to emit — the ABI is a fact
about the *declaration*, and a declaration already has a table row.

This is the JVM lane's architecture, which we should copy rather than reinvent:
a `.d.ts` for the checker and a `.bind` for the machine facts, with
`foreign_key` joining them. The key insight there was that a fact needed by the
backend does not have to live in the *type* — and the invoke kind travelling in
the table rather than in the key is the same decision one level down.

**What (b) costs**: TypeScript stops warning that `3.7` is not an `int`. But C
does not warn either — it truncates — so (b) is *faithful* to the target rather
than merely lax, and a user writing a C binding has C's semantics whatever we do.

**What it means for the earlier argument.** This document says exposing `c_int`
is justified "on the ABI rather than ergonomics", because LLVM needs a typed
`declare` and the types can only come from the TypeScript signature. That is
true **only while there is no binding table**. With one, the ABI has a better
home, and the scalar types become a tool for authors who *want* the checking
rather than a requirement for the compiler to function.

They are still worth having — `Ptr`, `Ref` and `Owned` have no other home,
because assignability is exactly what they are for. But `c_int` on a parameter
is now a choice, and the DX argument points at (b).

*Open, and it is a decision: whether the generator emits (a) or (b) by default,
and whether an author can opt into the strict form per module.*

## The questions that were open, and what investigating them found

**Does an opaque handle participate in reference counting?** No, and it must
not. `docs/RFC.md` already commits to this — GObject, UIKit, AppKit and WinRT
objects "remain owned by" their runtimes, each with its own reference
discipline. So a handle is a word this compiler never traces, and the
obligation is expressed in the *type* (`Owned` vs `Ref`) rather than in the
collector. That also settles why `ResourceFlow` has to be a checker and not a
runtime mechanism: there is no runtime that could do it.

**What does a C callback look like?** Measured: today a TypeScript function
passed to a `declare function` is emitted as `NtsHeader *` — a managed closure
object where C expects a code address. So the question is not "how do we add
callbacks", it is "how do we stop emitting a wrong one". `CFn<...>` has to be a
distinct type from a TypeScript function, and the consequence is that **a C
callback cannot capture**: a closure has an environment, a C function pointer
has no room for one, and every C API that takes a callback also takes a `void *
user` for exactly this reason. That is why `counter_on_change` in the example
carries one.

**Where do the ownership rows come from?** They are hand-written, and the format
should say so. The JVM lane reads a generated binding table because a jar can be
read; a header cannot yield ownership, so there is nothing to generate *from*.
A header importer can produce signatures and must not be trusted for
obligations — which is the argument for building it **last**, after the
ownership language exists, rather than first.

## What is deliberately still open

One, and it is a decision rather than an investigation:

- **What happens when a callback throws?** A C frame is between the throw and
  any handler, and there is nothing to unwind with. The options are to refuse a
  throwing callback statically, or to trap. This needs a choice, not a
  measurement.

## Decided

**`c_int` and the other scalars are branded `number`s.** So
`type c_int = number & { readonly __c_int: unique symbol }`: arithmetic keeps
working, `Math.abs` still accepts one, and existing numeric code compiles
unchanged. The cost is accepted with open eyes — a branded `number` is a
**subtype** of `number`, so a `c_int` flows into a `double` parameter without
complaint and inference spreads it where nobody wrote it.

That is the same assignability leak that made the JVM lane's branded-`Int32[]`
proposal unsound, and the difference is what makes it tolerable here: there, the
brand had to *separate* two array representations and covariance defeated it;
here the brand only has to *narrow* what a declaration means at the boundary,
and a `c_int` reaching a `double` parameter is a widening C already performs.
Where that is not true — a pointer, an owned handle — the type is **not** a
branded number and the leak does not arise.

Revisit if a measurement shows the leak reaching a foreign `declare` line, which
is the one place it would be wrong rather than merely loose.

**`libc.d.ts` ships with the compiler.** Curated and hand-written, and it must
say so in its own header. Three reasons: ISO C is standardised and stable, so a
snapshot does not rot the way a third-party library's would; generating it needs
the header importer, which is deliberately last, so shipping is what makes a
walking skeleton possible at all; and the JVM lane's `java.d.ts` is the
cautionary case — hand-written under a header claiming it was generated, which
is why nobody noticed it was the second-largest blocker in the module.

Third-party libraries are **not** shipped and never will be. `GTK`, `sqlite`,
`libcurl` are generated per project.
