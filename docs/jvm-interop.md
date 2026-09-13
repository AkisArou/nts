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
import type { int } from "nts:jvm";

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

    /** Java `long`. `bigint`, not `number`: 64 bits do not fit in an f64. */
    id(): bigint;
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

## Inbound is not outbound, and the asymmetry decides the signatures

Two questions that look like one:

- **Can our `Map` be a `java.util.Map`?** Yes, free -- every `NtsMap` operation
  is a `public static`, so nothing calls through the interface.
- **Can a `java.util.HashMap` be our `Map`?** That is a different change and a
  much worse one.

**For a Java collection to serve as a JS one, our operations would have to go
through an interface** rather than statics on the concrete class -- every JS
`Map` read in every program becoming an `invokeinterface`, to serve the programs
that talk to Java. That is the wrong trade at the wrong scale.

And two semantics fail inbound that hold outbound:

- **Iteration order.** JS `Map` guarantees insertion order. `HashMap`
  guarantees none; `LinkedHashMap` does. Outbound we satisfy `Map`'s contract by
  being *stronger*; inbound a declared `HashMap` cannot satisfy ours. This is
  not an edge case -- it is every `for (const [k, v] of m)`.
- **`-0`.** Outbound we control insertion and normalise, so SameValueZero holds
  exactly. Inbound, Java may already have stored `+0` and `-0` as two keys, and
  no JS `Map` can represent that.

So `headers()` stays `java.util.HashMap<string, string>`. A declared
`LinkedHashMap` is the one case where `Map` would be defensible, and only if the
interface-dispatch cost were acceptable, which it is not.

### Arrays: the Java type matters more than the Java-ness

Measured, not argued:

    export function tags(): string[]    ->  public static java.lang.String[] tags()
    export function nums(): number[]    ->  public static double[] nums()
    export function flags(): boolean[]  ->  public static boolean[] flags()

**A TS `string[]` *is* a `java.lang.String[]`** -- free in both directions, which
is why `tags(): string[]` in the example above is right and costs nothing coming
back from Java either.

**`List<String>` is not an array and cannot be made one.** `toArray` is a copy;
backing a JS array with a `List` would make every index an `invokeinterface`,
and a bare array's one-instruction `aaload` is the reason the array rows are
what they are. So `cookies()` stays `java.util.List<string>`.

**Which gives the generator a rule:** where a Java API offers both a `String[]`
and a `List<String>` form -- and many do -- **bind the array one.** It is free
and the other is not.

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

**Reordered after the cost analysis below, which found that the first item pays
for itself before any interop exists.** The original order led with the
class-file reader; it is now fourth, because three things settle questions that
change the shape of everything after them.

1. **The brand measurement**, and it is first because everything numeric waits
   on it. Does *an intersection of a primitive with types declaring only phantom
   properties* survive the corpus that refuted the broader rule? One day. It
   decides three things at once: whether `int` is expressible in a `.d.ts`,
   whether Java overloads resolve or must be refused, and -- because the element
   type **is** the TypeScript type -- whether an array can ever be an `int[]`.
2. **The array element type**, once (1) says an integer type is expressible.
   Measured at **14.2%** on `awfy-queens`, the worst row of the goal's open
   number, and carried by all three backends. A `hir::runtime` `_i32` row is
   part of it and was tested alone and does nothing; the type is the blocker.
3. **The interop copy measurement.** One real Android API shape, an array in and
   a `HashMap` out, measured against a binder transaction. If the copy is noise
   next to the call, the cliff matters less than this document assumes.
4. **The class-file reader**, in `compiler/jvm-emitter` -- same crate as the
   writer, same format from the other end. Testable immediately and with no
   design decisions: read any jar, compare against `javap -p -s`, which has been
   this lane's oracle three times this week.
5. **`NtsMap implements java.util.Map`**, with the `-0` normalisation that makes
   Java's `equals` implement SameValueZero exactly, and the primitive statics
   kept beside the interface.
6. **`.d.ts` generation for one class**, end to end, with the overrides file and
   the doc comments that name the copies.

Nothing after (3) should be built before it, because (2) and (3) can each change
the shape of everything below them.

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

**The element type alone is 14.2%.** A `double[]` is eight bytes an element
against four, an `i2d` per store and a `d2i` per read.

**And the blocker is not what this file first said it was.** It read "the named
blocker is small: `hir::runtime` has `nts_array_fill_bool` and no `_i32`".
Tested on 2026-09-13 by adding that row with the backend mapping beside it:
**nothing moved**, and `arrayFillInt` was called zero times. The row is
necessary and nowhere near sufficient.

The real blocker is one line of the case's own source:

    freeMaxs: boolean[] | null;     ->  [Z
    queenRows: number[] | null;     ->  [D

**The element type is the TypeScript type.** `boolean[]` is `[Z` because
TypeScript *has* a `boolean`; `number[]` is `[D` because its only numeric type
is an f64. The `_bool` helper exists **because** `boolean[]` exists -- the
helper follows the type, not the other way round.

So `int[]` needs TypeScript to be able to *say* "array of 32-bit integers".
`number[]` cannot: `elements.rs` notes that "any `number[]` can be passed
anywhere another is expected, so every array with the same element type has to
be treated as one", which is why narrowing one array and not another breaks
assignability. `Int32Array` is distinguishable and is not this either -- it maps
to `NtsViewI32`, a view over an `NtsBuffer` whose storage is a `byte[]`.

**This is why the branded type is row 1 and not a DX nicety.** It is the only
mechanism on the table by which an array can be an `int[]` at all.

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

## 10a. The integer array needs no brand — TypeScript already has one

**This supersedes the branded-array argument above and removes the decision it
was waiting on.**

The hazard that made branding dangerous is covariance: TypeScript makes
`number & Brand` a *subtype* of `number`, so `Int32[]` is assignable to
`number[]`, and an `[I` reaching a parameter typed `number[]` would be read as
`[D`. Since the corpus contains no branded primitives at all, that boundary
could not be measured -- it had to be decided.

**`Int32Array` is not assignable to `number[]`, and the checker says so:**

    TS2740 Type 'Int32Array<ArrayBuffer>' is missing the following properties
           from type 'number[]': pop, push, concat, shift, and 6 more.

So the separation the brand needed a new rule to enforce is **already enforced
by TypeScript's own structural check**, because a typed array is not an `Array`.
No language surface to add, no assignability decision to take, no new
intersection rule to measure.

What is left is purely representational: `Int32Array` maps today to
`NtsViewI32`, a view over an `NtsBuffer` whose storage is a `byte[]`. A
standalone `new Int32Array(n)` allocates its own buffer, and **if the program
never observes `.buffer` that buffer is unobservable** -- so a bare `int[]` is
equivalent. That is `hir::escape`'s question, and it is the same machinery the
growable-array cliff wants.

**And it is the honest binding for a Java `int[]`**, which is what this section
of the document was originally about. `int[]` ↔ `Int32Array` is free, idiomatic
on both sides, and needs nothing invented.

**What it does not solve**, said plainly: a plain `number[]` holding only
integers stays `double[]`. Narrowing that is inference rather than declaration,
it is the larger prize, and it can land later without invalidating any of this.
And the 14.2% on `awfy-queens` is only realised if the *source* says
`Int32Array` -- which for a benchmark mirroring Java's `int[]` is arguably more
faithful than `number[]`, but is a fixture change and should be argued as one
rather than slipped in.

## 10b. Branded types for everything else

 — *two routes, one needs no compiler change*

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

# The two caveats, and what each is actually worth fixing

## The benchmark caveat must not be fixed, and that is the finding

`awfy-queens` declares `queenRows: number[]`, so it is emitted `[D` and carries
the 14.2%. Writing `Int32Array` there would take the row. **It would also stop
measuring the thing the row exists for.**

AWFY's own JavaScript, checked rather than assumed:

    this.queenRows = new Array(8).fill(-1);      benchmarks/JavaScript/queens.js
    private int[] queenRows;                     benchmarks/Java/Queens.java

Our TypeScript mirrors the JavaScript; the `Java` column mirrors the Java; the
bar is our compiled TypeScript against hand-written Java. **Rewriting our source
to `Int32Array` would be hand-optimising the input to beat the reference**,
which is the one thing a benchmark suite may never do -- and this file already
has the sentence for it, about an arm that stayed in an example rather than
being trimmed to make three backends agree.

So the 14.2% is a **true cost of compiling idiomatic JavaScript to this
platform**, and the only legitimate way to remove it is for the compiler to
infer what the programmer did not say. That is the whole of the fix and there is
no shortcut past it.

## The DX caveat is half inherent and half the same fix

`Int32Array` has no `push`, and that is JavaScript's rule rather than ours -- a
typed array is a fixed-length window, which is *why* it can be a bare `int[]`.
Adding `push` to it would diverge from node, and node is the oracle.

So the gap is exactly **a growable integer array**, and for that the answer is
again inference: a `number[]` that is pushed to *and* provably holds only int32
can be an `int[]` behind the growable wrapper -- which needs an `NtsArrayI` with
`int[] items` beside the existing `NtsArrayD`, and is a small runtime addition
once the analysis exists.

**Both caveats therefore reduce to one analysis**, which is worth saying because
it changes what to build rather than how much.

## What that analysis is, and how far the tree is from it

Today the decision is one line:

    pub fn arrays_can_grow(program: &Program) -> bool {
        program.funcs.iter().any(|func| {
            func.values.iter().any(|op| matches!(&op.kind,
                OpKind::Call { callee: Callee::External(name), .. }
                    if changes_array_length(name)))
        })
    }

**One global `any`.** No per-array tracking of any kind -- one `push` anywhere
in the program answers for every array in it. The same shape governs the
element width, because `elements.rs` keys on the element *type* and every
`number[]` is one type.

The general answer is to **partition instead of globalise**: union-find over
array-typed values, joined by assignment, parameter passing, return, field
store and element store, and then ask each class rather than the program. A
class whose members never reach a growing call stays bare; a class whose members
only ever hold int32 becomes `int[]`.

That single change would:

- remove the growable cliff, which is the copy on **every** array handed to Java
  in a program containing one `push`;
- give `int[]` to `number[]` without any new language surface;
- and therefore close both caveats and the interop copy together.

### Three slices, cheapest first

Worth stating separately because the general version is a real project and the
first slice is not:

1. **Arrays that never escape their function.** `hir::escape` already answers
   this. No other `number[]` can alias them, so their representation is free.
   Smallest possible slice, and it needs no new analysis at all.
2. **Arrays reachable only through one field of one class.** `fields::analyze`
   already "gives a field read the facts of every store into it", so the
   machinery is adjacent. **This is the slice that covers `queenRows`**, which
   is `this.queenRows` and therefore escapes its function.
3. **Full equivalence classes**, as above.

All three are `hir`'s rather than this lane's. What this lane can do is supply
the number each slice is worth, which for slice 2 is already measured at 14.2%
on the worst row of the goal's open number.

# The element width, settled: narrowing exists and one filter blocks it

**This supersedes everything above about a union-find project.** Three positions
were taken on this in one day and the middle one was invented; the third is
verified from the pass and independently from the corpus.

**Narrowing `number[]` to an integer array already exists and already fires.**
`hir::elements::representations` maps an `f64` element to an integer one, and
`erasure-stored-unknown` emits both from a single program:

    newarray double        and        newarray long

`width_for` returns `HirType::Int { bits, signed: true }`, so `int[]` is a
target rather than a wish.

**What blocks `queenRows` is one filter, and it is a global `any`:**

    .filter(|(element, _)| !borrowed.contains(*element))

`reaches_a_runtime_helper` walks every function, takes every `Callee::External`
call, and inserts the element type of every array-typed argument. No call-site
condition, no per-array scope. `new Array(8).fill(-1)` reaches `nts_array_fill`,
so `f64` enters `borrowed`, so **every `number[]` in the program** is
disqualified.

## Two pieces, and their real costs

**Piece 1 — the filter disqualifies only where no narrowed form of that helper
exists.** Not merely "a narrowed form exists somewhere": it has to be reachable
for *that* call, or the pass keeps an `int[]` and hands it to a helper expecting
`[D`. **That is the covariance hazard again, arriving at the helper boundary
instead of the assignment**, and the current filter is conservative in the safe
direction -- it gives up narrowing rather than mis-narrowing. So the failing arm
gets written before the fix, not after.

**Piece 2 — the `_i32` helper rows, and they are not one row.** A new runtime
helper lands in **three tables**: `hir::runtime`, the LLVM signatures, and this
lane's. `tooling/gate/bench-agree.sh` is 111 lines with **no allowance list** --
checked, not remembered -- so a helper present in two of three **red-gates the
third** rather than skipping it. The C implementation and the LLVM signature are
one lane's; the JVM row is this one's. Piece 2 is a coordinated change by
construction and the estimate has to say so.

## What this retracts

- **"The element type is the TypeScript type."** Wrong. It is the TypeScript
  type *until* `representations` narrows it, and narrowing is live.
- **The union-find project.** Not needed for the element width. The growable
  cliff is a *different* global `any`, in `arrays_can_grow`, and still wants
  partitioning -- two global filters folded into one problem because both were
  global.
- **"Slice 1 is free."** `escape.rs` exposes `escapes()`, `is_frame_local()` and
  `analyze_program()`, and **nothing surfaces them** -- `escape::` appears
  nowhere in the CLI. The count wants a ~30-line instrument, not a grep.

## And the sequence, which is the part worth keeping

    P1  "because `hir::runtime` has no `_i32`"   weeks old, never applied
    P2  added the row, nothing moved, so
        "the element type IS the TypeScript type"   invented and published
    P3  read the pass: narrowing was *disqualified*, not never attempted

P2's observation was correct and its *because* was manufactured, four messages
after this lane coined the phrase for exactly that failure -- and with
`elements.rs`' own warning twelve lines from the code being reasoned about:
**"reading the code and reading the emitted IR are two measurements and only the
second was right."** The IR was read. The pass was not.

# Open questions, reviewed before building anything

A design review of this document against the tree, done deliberately rather than
discovered during implementation. Grouped by whether they **block**, whether
they are a **decision**, or whether they are **deferrable** — because the first
group changes what gets built and the others only change what it looks like.

## Blocking: HIR cannot represent a foreign object

**The largest gap in this plan and it was not in it until now.**

    pub enum ManagedType {
        String, Object(TypeId), Array, Promise, Map, Table,
        Set, Date, Buffer, View, AnyView, DataView, Symbol,
    }

Thirteen variants and **every one is a type this compiler knows structurally**.
`Object(TypeId)` is one of *our* layouts — fields the compiler knows, owns and
reasons about. A `com.example.Session` instance is none of these: we cannot see
its fields, we do not own its layout, and we must not pretend to.

So **there is today no type a bound Java object could have.** Everything else in
this document — the method calls, the `HashMap` surface, the closure
implementing a listener — assumes a value that can be typed and passed, and
nothing can type it.

Three routes, and they are not equivalent:

1. **A new `ManagedType::Foreign(binary name)`.** Honest: an opaque reference
   the compiler may pass, store and call methods on, and may never look inside.
   It is a middle-end change and therefore not this lane's.
2. **A synthetic `Layout` marked opaque.** Reuses `Object(TypeId)`, so nothing
   downstream changes — and risks every pass that reasons about fields
   reasoning about fields we do not own. `fields::analyze` joins over "every
   `FieldSet` that can reach a field", and its soundness argument is *"nothing
   else can store into it: there is no FFI that writes through a pointer here"*.
   **A foreign object falsifies that sentence**, which is the kind of
   precondition this repository has a record about.
3. **Erase to `NtsValue`.** Works today and destroys the property the whole
   document rests on — every crossing becomes a box, and "there is no boundary"
   stops being true.

**Route 1 is the only one that keeps the plan's central claim**, and it is the
first thing to settle because everything else is downstream of it.

`Layout.base` **does** exist (`hir/mod.rs:1361`), so inheritance is representable
— but a TS class extending a Java one needs `base` to name a foreign type, which
is this same question. **Android needs that constantly**: `extends Activity`,
`implements OnClickListener`.

## Decisions, not research

- **How does user code name a Java class?** The generated `.d.ts` declares
  `namespace com.example`, and **nothing in this document says how a program
  references it.** `import { Session } from "java:com.example"`? An ambient
  global? This is the primary DX question and it is unanswered.
- **Static fields and constants.** `View.VISIBLE`, `Integer.MAX_VALUE`. Fields
  rather than methods, and not addressed anywhere above.
- **Java enums.** Classes with static instances plus `values()` and `valueOf()`.
- **Nested and inner classes.** `Map.Entry` is static; `View.OnClickListener` is
  an interface; a true inner class captures an outer instance and has a
  synthetic constructor parameter.
- **Varargs.** `f(String...)` is `f(String[])` with a call-site convention.
- **Name collisions.** A Java member called `constructor`, or a TypeScript
  keyword.
- **Ambiguous overloads.** Stated above as "the binding refuses rather than
  guesses" — that is a rule and should be written as one, with the error text.
- **Generated or checked in?** Generated at build is reproducible and slow;
  checked in is fast and goes stale. `runtime_jar.rs` is the model for detecting
  staleness — rebuild and compare byte for byte — and the same shape works for a
  `.d.ts` against its jar.
- **Transitive closure.** Binding `android.jar` wholesale is enormous; binding
  on demand makes the `.d.ts` grow as the program uses more, which is a strange
  thing for a checked-in file to do.

## Deferrable, and named so they are not discovered

- **Exceptions crossing a call** — unimplemented on *every* backend, so a Java
  method that throws has no representation. Not binding-specific and the largest
  of these.
- **Threads.** `NtsEnv` is per-environment with one atomic inbox. **An Android
  API that calls back on another thread has nowhere to land**, which is most of
  the interesting Android surface.
- **Generics.** The `Signature` attribute survives erasure and is readable;
  whether to surface type parameters or erase to `unknown` is unsettled.
- **Lifetime.** Nothing to do — under `NoGc` the platform collector owns
  everything, which is the one place this is easier than the native lane.
