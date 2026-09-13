# TypeScript and Java, in both directions

A plan for `nts bind` and its opposite, written to be argued with. Every claim
marked **measured** was checked against this tree on 2026-09-13; everything else
is a proposal and says so. The point of separating them is that this lane has
spent a week learning that a plausible representation claim costs a day to
refute and five minutes to check.

## What is already true

**TS → Java already works.** `compiler/codegen/jvm/tests/execute.rs` compiles a
`Drive.java` with `javac --release 8 -Werror` against classes this compiler
wrote, calls `nts.gen.Program.add(double, double)`, and asserts the answer.
javac typechecked against our class files. Nothing about that direction is
unbuilt; what is missing is *packaging*, which is the last section here.

**Java → TS is unbuilt.** `compiler/jvm-emitter` is a writer only -- its own
header says "It is also the class file *reader* that `nts bind` will need",
future tense -- and there is no `bind` subcommand. The CLI is `check`, `emit-c`,
`emit-jvm`, `hir`, `layouts`, `version`.

## The representations, measured

This is the table everything else depends on, and none of it is a design
decision left to make -- it is what the backend emits today.

| TypeScript | JVM representation | where |
| --- | --- | --- |
| `string` | `java.lang.String` | `types.rs:399` |
| `number` | `double` | |
| `boolean` | `Z` | |
| `bigint` | `NtsBigInt`, two `long` fields, 128-bit wrapping | `NtsBigInt.java` |
| `T[]`, program never grows one | a **bare JVM array** -- `[D`, `[Ljava/lang/String;` | `types.rs:450` |
| `T[]`, program grows any array | `NtsArrayD` / `NtsArrayL` / `NtsArrayZ`: a wrapper with `items` and a `length` | `types.rs:437` |
| `Uint8Array` etc. | `NtsViewU8`…, a window onto an `NtsBuffer` whose storage **is** a `byte[]` | `NtsBuffer.java:194` |
| `Map`, `Set` | `NtsMap` -- open addressing over `NtsValue[]` and `long[]`, "no boxed keys, boxed slots or HashMap nodes" | `NtsMap.java:9` |
| an object or class instance | one `final class nts/gen/<Layout>` | |
| a closure | `nts/gen/Fn$<hash>` with a `call` method | |
| `unknown` / erased | `NtsValue`: `int tag`, `double num`, `Object ref` | `NtsValue.java` |

## The copy question

This is the question that decides whether the binding is worth having, so it is
answered per type rather than in general. **A copy is a real allocation and a
real traversal**; a conversion is an instruction.

| TS value | Java parameter | cost |
| --- | --- | --- |
| `string` | `String` | **nothing.** The same object. |
| `number` | `double` | nothing |
| `number` | `int`, `long`, `float`, `short`, `byte`, `char` | a **conversion** -- `d2i` and friends, one instruction |
| `boolean` | `boolean` | nothing |
| `bigint` | `long` | a field read; `NtsBigInt.lo` is the value |
| `bigint` | `BigInteger` | **a copy**, and an allocating one |
| `T[]` (non-growing program) | `T[]` of the same element | **nothing.** It is already that array. |
| `T[]` (non-growing) | an array of a *different* width -- `number[]` to `int[]` | **a copy**, because the element widths differ |
| `T[]` (growing program) | any `T[]` | **a copy.** The wrapper's `items` is longer than its `length`, so even the same-width case cannot be passed through |
| `Uint8Array` spanning a whole buffer | `byte[]` | **nothing** -- `NtsBuffer.storage` is the array |
| `Uint8Array` that is a subarray | `byte[]` | **a copy**, unless the callee takes `(byte[], int off, int len)` |
| `Map` / `Set` | `java.util.Map` / `Set` | **a copy, always.** `NtsMap` is not a `java.util` structure and cannot be made into one without rebuilding it |
| an object | a Java interface | **nothing**, if the generated class implements the interface |
| a closure | a Java functional interface | **nothing**, if `Fn$<hash>` implements it; otherwise one adapter object per crossing |

### The one cliff that matters, and it is whole-program

`arrays_can_grow` is a **whole-program** property. One `push` anywhere puts
*every* array behind a wrapper:

> Whole-program: one `push` anywhere puts every array behind a wrapper, because
> an array that grows cannot keep its elements inline after its own header
> without moving.
>
> Record 0088 measured that at **1.4%** here against **4.02x** on the native
> lane.

1.4% of execution is cheap. **What it does to interop is not cheap**, and that
is a different number nobody has measured: in a program with a single `push`
anywhere in it, every array handed to a Java API is copied, including arrays
that never grow and are never touched after construction.

That is the sharpest open question in this document. Three candidate answers,
in the order I would try them:

1. **Per-array, not whole-program.** `hir::escape` and `hir::elements` already
   work per array, and the whole-program property is a conservative summary
   rather than a necessity. An array that provably never grows could stay bare
   in a program where another one does. This is a middle-end change and is
   MainClaude's, and it is worth a number before it is worth asking for.
2. **Pass the wrapper's `items` with an explicit length.** Free, and only works
   where the Java signature takes `(T[], int)` -- which is common in older APIs
   and absent from most of the Android SDK.
3. **Copy, and say so.** A generated binding that copies is not a defect if the
   cost is visible. It becomes one when it is invisible.

**Whatever we choose, the rule should be that a copy is never silent.** Either
the `.d.ts` says so in its doc comment, or the call refuses and asks for an
explicit conversion. A binding layer whose costs are invisible is the thing
every FFI is criticised for, and it is avoidable here because we generate both
sides.

## Java data structures stay Java

Your instinct is right and it is stronger than "not compatible": a JS `Map` and
a `java.util.HashMap` disagree about *key equality*, and that disagreement is
silent.

- JS keys by **SameValueZero**: `NaN` equals `NaN`, `+0` equals `-0`.
- Java keys by `equals`/`hashCode`: `Double.valueOf(NaN).equals(NaN)` is
  **true**, and `Double.valueOf(0.0).equals(-0.0)` is **false**.

So the two agree on `NaN` and disagree on `-0`, which is the worst possible
split -- a test suite passes and one row is wrong. `runtime/jvm`'s own `NtsMap`
exists for exactly this reason; the plan for it says it is a transliteration of
the C table "because JS keys by SameValueZero where `Double.equals` disagrees on
`-0`".

**So `HashMap` is surfaced as `java.util.HashMap`, with its own methods, and is
not a `Map`.** Same for `List`, `Set`, `Optional`, `Iterator`. They appear in
the generated `.d.ts` as themselves, in a `java.util` namespace, and a TS
program that wants JS semantics converts explicitly and pays for it visibly.

The general rule this suggests: **a Java type is surfaced as itself unless the
two are the same object.** The exceptions are the row above -- `String` is the
same object, a bare array is the same object, a whole-buffer `Uint8Array` is the
same object. Everything else keeps its Java identity and its Java methods.

## A worked example

Given `com/example/Session.java`:

```java
package com.example;

import java.util.HashMap;
import java.util.List;

public final class Session implements AutoCloseable {
    public Session(String name, int retries) { … }

    public static Session open(String url) { … }

    public String getName() { … }
    public int getRetries() { … }
    public void setRetries(int retries) { … }

    public String[] tags() { … }
    public HashMap<String, String> headers() { … }
    public List<String> cookies() { … }

    public byte[] read(int n) throws java.io.IOException { … }
    public long id() { … }
    public double score() { … }
    public boolean isOpen() { … }

    @Override public void close() { … }
}
```

`nts bind --jar app.jar --out types/` produces:

```ts
// Generated from com/example/Session.class by `nts bind`. Do not edit.
import type { int, long } from "nts:jvm";

declare namespace java.util {
  /**
   * `java.util.HashMap`. **Not** a JS `Map`: it keys by `equals`/`hashCode`,
   * which agrees with SameValueZero on `NaN` and disagrees on `-0`. Converting
   * costs a full rebuild -- see `toJsMap`.
   */
  class HashMap<K, V> {
    get(key: K): V | null;
    put(key: K, value: V): V | null;
    containsKey(key: K): boolean;
    size(): int;
    keySet(): java.util.Set<K>;
  }
  interface List<E> {
    get(index: int): E;
    size(): int;
    add(element: E): boolean;
  }
}

declare namespace com.example {
  class Session implements java.lang.AutoCloseable {
    constructor(name: string, retries: int);
    static open(url: string): Session;

    getName(): string;
    getRetries(): int;
    setRetries(retries: int): void;

    /** `String[]`. No copy: a TS `string[]` is this array, unless the program
     *  grows an array anywhere -- see "the cliff". */
    tags(): string[];

    headers(): java.util.HashMap<string, string>;
    cookies(): java.util.List<string>;

    /** `byte[]`. No copy when the result is used as a whole `Uint8Array`. */
    read(n: int): Uint8Array;

    id(): long;
    score(): number;
    isOpen(): boolean;
    close(): void;
  }
}
```

Points that example is chosen to make:

- **`String[]` becomes `string[]`**, not `java.lang.String[]`, because it is
  the same object. That is the only array case where the mapping is free.
- **`HashMap` does not become `Map`.** It keeps its Java surface.
- **`byte[]` becomes `Uint8Array`** because `NtsBuffer`'s storage is a `byte[]`
  -- this is the one "JS type" that is genuinely the Java one.
- **`throws IOException` is not in the signature.** See the open questions:
  exceptions crossing a call are unimplemented on *every* backend, so this is
  not a binding decision yet.
- **Nullability is not shown** on `getName()`, and that is a lie the next
  section has to fix.

## Nullability, which Java cannot tell us

Java's type system does not express it, which is why Kotlin had to invent
platform types. The options, and I would take the third:

1. **Everything is `T | null`.** Correct, unusable -- every call site needs a
   narrowing for a value that is never null in practice.
2. **Everything is `T`.** Usable, wrong, and wrong *silently*.
3. **Read the annotations, default the rest to `T | null`, and let a
   side-file override.** `@Nullable`, `@NonNull`, JSpecify's
   `@NullMarked` package annotations -- all of which are in
   `RuntimeVisibleAnnotations` and readable from the class file. The Android SDK
   is extensively annotated. For a jar that is not, a checked-in overrides file
   turns the default off per package or per method, and **that file is the
   honest place for a human judgement** rather than a flag that silences
   everything.

## Explicit conversions

Yes, we need them, and naming them well is most of the DX.

```ts
import { toJavaList, toJsArray, toJavaMap, toJsMap } from "nts:jvm";

const headers = toJavaMap(new Map([["accept", "application/json"]]));
const cookies: string[] = toJsArray(session.cookies());
```

Three rules I would hold to:

- **A conversion that copies is a call you can see.** No implicit coercion at a
  call boundary for anything in the copy column above. The compiler knows the
  descriptor, so it *could* insert one; the argument for not doing it is that an
  invisible O(n) inside a loop is exactly the performance bug this project
  exists to avoid.
- **A conversion that does not copy is not a function.** `string` to `String`
  needs no `toJavaString`, and offering one would teach people the wrong cost
  model.
- **The direction is in the name.** `toJavaMap` / `toJsMap`, not `convert`.

## Branded types

You proposed `type int = number & { __type: "int" }`. **That exact shape is
refused by this compiler today**, and the reason is measured rather than
incidental -- `lower.rs:6570`:

> `TypeKind::Intersection` falls here, and **that is a decision** rather than an
> omission. It is tempting and it is wrong, measured on 2026-09-12. The rule
> that suggests itself -- take whichever member has a concrete representation,
> since `object` and `unknown` constrain nothing -- cleared 37 of 39
> intersection refusals in `util` and `stream`, which read exactly like
> progress. It answers incorrectly.

So the obvious implementation of branding is the one already tried and rejected.
Three things follow.

**First: for the Java direction, branding is mostly unnecessary.** The binding
table carries the Java descriptor, so the compiler already knows `setRetries`
takes an `I` and can insert the `d2i` itself. `int` in the `.d.ts` is
*documentation* -- it tells the reader the value is truncated -- and does not
have to be a distinct type to the checker for the call to be correct.

**Second: the one case that genuinely needs a distinct type is `long`.** A Java
`long` does not fit in a `double`, so it cannot be `number` without lying.
`bigint` is already distinct in TS and already 64-bit-capable here, so `long`
maps to `bigint` and needs no brand at all.

**Third: for *your* other use -- telling the compiler "specialise this as an
i32" -- a brand is the right idea and needs a narrower rule than the rejected
one.** The rejected rule was "an intersection takes whichever member has a
concrete representation", and it broke on the shape `in` produces, where the
other member is `Record<K, unknown>`. A brand is structurally different: its
non-primitive member declares only phantom properties. So the candidate rule is

> an intersection of a primitive with types that declare **only** properties of
> a phantom type is that primitive

which does not cover the `in` shape and is checkable against the same corpus the
rejected rule was measured on. **That measurement is the first thing to run
before any of this is built**, because if it fails the same way, branding for
optimisation is off the table and only the binding-table route remains.

The same argument extends to `size_t`, `uint32_t` and the C/LLVM lanes, and the
same measurement settles all of them at once.

## The reverse direction: shipping a Java library

Already works; what is missing is packaging, and these are decisions rather than
research:

- **The package name is fixed at `nts.gen`.** A library wants `com.example.foo`.
- **There is no jar target.** `emit-jvm --out` writes a directory of classes and
  the runtime jar beside them; a library wants one jar with a manifest, and the
  runtime either shaded in or declared as a dependency.
- **The public surface is every export.** A library wants to choose.
- **`-sources.jar`** for hover documentation is explicitly a non-goal in the RFC
  and I would keep it that way until somebody asks.

## What this document does not answer

Named rather than discovered later:

- **Exceptions crossing the boundary.** A Java method that throws has no
  representation here, because a throw crossing a call is unimplemented on
  *every* backend. Until that lands, a `throws` clause cannot be honoured and a
  Java exception escaping into compiled code is undefined. This is the largest
  unaddressed item and it is not binding-specific.
- **Threads.** `NtsEnv` is per-environment with one atomic inbox; an Android API
  that calls back on another thread has nowhere to land.
- **Lifetime.** Under `NoGc` the platform collector owns everything, so there is
  no retain to insert -- which is the one place this is *easier* than the native
  lane's FFI would be.
- **Generics.** The `Signature` attribute survives erasure and is readable, so
  `List<String>` is recoverable; whether we surface type parameters or erase to
  `unknown` is unsettled.
- **Overload collapse.** `f(int)`, `f(long)`, `f(double)` all become
  `f(number)`. TS overload signatures can express the declaration; which one a
  call resolves to has to come from the binding table, and ambiguity has to be
  an error rather than a guess.

## What to build first

In this order, because each produces something falsifiable:

1. **The class-file reader**, in `compiler/jvm-emitter` -- same crate as the
   writer, same format from the other end. Testable immediately and with no
   design decisions: read any jar, compare against `javap -p -s`, which has been
   this lane's oracle three times this week.
2. **The brand measurement** above, over the same corpus that refuted the
   rejected rule. It decides whether branded types are available at all, and it
   is a day.
3. **The interop copy measurement.** Take one real Android API shape -- an array
   in, a `HashMap` out -- and measure the copy against the call. If the copy is
   noise next to a binder transaction, the cliff matters less than this document
   assumes and the per-array analysis can wait.
4. **`.d.ts` generation for one class**, end to end, with the overrides file and
   the doc comments that name the copies.

Nothing here should be built before (2) and (3), because both can change the
shape of everything above them.
