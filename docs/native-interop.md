# TypeScript and C, in both directions

The counterpart to `jvm-interop.md`, for the native lane. It is much shorter,
because much less of it is true yet — and the parts that *are* true are true for
a reason that does not generalise.

Everything in "What is already true" was measured on 2026-09-13 against the tree
at `79bf7358`. Everything after it is proposed.

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

**The C column is not a feature, and reading it as one is the first mistake
available here.** It works because the C backend emits C, so symbol resolution
is deferred to the C compiler and the linker. The compiler knows nothing about
`abs`: not its real signature, not whether it allocates, not who owns what it
returns. LLVM is the honest measure of what is actually known, and it refuses.

Anything shipped as native code goes through LLVM. So **the C backend's FFI is a
mirage**, and a native-interop story that relies on it has not started.

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

0. **A prelude with types behind it.** Measured on `java-from-ts`, the second
   item after `method_body` is **10 refusals of "a member of `HashMap`, a class
   this compiler has no type for"** — because `java.d.ts` is hand-written, so
   even once declarations stop being refused, every call into a JDK collection
   still has nothing behind it. The native lane's equivalent is `libc`, and the
   lesson transfers exactly: **a binder that emits declarations for the user's
   own library still needs a prelude for the platform's**, and the prelude is
   the part nobody budgets for. Named zeroth because it is not optional and it
   is not visible until the thing above it is fixed.

1. **Opaque handles** (above). Unblocks every binding; refuses everything unsafe.
2. **The LLVM signature path for declared externs.** Today LLVM refuses any
   symbol not in its table. Until a `declare function` reaches LLVM, nothing
   here ships native.
3. **GObject reference counting as the first `ResourceFlow` client.** Not the
   general ownership language — one foreign runtime with one discipline
   (`g_object_ref` / `g_object_unref`), which gives the analysis a real consumer
   and a corpus that can refute it.
4. **Structs by value, and `addrOf`.** The RFC's core, once something is using
   the handles.
5. **A header importer**, last rather than first, because it can only ever
   produce *signatures* — and the ownership annotations it cannot produce are
   the part that makes bindings safe. An importer built before the ownership
   language would bake in the assumption that a signature is enough.

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

## Open questions

- **Does an opaque handle participate in reference counting at all?** The RFC
  says foreign objects stay foreign. Then a handle is a raw word this compiler
  never traces, and a leak is the user's. That is the honest answer and it
  should be stated rather than discovered.
- **What does a C callback look like from this side?** GTK is signal-driven, so
  `g_signal_connect` is not optional. A function pointer into compiled
  TypeScript needs a stable ABI entry and a decision about what happens when it
  throws.
- **Where do the rows come from?** The JVM lane settled this for jars: read at
  compile time, threaded through `Options`, `hir::runtime` stays pure. A native
  lane has no equivalent artefact to read, because there is no header importer —
  so the first version's ownership facts are hand-written, and the format should
  admit that rather than pretend to be generated.
