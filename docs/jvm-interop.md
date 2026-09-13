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
| `Map` / `Set` | `java.util.Map` / `Set` | **a copy today, and avoidable** -- `NtsMap` can implement the interface. See "Avoiding the copy entirely" |
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

## Avoiding the copy entirely, which is mostly possible

**Corrected 2026-09-13, and the correction is the most useful thing in this
file.** The section below originally argued that a JS `Map` can never be a
`java.util.Map` because the key semantics differ. The semantics claim was right
and the conclusion drawn from it was wrong.

### The measurement that changes it

    Double.equals(NaN, NaN)   = true      agrees with SameValueZero
    Double.equals(+0, -0)     = false     disagrees
    LinkedHashMap{NaN, NaN, +0, -0}.size() = 3
    the same with -0 normalised to +0      = 2   <- SameValueZero's own answer

`-0` is the **only** disagreement, and SameValueZero's rule for it is that `+0`
and `-0` are the same key. So normalising `-0` to `+0` **at insertion** is not a
compromise: it is what SameValueZero means, and it makes Java's
`equals`/`hashCode` implement it exactly. `NaN` already agrees, because
`Double.equals` compares `doubleToLongBits` and every `NaN` canonicalises.

### So: `NtsMap implements java.util.Map`

**Every operation on `NtsMap` is a `public static` method** taking the map as
its first argument -- `NtsMap.get(map, key)`, never `map.get(key)`. Adding an
interface therefore costs the JavaScript side **nothing**: the emitted code goes
on calling the statics, and the interface methods exist only for a Java caller.
An interface a class does not call through is itable entries and no
instructions.

The pieces are already there:

- `getObject(NtsMap, Object)` -- an object-keyed path exists
- `nextI` / `keyAtI` / `valueAt` -- an index-based iteration contract, which is
  exactly what `entrySet()` is
- `size`, `has`, `set`, `delete`, `clear` -- the rest of `Map`

So the work is an `entrySet()` view plus overrides of the hot methods, with
`Object` ↔ `NtsValue` conversion **at the boundary only**. A Java caller pays a
box per lookup; the JS side pays nothing; **the map itself is never copied.**

Three things to check before building it, because each could make it wrong:

1. **`equals` and `hashCode` change meaning.** `AbstractMap` defines them
   structurally. If anything in this runtime uses an `NtsMap` as a key, or
   relies on identity comparison of two maps, that breaks. Grep before writing.
2. **Iteration order.** JS `Map` is insertion-ordered and `java.util.Map`
   promises nothing, so providing order is a *stronger* guarantee and safe. A
   caller who wanted `HashMap`'s order gets better.
3. **Object keys.** JS keys objects by identity; Java by `equals`. Our objects
   are generated `final class`es that do not override `equals`, so the two
   coincide -- but that is a property of what we generate and should be asserted
   rather than assumed.

### Where the idea comes from

**Kotlin does not have collections.** `kotlin.collections.List` *is*
`java.util.List` at run time; `MutableList` is too, with the read-only/mutable
split existing only in the compiler. `kotlin.String` is `java.lang.String`.
Kotlin calls these **mapped types**, and the consequence is that Kotlin never
converts a collection when calling Java -- there is nothing to convert. It buys
that by inheriting Java's semantics wholesale, which it can afford because
Kotlin's `==` on a `Double` *is* Java's.

We cannot inherit Java's semantics, because ours are JavaScript's. **But the
measurement above says the two coincide once `-0` is normalised**, which means
we can take Kotlin's answer anyway for the one structure where it looked
impossible.

**Scala keeps its own collections and wraps.** `scala.jdk.CollectionConverters`
`asJava` returns a *view* -- one allocation, delegating calls, O(1) rather than
O(n). That is the fallback where being the platform type is not available.

**Clojure's persistent collections implement `java.util.Map` and `List`
directly**, read-only, mutators throwing. Same trick as the one proposed above,
in a language whose data structures are nothing like Java's internally.

**GraalVM's Truffle** goes further: a shared `InteropLibrary` protocol where
every language exposes `readMember` / `getArraySize` and nothing is ever
converted. It is the right answer when N languages must interoperate and an
expensive one when there are two.

### The revised cost table

| TS value | Java parameter | today | achievable |
| --- | --- | --- | --- |
| `string` | `String` | free | free |
| `T[]`, non-growing | `T[]` same width | free | free |
| `Uint8Array`, whole buffer | `byte[]` | free | free |
| `Uint8Array`, subarray | `byte[]` | copy | **free** as `ByteBuffer.wrap(storage, off, len)` where the API takes a buffer; copy where it insists on `byte[]` |
| `Map` / `Set` | `java.util.Map` / `Set` | copy | **free**, by implementing the interface |
| object | a Java interface | free | free |
| closure | a functional interface | free | free |
| `T[]`, growing program | `T[]` | copy | **free when `items.length == length`** -- see below |
| `number[]` | `int[]` | copy | copy. Different element widths; nothing avoids it |
| `bigint` | `BigInteger` | copy | copy. Arbitrary precision from 128 bits is a construction |

### The growable-array case, which is the one left

The wrapper holds `items` and a `length`, and `items` is usually longer. But
**when they are equal the wrapper's `items` is already exactly the array Java
wants**, and it can be passed with no copy at all.

That suggests a cheap answer short of the per-array analysis: a `trim()` that
reallocates once so that every subsequent crossing is free. An array built by
`push` in a loop and then handed to Java repeatedly pays one copy instead of
one per call. Whether that is worth having is a measurement -- how many
crossings per array -- and it is the kind of number this document should not
guess at.

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
not a `Map`.** This is the *inbound* direction and it does not contradict the
section above: a `java.util.HashMap` handed to us keeps Java's key semantics and
must not be dressed up as a JS `Map`, while an `NtsMap` handed to Java can
implement `java.util.Map` faithfully. The asymmetry is real -- SameValueZero is
the *stricter* rule once `-0` is normalised, so our map satisfies Java's
contract and a Java map does not satisfy ours. Same for `List`, `Set`, `Optional`, `Iterator`. They appear in
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

# Every cost named, and what eliminates it

Written because a plan that lists costs and stops is a plan that has decided to
pay them. Each row below is either eliminated, or says plainly why it cannot be
and how rare it is.

## The framing that makes most of this possible: there is no boundary

On the C lane an FFI is a real thing -- a calling convention, a marshalling
step, a place where the two sides genuinely differ. **On this lane both sides
are JVM bytecode.** A call into Java is an `invokevirtual`, indistinguishable
from a call into our own emitted code. There is no crossing to make cheap.

So every cost in this document is a **representation mismatch** and nothing
else, and a representation mismatch is eliminable by changing a representation.
That is why the list below ends mostly in "eliminated" rather than "reduced".

## 1. Boxing at the `Map` boundary — *reduced to the caller's own*

A Java caller writing `map.get(1.0)` autoboxes a `Double` **in their code,
before the call**. Nothing we do removes it; it is not ours.

What is ours: `getObject(NtsMap, Object)` already exists and looks a key up
without allocating on our side, so the cost is a hash and a compare.

**And the interface is not the only surface.** `NtsMap` keeps its `public
static` primitive paths, so a Java caller who cares calls
`NtsMap.getDouble(map, 1.0)` and boxes nothing. Kotlin does exactly this --
the mapped interface for compatibility, specialised operations beside it.

Residual: a caller who insists on `Map.get(Object)`. HotSpot's escape analysis
removes the box when the call inlines; ART's is weaker and will not.

## 2. `number[]` → `int[]` — *eliminated, and it is the headline*

This is the same defect as the worst Bar 1 row on ART, already measured in
`benches/jvm-rows.md`, five interleaved rounds:

    A  int[]     + instance methods   8752.2 ns    AWFY as written
    B  double[]  + instance methods   9995.5 ns    +14.2%
    ours                             10970.7 ns    +25.3%

**The element type alone is 14.2%.** The named blocker is small: `hir::runtime`
has `nts_array_fill_bool` and **no `_i32`**, so an integer array falls back to
`f64`. A `double[]` is eight bytes an element against four, an `i2d` per store
and a `d2i` per read.

So one change -- carrying integer-ness into the array's element type --

- **eliminates this interop copy entirely** (an `int[]` is the `int[]` Java
  wants);
- is worth **~14%** on `awfy-queens`, the worst row on the goal's open number;
- is **not JVM-only**: the note recording it says both native lanes carry it;
- and it is `hir::elements`' with a `hir::runtime` row beside it, which is the
  same two-lane coordination as `nts_uncaught_builtin` and is already rehearsed.

**Nothing else in this document has that ratio of leverage to size.**

## 3. `bigint` → `BigInteger` — *unavoidable, and scoped*

Arbitrary precision from a fixed 128 bits is a construction, not a view.
Extending `BigInteger` would mean maintaining its representation *and* ours,
which is worse than the copy.

Scoped instead: **`long` is the Java integer type that appears in APIs**, and it
is free -- `NtsBigInt.lo` is the value. `BigInteger` appears in cryptography and
almost nowhere else. Documented as a copy at the one place it happens.

## 4. The growable-array wrapper — *three eliminations, in order*

1. **Free already, and untaken.** When `items.length == length` the wrapper's
   `items` *is* the array Java wants. Detect and pass it through; this is ours
   and costs nothing.
2. **`trim()`** where they differ: one copy, amortised over every later
   crossing, instead of one per call.
3. **Per-array, not whole-program** -- the real fix. `hir::escape` and
   `hir::elements` already work per array; the whole-program summary is
   conservative rather than necessary. An array that provably never grows stays
   bare in a program where another one does, and the cliff disappears.

## 5. `Uint8Array` subarray → `byte[]` — *eliminated in the common case*

- **`ByteBuffer.wrap(storage, offset, length)`** is a zero-copy view, wherever
  the API takes a buffer.
- **Prefer the offset/length overload.** `InputStream.read(byte[], int, int)`,
  `OutputStream.write(byte[], int, int)` and most of `java.nio` have one. The
  binding table knows every overload, so the generator routes to the one that
  takes an offset and copies nothing.

Residual: an API taking a bare `byte[]` with no offset form and no buffer form.

## 6. `AbstractMap` redefining `equals`/`hashCode` — *eliminated by not using it*

Implement `java.util.Map` directly rather than extending `AbstractMap`, so every
method is ours and none is inherited. Verify first that nothing in this runtime
uses an `NtsMap` as a key; if something does, that site takes an
`IdentityHashMap`.

## 7. Interface dispatch on `NtsMap` — *zero, by construction*

Every operation is a `public static` taking the map as its first argument, so
emitted code never calls through the interface. An interface a class does not
call through is itable entries and no instructions.

## 8. Closure → Java functional interface — *eliminated*

The backend already emits one `nts/gen/Fn$<hash>` class per closure descriptor.
**Adding `implements com.example.Listener` to it is free**, and the binding
table says which interface. No adapter object, no wrapper, no allocation per
crossing. A closure passed to two different Java interfaces implements both,
which a class may do.

## 9. Overload collapse — *eliminated by distinguishable types*

`f(int)`, `f(long)` and `f(double)` collapse to `f(number)` only if `int` and
`long` are not distinguishable in the `.d.ts`. `long` is already distinct --
it is `bigint`. `int` needs the brand, which is the next row. With both, the
three are three TS overloads and resolution is the checker's.

Where they remain ambiguous, **the binding refuses rather than guesses**.

## 10. Branded types hitting the intersection refusal — *two routes, one needs no compiler change*

- **For the Java direction, none is needed.** The binding table carries the
  descriptor, so the compiler inserts the `d2i` itself and `int` in the `.d.ts`
  is documentation. This works today.
- **For directing the compiler**, the narrow rule -- *an intersection of a
  primitive with types declaring only phantom properties is that primitive* --
  does not cover the shape that broke the rejected rule, and is one measurement.

Kotlin's own answer is worth noting because it is neither: `@JvmInline value
class Meters(val v: Double)` erases to a bare `double` and is **nominal**. TS has
no such declaration, which is why the intersection hack exists at all.

## 11. `d2i` at an integer boundary — *one instruction, and eliminated by row 2*

Where the value is already an `i32` there is nothing to convert. Same fix.

## 12. Nullability — *not a speed cost*

Annotations plus a checked-in overrides file. It costs DX and correctness
attention, not instructions.

# What this adds up to

Of twelve named costs, **eight are eliminated outright**, one is reduced to the
caller's own choice, two are unavoidable and rare enough to name at their single
site, and one is not a speed cost at all.

And the ordering falls out of it rather than being chosen: **row 2 is first**,
because it is the only one that pays for itself before any of this is built --
14.2% on the worst row of the goal's open number, shared by all three backends,
blocked on a missing `_i32` in a table that already has `_bool`.
