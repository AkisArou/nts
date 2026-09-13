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

## The open questions, and where each is now answered

**This section went stale, and the way it went stale is the thing it should be
read for.** It was written as a list of what the document does not answer.
Four of its five entries were then answered *further down the same document*,
and the list kept saying they were open. Two derivations of one fact, in one
file, disagreeing -- which is the failure this document spends a section warning
about. So the list now points at the answer rather than restating the question.

- **Exceptions crossing the boundary.** **Answered -- see drawback 9.** The
  entry said a Java exception escaping into compiled code is "undefined". It is
  not, as of `5b865f62`: the emitter has exception tables, so a throwing call is
  wrapped and the handler raises `NtsRefusal`, which the harness already carves
  out of its Defect rule. The case *declines*, naming the Java exception. What
  remains open is narrower -- a Java exception becoming a TypeScript `catch` --
  and that waits on a shared change already on MainClaude's list, not on
  anything binding-specific.
- **Threads.** **Answered -- see drawback 6.** The entry said an Android API
  that calls back on another thread "has nowhere to land". `NtsEnv.CURRENT` is
  a `ThreadLocal`, not a singleton pinned to a thread the runtime chose, so an
  environment can be installed on the thread the callback arrives on and the
  call is direct. `NtsInbox` handles genuinely foreign threads, and those
  callbacks are void.
- **Lifetime.** Never open. Under `NoGc` the platform collector owns everything,
  which is the one place this is easier than the native lane's FFI.
- **Generics.** **Answered below**, and it was the only genuinely open one.
- **Overload collapse.** **Answered -- see "Ambiguous overloads mostly are not
  ambiguous".** A TypeScript `number` *is* an f64, so `f(double)` is the only
  non-lossy receiver and picking it is not a guess; ties go to JLS 15.12.2,
  which is the algorithm `javac` runs over the same class-file data.

### Generics: surface the type parameters, because both languages erase

The `Signature` attribute carries `List<String>` through erasure and the reader
parses it either way. The question was whether to surface the parameters or
erase them to `unknown`.

**Surface them, and the argument that settles it is that the two erasure models
coincide exactly.** Java erases generics at runtime; so does TypeScript. A
`List<String>` is a `List` at runtime in both languages and the parameter is a
compile-time claim in both. So surfacing promises exactly what Java promises --
no more -- while erasing to `unknown` throws away a guarantee we can actually
keep. The DX difference is `list.get(0).length` against
`(list.get(0) as string).length`, on every element access in the program.

Four specifics, so this is a decision rather than a direction:

- **Raw types** -- a pre-generics `List` with no parameter -- become
  `List<unknown>`, not `List<any>`. Refuse rather than miscompile, the same rule
  as unannotated nullability.
- **Wildcards.** `List<? extends Number>` is a read-only view and TypeScript has
  no wildcard; the honest mapping is `readonly` in the covariant position.
  `? super T` in a parameter position becomes `T` for callers, which is sound
  because any `T` is an acceptable argument.
- **Method type variables** -- `<T> T[] toArray(T[] a)` -- map directly and need
  nothing special.
- **Self-bounded generics** -- `Enum<E extends Enum<E>>` -- are expressible in
  TypeScript but noisy enough to be worth binding in erased form with a comment
  saying so. One family, and naming it is cheaper than generating it.

**The hole we inherit, stated rather than discovered.** A TypeScript generic is
unchecked at runtime, so a `List<string>` whose Java side was sloppy can hand
back an `Integer` and the `string` annotation is simply wrong. That is *exactly*
Java's own exposure -- heap pollution, a `ClassCastException` at the use site,
and the reason unchecked warnings exist. We inherit the guarantee and the hole
together, which is the honest position and is strictly better than pretending
`unknown` would have caught it.

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

# Proposals for each open question

One per question above, concrete enough to argue with. Where a proposal rests on
something in the tree it says which.

## 1. Foreign objects: a layout, a naming rule, and one constraint

**No new `ManagedType` variant, and no flag.** A bound Java class becomes a
`Layout` with **zero fields**, `methods` holding its Java methods, and a `name`
carrying the binary name behind a reserved prefix. A backend seeing that prefix
emits nothing for the class and uses the binary name at call sites.

The precedent is in this tree and is explicit about why:

> Whether a layout name was made by `signature_name`. **By prefix and shape
> rather than by a flag on the layout**: `Layout` is what three backends read,
> and a field that exists to tell two of its own names apart is a field they
> would all have to ignore.

**The constraint that makes it sound: the binding surfaces every member as a
method, never as a field.** Then a foreign object never appears in a `FieldGet`
or `FieldSet`, and `fields::analyze`'s soundness sentence -- *"nothing else can
store into it: there is no FFI that writes through a pointer here"* -- stays
true, because there is no field for a foreign write to land in.

**One risk to check before building:** `same_shape` merges layouts with
identical fields and methods, and two field-less Java classes could collide.
That is the same hazard `signature_name` was written for, and the same answer --
the name carries the identity — but it should be *tested*, not assumed.

## 2. Imports: ambient modules, which already work here

    import { Session } from "java:com.example";

`declare module "java:com.example" { export class Session { … } }` is ordinary
TypeScript and **needs no resolver change**: this tree already ships ambient
module declarations at `runtime/react/generated/compiler-output/ambient.d.ts`.
The generator emits one ambient module per Java package; `tsc` resolves the
import against it; our frontend sees an ordinary import.

## 3. Static constants: inline them, and reference the class not at all

A `static final` primitive carries a **`ConstantValue` attribute in the class
file**, so `View.VISIBLE` can become the literal `0` at compile time — which is
what `javac` itself does. Zero cost, no reference to the class, no binding entry.

A non-constant static becomes a `getstatic` through the binding table, which is
the same shape as a global.

## 4. Enums fall out of (3)

A Java enum is a class with `static final` instances plus `values()` and
`valueOf()`. The instances are statics, so they bind by (3); the two methods
bind as methods.

## 5. Nested classes: surface the static ones, refuse the inner ones

`Map.Entry` is a static nested class -- a class whose binary name contains `$`
-- and surfaces as `Map.Entry` in the namespace with no special handling. A
**true inner** class captures an outer instance and has a synthetic first
constructor parameter; **refuse those by name** until something needs one. They
are rare in public API surface and the refusal is cheap.

## 6. Varargs: surface, pack at the call site

`f(String...)` **is** `f(String[])` in the class file. Surface it as
`f(...args: string[])` and pack at the call site — which is an array
construction, and free when the array is bare.

## 7. Collisions: mangle by a written rule, recorded in the table

A Java member named `constructor`, or a TypeScript keyword. One documented
mangling, recorded in the binding table so the emitted call uses the real name.
The rule matters more than which rule.

## 8. Ambiguous overloads: refuse, naming both

Where `int` and `double` are not distinguishable at a call, **the binding
refuses and names both candidates**, rather than picking one. A wrong overload
is a wrong answer that runs; a refusal is a message.

## 9. Generated or checked in: checked in, with a drift test

`runtime_jar.rs`'s shape exactly — regenerate with a JDK present and compare
**byte for byte**, `NTS_REGENERATE=1` writes, skip without a JDK and **fail**
when one is present and the rebuild differs. Fast for everyone, and a stale
`.d.ts` is caught rather than believed.

## 10. Transitive closure: bind what is named, refuse what is not

Bind the named classes plus whatever is reachable **through surfaced
signatures**, and stop. A type not surfaced is `unknown`, and a call on it
refuses **by name** — so the refusal tells the user exactly what to add to the
bind list. The `.d.ts` stays bounded and its growth is a decision rather than a
side effect.

## 11. Exceptions: bind anyway, and say what happens

A `throws` clause does not prevent binding. Until a throw can cross a call on
any backend, an escaping Java exception behaves exactly as an uncaught one does
today — the process dies with a stack trace. That is a documented limitation
with a named expiry, not a silent gap.

## 12. Threads: the mechanism exists

`NtsInbox.post(Slot, NtsResumable)` is in `runtime/jvm` today, with atomics, and
the provider doc says only the cross-thread inbox is atomic **because one lane
mutates everything else**. So an Android API calling back on another thread has
somewhere to land: it posts, and the work runs on the environment's own lane.

What is unbuilt is the adapter that turns a Java callback into an
`NtsResumable`. That is a smaller thing than "threads are unsupported", which is
what this document said before the inbox was checked.

# What a zero-field layout is, and every drawback it brings

## The idea

A `Layout` is how HIR describes an object type: a name, a list of fields, a list
of methods. For a TypeScript class the compiler **owns** that layout — it chose
where each field lives, so it can emit a field access at a known index and
reason about everything stored there.

For a Java class we own none of it. We cannot see its private fields and its
offsets are the JVM's business. So: a `Layout` whose **`fields` list is empty**.
The compiler knows the type exists and has an identity; it claims to know
nothing about its contents.

That is not a trick. It is the honest statement, and it is safe for a specific
reason: **every pass that reasons about object contents keys on fields.** With
no fields there is nothing for them to conclude, rightly or wrongly.

## Drawback 1, and it nearly sank the proposal: Java has public fields

    public final class android.graphics.Rect {
      public int bottom;  public int left;  public int right;  public int top;

`Rect.left` is read directly in Android code constantly. So the constraint this
document proposed one section ago — *"the binding surfaces every member as a
method, never as a field"* — **is not survivable**, and it took one `javap` of a
real `android.jar` to find out.

**The resolution keeps both properties.** A foreign field access is *not* a
`FieldGet`/`FieldSet` op: it goes through the binding mechanism, like a method
call does, and emits `getfield`/`putfield` directly. Then `fields::analyze`
never sees it — its soundness sentence is about *its own* ops — and `rect.left`
works. The rule becomes **"a foreign member is never one of our field ops"**,
which is about representation rather than about what may be surfaced.

## The remaining drawbacks, each with an example and a fix

Each entry below is a program that hits the drawback, what it costs, the
proposal, and the test that would show the fix landed. Written after reading the
code rather than from the design: **four of them are fixed by a mechanism this
compiler already has**, and one of them turned out not to be a cost at all.

### 2. No optimisation through a foreign object

```ts
let total = 0;
for (let i = 0; i < n; i++) total += rect.right - rect.left;
```

`rect.right` is a foreign member, so `facts.rs` gives its result `Facts::TOP` --
the constant whose own doc says it is "what an unanalyzed parameter or an opaque
call returns": `lo = -inf`, `hi = +inf`, `whole = false`, `maybe_nan = true`,
`maybe_negative_zero = true`. So `total` cannot be proved integral, the
accumulation stays `f64`, and every operation carries NaN and `-0` handling.

**The cost is not that a Java `int` is imprecise. It is that we threw away what
the descriptor already told us.** The fix has two halves:

- **The descriptor is a fact source.** A member returning `I` has
  `lo = -2^31`, `hi = 2^31 - 1`, `whole = true`, `maybe_nan = false`,
  `maybe_negative_zero = false`. That is strictly tighter than `TOP`, it is free
  -- read from the same bytes the binding table already parses -- and it is
  **sound**, because the JVM guarantees it. Same for `B`, `S`, `C`, `Z` and `J`.
  Only `F` and `D` give `TOP`. A Java `int` arriving in TypeScript keeps its
  integrality and the loop above stays integer arithmetic.
- **The repetition is the JIT's job, and only on this lane.** Two `getfield`s on
  the same object with no call between them are hoisted by C2 and by ART's
  optimiser. We do not need compile-time redundancy elimination through a
  foreign object, because the platform that owns the object already does it.

So the ceiling is real but far lower than I stated: we lose *scalarisation* of a
Java object, which we should never have had, and we keep the numeric facts,
which was the part actually costing anything.

*Test:* a fixture whose accumulator is provably `whole` only if the descriptor
is read; assert `nts hir --prepared` shows integer arithmetic rather than `f64`.


#### What this does *not* mean, because the name invites the wrong reading

"No optimisation through a foreign object" sounds like *calling a Java object
costs more from our compiler than from Java*. It does not, and the distinction
is worth stating precisely because every other reading makes the cost sound like
a tax at the call.

**At the instruction level there is no difference at all.** The `getfield` we
emit for `rect.left` is byte-identical to the one `javac` emits for the same
access -- same opcode, same constant-pool reference, same inline cache, same JIT
treatment. There is no marshalling, no wrapper, no conversion. As the framing
section above says: both sides are JVM bytecode, so there is no boundary to make
cheap.

**And `javac` does not optimise through objects either.** It emits close to
naive bytecode and leaves everything to C2 and ART. So the compile-time
reasoning we lack for a Java object is reasoning *`javac` never had for it
either*. Against Java, this row is zero.

The loss is against **our own objects**, and only there. For a TypeScript object
we own the layout, so `facts.rs` can narrow a field's range, `hir::escape` can
prove it does not escape, and `place_allocations` can keep it off the heap
entirely. None of that is available for a class we did not lay out. So the true
statement is:

> A Java object is less optimisable than one of *our* objects. It is not less
> optimisable than the same object in Java.

What we give up is an *advantage we hold over Java*, in the one place we cannot
hold it -- not a penalty Java avoids.

**And with the descriptor fix above, most of even that comes back.** A member
returning `I` yields `whole = true`, no NaN, no `-0`, bounded to 32 bits --
which is most of what `facts.rs` wants -- so arithmetic on a Java `int` stays
integral. The residue is scalar replacement alone, which needs the layout and
genuinely cannot be had.

**One prediction worth measuring rather than asserting**, since it runs the
other way: on code that mixes Java `int`s into our arithmetic we may end up
*ahead* of `javac`, because we fold and narrow using the descriptor before
emitting, while `javac` emits the naive form and leaves it to the JIT. That is a
claim about generated code and it should be a number before it is a sentence.
**Status: mostly fixed. The residue -- no scalar replacement of a Java object --
is correct and permanent.**

### 3. A bound call is opaque, so everything passed to it escapes

```ts
const buf = new Uint8Array(4096);
out.write(buf);          // java.io.OutputStream.write(byte[])
```

`hir::escape` cannot see through a Java method, so `buf` must be assumed
retained: frame placement is lost and the array is heap-allocated. But
`OutputStream.write` copies its argument out and keeps nothing.

**The mechanism already exists, and it is already per-parameter.**
`hir/escape.rs:728` reads `Callee::External(name) => runtime::keeps(name)`, and
`keeps` returns `Option<&'static [usize]>`: `None` means "assume everything",
`Some(&[])` means "keeps nothing", `Some(&[0])` names which parameters are
retained. The comment above the `nts_presence_` arm records what saying so was
worth -- two memory cases went **from 17 allocations to 0**, because without it
"every object with an optional property somebody asks about moved to the heap".

A foreign binding supplies the same answer. The binding table carries a `keeps`
column, defaulting to `None` (everything escapes, which is always sound),
populated three ways, cheapest first:

1. **From the class file, by analysis.** We have the callee's bytecode -- it is
   in the jar. A parameter never stored to a field, never passed on, and never
   returned does not escape. That is a small intraprocedural pass over bytecode
   the reader already parses.
2. **From a checked-in overrides file**, beside the nullability one, for the hot
   APIs where the analysis is too weak -- a `native` method has no bytecode at
   all, and on Android a great many of them are `native`.
3. **Never from a guess.** An absent entry is `None`.

The pleasing part is that this is not new machinery. It is a second caller of a
table whose value was already measured once.

*Test:* `out.write(buf)` with the entry and without; assert the allocation count
moves -- `tooling/memory` on the native lanes, `getThreadAllocatedBytes` here.

**Status: fixed by an existing mechanism. The bytecode analysis in (1) is the
optional half, not the load-bearing one.**

### 4. `same_shape` merges field-less layouts -- measured, and the reason it is fatal is not the one I gave

```ts
import { Runnable } from "java:java.lang";
import { Observer } from "java:java.util";
```

I wrote that these "may merge" and that it should be tested rather than assumed.
**Tested.** Two field-less TypeScript classes:

```ts
class Alpha {}
class Beta {}
```

`nts layouts` prints one line -- `Alpha [1 2]`. Two `TypeId`s, one layout, named
for whichever was seen first. `Beta` is gone. Adding an identical method to each
does not separate them either: `greet(): number` on both still gives
`Alpha [1 6]`, because `same_shape` compares the method list and the lists
agree.

**And then the emitter handles it correctly, by a mechanism I did not know was
there.** `nts emit-jvm` on that program writes four classes, and the shape is
the answer:

```
nts/gen/Alpha.class          public class nts.gen.Alpha
nts/gen/Alpha__Alpha.class   public final class nts.gen.Alpha__Alpha extends nts.gen.Alpha
nts/gen/Alpha__Beta.class    public final class nts.gen.Alpha__Beta  extends nts.gen.Alpha
```

The merged layout becomes a **shared base class**, and each original type gets a
subclass of it. `a` is an `Alpha__Alpha`, `b` is an `Alpha__Beta`, both are
assignable where the layout is declared, and each carries its own method bodies.
That is what `81c5200e` moved the floor for. `b instanceof Alpha` folds to
`const false`, agreeing with node.

So **merging is not currently a hazard for TypeScript layouts**, and my drawback
was wrong about the present tense. It is still fatal for foreign layouts, and
the measurement says why much better than the guess did:

> The mechanism that rescues a merge is synthesising a subclass per original
> type. **It works precisely because we own the names and can invent
> `Alpha__Beta`.** A `java.lang.Runnable` cannot be made to extend an
> `nts/gen/...` base: it already exists, its binary name *is* its identity, and
> its supertype chain is fixed by the jar. There is no `__` form available.

A foreign layout is therefore the one case where a merge cannot be repaired
downstream, because every repair this backend has depends on owning the class.

**The fix is unchanged and is one line.** `lower.rs:4615` has `nominal_name` --
*"whether this layout's name is its identity"* -- currently
`is_error || is_signature_name || is_constructor_name`. Record 0096 is the story
of the cross-family merge that reached node's `path`. A foreign layout is the
fourth member of that family, so `nominal_name` gains `is_foreign_name(name)`,
and the doc comment there already states the rule over both sides:

> a layout whose name is its identity does not merge with a differently-named
> layout, whatever family the other one is in.

`is_foreign_name` goes by prefix and shape, matching `is_signature_name`'s
precedent: a foreign layout is named `java/lang/Runnable`, and `/` cannot appear
in a TypeScript identifier.

*Test:* two single-method Java interfaces, asserting two layouts survive -- and,
because the merge is benign until it isn't, assert the emitted class names are
the two binary names rather than one of them plus a `__` form.

**Status: fixed, one line. The premise is now measured rather than assumed, and
the measurement moved the argument from "they might collide" to "this is the
only merge the backend cannot repair".**

### 5. Non-primitive statics cannot inline

`Rect.CREATOR` is a `public static final Parcelable$Creator`. A primitive or
`String` static carries a `ConstantValue` attribute and becomes an `ldc`; a
reference static does not, and becomes a `getstatic`.

**There is nothing to fix, and I overstated it.** `getstatic` is one
instruction, three bytes, and it is exactly what `javac` emits for the same
source. It triggers the owner's `<clinit>` on first use, which is correct Java
semantics. Listing this as a drawback was padding.

The one real consequence is a thing *not* to do: do not cache such a static in a
TypeScript global, because that moves class initialisation to program start and
can run Android framework `<clinit>` before the Looper exists.

**Status: withdrawn. Not a cost.**

### 6. A cross-thread callback cannot return a value

```ts
view.setOnTouchListener((v, e) => { handle(e); return true; });
```

`OnTouchListener.onTouch` returns `boolean`, Android calls it synchronously on
the UI thread, and it uses the answer to decide whether the event was consumed.
If our callback must post to `NtsInbox` and run later, there is no answer to
return, and returning a placeholder is a **wrong answer that runs** -- the
category this project treats as worse than a refusal.

I called this unfixable by an adapter. That is still true, and the framing was
still wrong. Reading `NtsEnv` is what corrected it:

```java
private static final ThreadLocal<NtsEnv> CURRENT = new ThreadLocal<NtsEnv>();
```

**The environment is a `ThreadLocal`, not a singleton pinned to a thread the
runtime chose.** So "the environment thread" is not a fixed fact to work around;
it is wherever an environment has been installed. That turns an impossibility
into a placement decision:

- **Install the environment on the thread Android will call back on.** For UI
  work that is the main/Looper thread -- and then `onTouch` is a **direct call**.
  The listener runs on the calling thread, computes, returns `true`, no inbox
  involved. The problem disappears for the entire UI callback surface, which is
  where every value-returning listener lives.
- **`NtsInbox` is for genuinely foreign threads.** It already knows which thread
  owns it -- `ownedBy(inbox, lane)` and `claim(inbox, lane)` take a `Thread` --
  and those callbacks are background completions (network, disk), which are void
  by convention because the framework has nowhere to use a return value either.
- **A non-void callback registered where no environment lives is refused at bind
  time**, by name, with the two-line explanation. Not at runtime, and never with
  a placeholder.

The rule: *a callback returning non-void must be invoked on a thread that has an
environment*, and the binding generator can see which is which in the descriptor.
That is checkable rather than hopeful.

*Test:* a `boolean`-returning listener driven from the environment's own thread,
asserting the value arrives; and the same from a foreign thread, asserting the
refusal.

**Status: fixed for the surface that matters, by placing the environment rather
than by building an adapter. Residue: a value-returning callback genuinely
required on a thread we do not control, which is rare and where refusing is
correct.**

### 7. Nullability is only as good as the annotations

```ts
const parent = view.getParent();   // ViewParent, or null for an unattached view
parent.requestLayout();            // NPE that the type system said could not happen
```

I priced this as a general weakness. For the jar that matters it is far better
than that. `javap -v` on `android.view.View` alone shows **67 `NonNull` and 77
`Nullable`** annotations. The Android SDK is extensively annotated and has been
since the support-annotations library.

The fix, in order:

1. **Read the annotations** -- `RuntimeVisibleAnnotations`,
   `RuntimeInvisibleAnnotations`, and the type-annotation variants, across
   `androidx.annotation`, `javax.annotation`, `org.jetbrains.annotations` and
   JSpecify. **The invisible table is not optional**: `androidx.annotation.Nullable`
   is `CLASS`-retention, so a reader that only looks at the visible table sees
   none of the 77.
2. **Honour `@NullMarked`** (JSpecify) at package or module level. It flips the
   default inside to non-null, which is what modern libraries use, and makes an
   unannotated return in a marked package *known* non-null rather than unknown.
3. **Default an unannotated reference return to `T | null`.** Refuse rather than
   miscompile -- and the reason Kotlin had to invent platform types instead of
   guessing.
4. **A checked-in overrides file** for unannotated jars, same format and same
   place as the `keeps` overrides.

*Test:* assert the generated `.d.ts` gives `View.getParent` a `| null` and
`View.getContext` none, both derived from the annotations rather than a list.

**Status: fixed for annotated jars, which includes the Android SDK. Residue: an
unannotated jar is verbose to call, which is the honest state of the world, and
the overrides file is the escape.**

### 8. A jar upgrade is a two-step

Bump `compileSdk` from 35 to 36 and the checked-in `android.d.ts` is stale.
Nothing fails to compile -- a removed method is still declared -- and the call
fails at runtime with `NoSuchMethodError`.

The drift test already makes staleness loud, the same pattern as `signatures.rs`
and the runtime jar. Two additions make the review cheap rather than merely
possible:

- **The drift test prints a member-level diff**, not "the file differs": added,
  removed, and changed-descriptor, per class. A jar bump then produces a
  reviewable list instead of a 40,000-line diff nobody reads.
- **The binding table records the jar's identity** -- SDK version plus a hash of
  the class files consumed -- so the mismatch reports as *"generated against
  android-35, building against android-36"*, naming the cause rather than the
  symptom.

`NTS_REGENERATE=1` writes, exactly as every other generated table here does.

**Status: not eliminated, and should not be. The two steps are the price of the
`.d.ts` being a checked-in, greppable, reviewable file -- the alternative makes
every clean build depend on a JDK and an SDK. Made cheap and loud instead.**

### 9. Exceptions kill the process

```ts
const n = Integer.parseInt(userInput);   // NumberFormatException on bad input
```

Today a Java exception crossing into our frames is caught by nothing and the
process dies with a stack trace -- which the differential harness classifies as
a **Defect**, because `stopped_with` reads any line starting `at ` containing
`(` that way. So one bad input does not just crash a program, it corrupts the
instrument.

I listed this as "wait until a throw can cross a call on every backend". That is
the full fix and it is a shared-layer change I do not own. But there is a real
fix available now, and it uses something that landed last night.

1. **Now: catch at the call site and convert to a refusal.**
   `compiler/jvm-emitter` gained exception tables in `5b865f62` --
   `Code::try_catch(start, end, target, catch_type)` and `Code::bind_handler`,
   with `same_locals_1_stack_item` frames. So a bound call that can throw is
   wrapped: `try_catch` over the invoke, a handler that reads `getMessage()` and
   raises `NtsRefusal`. **The harness already carves `NtsRefusal` out of its
   Defect rule**, so the case is *declined* rather than *failed*, the message
   names the Java exception and the method, and the differential stays
   meaningful. One exception-table entry per throwing call.
2. **Later: the same entry becomes a real TypeScript `catch`.** When a throw can
   cross a call, the handler stops refusing and jumps to the TypeScript handler
   block with the `Throwable` erased into the thrown value. Same table entry,
   different target -- so stage 1 is not throwaway work.

*Test:* a fixture calling `Integer.parseInt("abc")`; assert the process exits
with an `nts:` refusal naming `NumberFormatException`, and assert the
differential classifies it declined rather than Defect.

**Status: the crash and the harness corruption are fixed now. The
TypeScript-level catch waits on a shared change already on the list.**

### What the nine came to

| # | | resolution | rests on |
| --- | --- | --- | --- |
| 1 | Public fields | fixed | a foreign access is not a `FieldGet` |
| 2 | No optimisation through a foreign object | mostly fixed | descriptors are a `Facts` source; the JIT owns the rest |
| 3 | Everything escapes | fixed | `runtime::keeps`, already per-parameter |
| 4 | Layouts merging | fixed, one line; premise **measured** | `nominal_name` -- and a merge is the one thing the emitter cannot repair for a class it does not own |
| 5 | Non-primitive statics | **withdrawn** | it was one instruction |
| 6 | Cross-thread callback return | fixed for the real surface | `NtsEnv.CURRENT` is a `ThreadLocal` |
| 7 | Nullability | fixed for annotated jars | 144 annotations on `View` alone |
| 8 | Jar upgrade | made cheap, not removed | member-level drift diff |
| 9 | Exceptions | crash fixed now | exception tables, `5b865f62` |

Five are fixed by a mechanism the compiler already had, and one by deleting the
drawback. **That is not luck.** It is what happens when the foreign surface is
made to look like something the compiler already models -- an external call with
a name -- rather than like something new. Every one of the existing mechanisms
reached for here (`keeps`, `nominal_name`, `Facts`, `is_signature_name`) was
built for the runtime helpers or for empty TypeScript layouts, and a Java member
is the same question asked about a different jar.

**What is left, and is permanent:** a Java object is not scalarised; a `native`
method's escape behaviour cannot be analysed, only declared; an unannotated jar
is verbose to call; and a value-returning callback on a thread we do not own is
refused.

**What this changes about the build order.** Three of the fixes are one-line
changes in files I do not own -- `nominal_name` in `lower.rs`, the `keeps` arm
in `escape.rs`, descriptor-seeded `Facts` in `facts.rs`. They go to MainClaude
as tested patches, the way `Layout.base` did, and each is small enough to land
ahead of the class-file reader rather than behind it.

# Correcting 5 and 8: both were caution, not difficulty

## Inner classes can be bound, and the fix is mechanical

I proposed refusing them. That was laziness dressed as caution.

A true inner class captures its enclosing instance: the class file's constructor
descriptor carries a synthetic leading parameter, and the **`InnerClasses`
attribute** names the outer class. Both are readable — the reader we are
building for other reasons hands us exactly this. So the binding can surface

    outer.newInner(args…)          // or  new Outer.Inner(outer, args…)

and pass the outer instance as the first constructor argument, which is what
`javac` emits for `outer.new Inner()`.

**So the honest reason to defer is priority, not difficulty**, and the plan
should say that rather than implying it is hard. Anonymous and local classes
stay out, because they are not public API surface.

## Ambiguous overloads mostly are not ambiguous

I proposed refusing when `f(int)`, `f(long)` and `f(double)` collapse to
`f(number)`. But **a TypeScript `number` is an f64**, so `f(double)` is the
overload that receives it *without loss* — picking it is not a guess, it is the
only non-lossy choice. `f(int)` would truncate.

That gives a principled total order: **prefer the overload whose parameter
losslessly receives the TypeScript type.** `number` → `double`, then `float`,
then `long`, then `int`. `bigint` → `long`. `string` → `String`.

And where two overloads are *equally* lossless — `f(String)` against
`f(Object)` — **Java's own rule already decides it**: most specific applicable
method wins, JLS 15.12.2, which is the algorithm `javac` runs and which we can
run over the same class-file data.

**So refuse only where `javac` itself would call it ambiguous**, which is rare
and genuinely undecidable. That is a much smaller refusal than the one proposed,
and it is the rule a Java programmer already expects.
