# TypeScript and Java, in both directions

A plan for `nts bind` and its opposite, written to be argued with. Every claim
marked **measured** was checked against this tree on 2026-09-13; everything else
is a proposal and says so. The point of separating them is that this lane has
spent a week learning that a plausible representation claim costs a day to
refute and five minutes to check.

## What is already true

**Both of these paragraphs were written before the work and both went stale;
they are corrected here rather than deleted, because what changed is the
substance of the document.**

**TS → Java works, and a Java caller now writes idiomatic Java.**
`examples/interop/ts-from-java` compiles a `Main.java` against classes this
compiler wrote and runs it under `-Xverify:all`. The surface is `s.bump()`
rather than `Program.Session$bump(s)` -- the mangled statics are `ACC_SYNTHETIC`
and `javac` refuses to reference them -- and a TypeScript `Map` crosses as a
`java.util.Map` with no copy.

~~what is missing is *packaging*, which is the last section here~~ -- **there
was no such section**, a forward reference to nothing that survived the whole
document. What "packaging" means concretely: `emit-jvm` writes loose class files
under `nts/gen/` beside `nts-runtime.jar`, and a Java project wanting a
dependency needs those in one jar. That is `jar --create` over the output
directory, which every `build.sh` here does in one line, so it is a convenience
rather than a gap -- and saying which it is, is the thing the dangling reference
prevented.

**Java → TS is built as far as this lane can take it.** `compiler/jvm-emitter`
reads as well as writes: [`read`] parses class files, [`bind`] renders
declarations, [`escapes`] answers which parameters a method retains. There is
still no `bind` **subcommand** -- it is `examples/bind.rs`, driven by the
projects' `build.sh` -- because the CLI lives in `tooling/cli`, which this lane
does not own. The CLI is `check`, `emit-c`, `emit-jvm`, `hir`, `layouts`,
`version`.

**A note on how code is cited here, which this document got wrong.** References
into `compiler/core/src/hir/**` name a **function or a phrase**, never a line
number. That file belongs to another lane and moves constantly: `lower.rs:6570`
was cited as the evidence for the brand refusal and now points at an unrelated
comment about `Structured { flags: 16384 }`, because the passage it meant moved
thirty lines when that lane edited the file. The quote was accurate; the
coordinate was not. A line number into a file you do not own is a citation with
an expiry date, and `grep` finds the phrase after any edit that does not delete
it.

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
incidental -- `lower.rs`, at the comment beginning *"`TypeKind::Intersection`
falls here"*:

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

**Reordered twice.** The original order led with the class-file reader; the cost
analysis moved it down because three measurements settle questions that change
the shape of everything after them. The audit then moved a *new* item to the
front, on a different criterion: everything else here is an advantage to gain,
and item 0 is an advantage we already have that interop would silently take
away.

0. **Package-private fields, accessors for the published surface, and a test
   asserting no generated field is `ACC_PUBLIC`.** The only item with a
   deadline. `fields.rs` is sound because "there is no FFI that writes through a
   pointer here"; generated fields are `public int` today, so the first object
   that reaches Java falsifies that sentence for its whole `(layout, field)`
   pair, program-wide. Small, self-contained, no dependencies, and it must land
   before any object crosses in either direction. See "Keeping the advantage".
1. **The brand measurement**, and it is first among the measurements because
   everything numeric waits
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

## 9. Overload collapse — *eliminated, but not by the mechanism this row named*

**This row was wrong and stayed wrong for most of a day.** It said the collapse
is eliminated by making `int` distinguishable with a brand -- "`int` needs the
brand, which is the next row". Brands were then measured and **refused at every
position a binding emits one**: a declared return, a class property, and a class
*method's* parameter. A binding is a class. The mechanism this row promised does
not exist.

What eliminates it instead is **distinguishable names**, not distinguishable
types. `f(int)`, `f(long)` and `f(double)` all take a `number`, so the *least
lossy* keeps the plain name -- a `number` **is** an f64, so `double` receives it
without loss -- and the others are renamed by the generator:

```ts
find(a0: number): number;        // -> find(double), the lossless one
find$int(a0: number): number;    // -> find(int), which truncates
find(a0: bigint): number;        // -> find(long), already distinct
find(a0: string): number;
```

`long` was always distinct, because it is `bigint` and TypeScript will not mix
that with `number` -- that half of the original row survives.

Where two candidates are *equally* lossless, Java's own rule decides: most
specific applicable method, JLS 15.12.2, the algorithm `javac` runs over the
same class-file data. **The binding refuses only where `javac` would.**

The outcome is the same -- the overload set is reachable and nothing is guessed
-- and the route is different, which is why this row is corrected rather than
deleted. A cost list is only worth keeping if a row that claimed the wrong
mechanism says so.

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

### Resolved, and route 2 is what it resolved to

**This section is kept for its reasoning, but it is no longer blocking and route
2 is the answer, not route 1.** What changed is that route 2's objection turned
out to be avoidable: a foreign member access is *not* a `FieldGet` or
`FieldSet`. It resolves through the binding table exactly as a method call does
and the backend emits `getfield`/`putfield` directly, so `fields::analyze` --
which walks `OpKind::FieldGet` -- never sees one, and its soundness sentence
stays true **by construction rather than by promise**. That is a smaller change
than a new `ManagedType` variant and it needs nothing from the middle end.

See "Foreign objects: a layout, a naming rule, and one constraint" for the
proposal and "What a zero-field layout is" for the drawbacks it brings.

### But the sentence is falsified from the *other* direction, and that is live

The objection above was that a foreign object we read could falsify
`fields::analyze`. The direction that actually falsifies it is **our own objects
once Java can reach them** -- and unlike this one it is not hypothetical:
generated fields are emitted `public` today, so a Java caller can `putfield`
into one with no `FieldSet` in the HIR at all. See "Keeping the advantage", which
is the only item in this document with a deadline.

`Layout.base` **does** exist (`hir/mod.rs`, `pub base: Option<TypeId>`), so inheritance is representable
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

**The constraint that makes it sound, restated after `android.graphics.Rect`
broke the first version of it.** The original constraint was "the binding
surfaces every member as a method, never as a field", which is not survivable:
`Rect` has `public int left, top, right, bottom` and they are read directly all
over Android. The constraint that works is about representation instead --
**a foreign member access is not one of our field ops.** It resolves through the
binding table like a method call and emits `getfield`/`putfield` directly, so a
foreign object never appears in an `OpKind::FieldGet`, `fields::analyze` never
sees one, and its soundness sentence stays true while `rect.left` still works.

**The `same_shape` risk is now measured rather than assumed, and the result
changed the argument.** Two field-less classes *do* merge -- `class Alpha {}`
and `class Beta {}` produce one layout, `Alpha [1 2]` -- and identical method
lists do not separate them either. But the JVM emitter already repairs that: the
merged layout becomes a shared base and each original type gets a subclass
(`nts/gen/Alpha`, with `Alpha__Alpha` and `Alpha__Beta` extending it).

So merging is **not** a live hazard for TypeScript layouts. It stays fatal for
foreign ones, for a sharper reason than the collision itself: the repair works
precisely because we own the names and can invent `Alpha__Beta`. A
`java.lang.Runnable` cannot be made to extend an `nts/gen/...` base -- it exists,
its binary name **is** its identity, and its supertype chain is fixed by the jar.
**A foreign layout is the one merge this backend cannot repair downstream.**

The fix is one line into `lower.rs`'s `nominal_name`, which already lists three
families of deliberately-empty nominal layout and whose doc comment already
states the rule over both sides. A foreign layout is the fourth member.

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

## 5. Nested classes: surface the static ones, and inner ones are deferred not refused

`Map.Entry` is a static nested class -- a class whose binary name contains `$`
-- and surfaces as `Map.Entry` in the namespace with no special handling.

**A true inner class can be bound too, and the earlier "refuse it" here was
caution rather than difficulty.** Its constructor descriptor carries a synthetic
leading parameter for the outer instance and the `InnerClasses` attribute names
the outer class -- both read by the same class-file reader, neither needing a
design. `outer.newInner(...)` passes the outer instance first, which is exactly
what `javac` emits for `outer.new Inner()`.

So they are **deferred on priority**, not refused on difficulty: they are rare
in public API surface and nothing on the Android path needs one yet. Anonymous
and local classes stay out, because they are not API surface at all.

## 6. Varargs: surface, pack at the call site

`f(String...)` **is** `f(String[])` in the class file. Surface it as
`f(...args: string[])` and pack at the call site — which is an array
construction, and free when the array is bare.

## 7. Collisions: mangle by a written rule, recorded in the table

A Java member named `constructor`, or a TypeScript keyword. One documented
mangling, recorded in the binding table so the emitted call uses the real name.
The rule matters more than which rule.

## 8. Ambiguous overloads: resolve by losslessness, refuse only where `javac` would

**Most collapsed overloads are not ambiguous, and the earlier blanket refusal
here was wrong.** A TypeScript `number` **is** an f64, so given `f(int)`,
`f(long)` and `f(double)`, the `double` form is the one that receives it
*without loss* -- picking it is not a guess but the only non-lossy choice, and
`f(int)` would truncate. That gives a written order: `number` to `double`,
`float`, `long`, `int`; `bigint` to `long`; `string` to `String`.

Where two candidates are **equally** lossless -- `f(String)` against
`f(Object)` -- Java's own rule decides: most specific applicable method,
JLS 15.12.2, which is the algorithm `javac` runs over the same class-file data
we have already parsed.

**Refuse only where `javac` itself would call it ambiguous**, naming both
candidates. That is rare and genuinely undecidable, and it is the rule a Java
programmer already expects. A wrong overload is still a wrong answer that runs;
the point is that losslessness decides almost all of them.

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

## 11. Exceptions: bind anyway, and catch at the call site now

A `throws` clause does not prevent binding.

**And the "the process dies with a stack trace" that stood here is no longer the
best available answer.** `compiler/jvm-emitter` gained exception tables in
`5b865f62` -- `Code::try_catch` and `Code::bind_handler`, with
`same_locals_1_stack_item` frames -- so a throwing call is wrapped, the handler
reads `getMessage()` and raises `NtsRefusal`, and the harness already carves
`NtsRefusal` out of its Defect rule. The case **declines** rather than failing,
naming the Java exception and the method.

That matters beyond tidiness: an escaping Java stack trace is classified as a
**Defect** by `stopped_with`, so without this one bad input does not merely
crash a program, it corrupts the instrument.

When a throw can cross a call, the same exception-table entry gets a different
target and becomes a real TypeScript `catch`. Stage one is not throwaway work.

## 12. Threads: the mechanism exists

`NtsInbox.post(Slot, NtsResumable)` is in `runtime/jvm` today, with atomics, and
the provider doc says only the cross-thread inbox is atomic **because one lane
mutates everything else**. So an Android API calling back on another thread has
somewhere to land: it posts, and the work runs on the environment's own lane.

~~What is unbuilt is the adapter that turns a Java callback into an
`NtsResumable`.~~ **Built: `runtime/jvm/src/nts/rt/NtsForeign.java`.** The inbox
has had `reserve`/`post`/`drain` since the promise work and a bound interface
can be implemented by a generated closure; nothing joined the two, so a
framework thread calling `onBytes` had a closure and no safe way to invoke it.

**Every method returns `void`, and that is the design rather than an omission.**
Posting means running *later*, so there is nobody left to return to. And every
method returns a `boolean` *acceptance*, because `NtsInbox::reserve` answers
`null` at the ceiling and its own comment is emphatic that this is the only
place backpressure can be applied "before the OS work exists" -- so a refusal is
the caller's cue to reject or delay, never to drop silently or block the foreign
thread.

The `byte[]` form **captures rather than copies**, which is the point and is
also a constraint on the caller: the foreign side must not reuse the buffer,
because the lane reads it later. A copy here would be a copy on every
completion, which is the cost this document exists to avoid -- so the rule is
stated instead of paid.

The test is the one a wrong implementation fails in the way that matters: it
records which thread the body ran on and which posted, and asserts they differ.
Calling the closure directly would pass every "did the callback happen" check
and mutate the lane's heap from outside it. Sabotaged to call instead of post,
and it fails on `the callback does not run on the posting thread`.

**And the inbox is not the only route, which matters for the callbacks that must
return a value.** `NtsEnv.CURRENT` is a `ThreadLocal`, not a singleton pinned to
a thread the runtime chose, so an environment can be *installed* on the thread a
callback arrives on -- and then the callback is a direct call that can return
`true` to `onTouch`, with no inbox and no deferral. The inbox is for genuinely
foreign threads, whose callbacks are void because the framework has nowhere to
put a return value either. A non-void callback registered where no environment
lives is refused at bind time rather than served a placeholder. See drawback 6.

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
`hir/escape.rs`'s `gone_into_the_unknown` reads `Callee::External(name) => runtime::keeps(name)`, and
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

**The fix is unchanged and is one line.** `lower.rs`'s `nominal_name` --
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
than that. `javap -v` on `android.view.View` alone resolves **66 `NonNull` and 76
`Nullable`** annotation *sites* -- and the reader built since agrees with it
exactly, which is how the numbers here became measured rather than grepped. The Android SDK is extensively annotated and has been
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
| 7 | Nullability | fixed for annotated jars | 142 annotation sites on `View` alone, **most of them on parameters** |
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

**Both corrections are now folded into proposals 5 and 8 above, which is where a
reader looks for them.** This section is kept for the reasoning, which is worth
more than the verdict -- but if the two disagree, the proposals are current and
this is history.

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

# Keeping the advantage: what interop must not cost us

Drawback 2 ends by saying we give up an advantage we hold over Java, in the one
place we cannot hold it. That framing is right and it is incomplete, because it
looks only outward -- at Java objects we cannot optimise. **The larger risk
points the other way: at our own objects, once Java can reach them.** This
section is ordered by that, because only the first item can *lose* something we
already have; the rest are advantages we merely fail to gain.

## 1. Interop must not falsify `fields.rs`, and today it would

`hir/fields.rs` is what stops every `this.count` coming back as `TOP`. Its own
header says why that is worth having -- without it "`this.count + 1` is floating
point, `x | 0` after it is a library call, and a loop that touches an object
pays a double round trip per iteration for arithmetic that fits in a register",
which is "every program that uses objects".

Its soundness rests on one sentence:

> A field holds what was stored into it, and nothing else can store into it:
> **there is no FFI that writes through a pointer here**, and a program's own
> stores are all in the HIR.

**That sentence is true today and interop is exactly what falsifies it.** It is
not wrong, and nobody will edit it when it goes false -- the change happens
somewhere else entirely, which is the failure mode where a precondition expires
in silence.

And the door is already open. Emitting a two-field class and reading it back:

```
public final class nts.gen.Counter {
  public int count;
  public nts.gen.Counter();
}
```

**`public int count`.** A Java caller holding an `nts/gen/Counter` can write that
field with one `putfield`, with no method of ours involved and no `FieldSet` in
the HIR. The join over reaching stores is then incomplete, and the narrowing it
produced is unsound -- **for every instance of that layout, program-wide**,
because `fields.rs` keys on `(layout, field)` and not on the instance that
escaped.

**The fix is to make the field unreachable and route every foreign write through
our own code**, which costs nothing and is better than a restriction:

- **Emit fields package-private rather than `public`.** Every generated class
  lives in `nts/gen`, including the `Alpha__Beta extends Alpha` forms, so
  package-private access is enough for all of our own code and closed to
  everything outside it. A foreign class in `com/example` cannot touch it.
- **Expose accessors for anything deliberately published to Java.** This is the
  part that makes it a fix rather than a wall: a Java caller mutating our object
  through a method of ours performs a `FieldSet` **in the HIR**, which is
  precisely what `fields.rs` requires. The join stays complete and the narrowing
  stays sound, while the field is still writable from Java.
- **A per-`(layout, field)` opt-out** for anything that must be a raw public
  field anyway: that pair joins `TOP` and nothing else changes. Precise, and it
  costs only the classes that actually need it.
- **And the sentence itself becomes a checked claim**, not a comment -- a test
  asserting no generated field is `ACC_PUBLIC`. The comment is what goes stale;
  the assertion is what fails on the day someone changes it.

## 2. `ACC_FINAL` recovers real optimisation *through* a foreign object

Drawback 2 called the residue permanent. Part of it is not.

A Java `final` instance field cannot change after construction -- the memory
model guarantees it -- and the class file carries `ACC_FINAL` on the field,
which the reader parses anyway. So **a read of a `final` foreign field is pure**:
it can be hoisted out of a loop, common-subexpression-eliminated, and kept live
across an intervening foreign call, none of which is true for a mutable one.

That is optimisation through an object we do not own, obtained from a flag we
already have to read. It does not help `android.graphics.Rect`, whose
`left/top/right/bottom` are deliberately mutable -- but it covers the value-like
types, which are the ones that appear in inner loops.

## 3. Unpack at the boundary, and bound the region

The general form of what a Java programmer does by hand when they hoist fields
into locals before a loop. Read the foreign object's members once into our own
values, and every pass we own applies to those values -- because they are ours.

The soundness condition is the only interesting part: **the unpacked copy is
valid until something could write the original**, and conservatively that is the
next foreign call reachable from the same object. Within a region containing no
such call the unpack is exact; across one it must be re-read. That is the same
question a C compiler answers about a possibly-aliasing pointer, and unlike the
C case we get to see every foreign call in the HIR.

## 4. Prefer the primitive overload, so the object never exists

The cheapest optimisation is the one where there is nothing to optimise. Android
routinely publishes both forms, and this is measured on the real jar rather than
assumed:

```
  public void setBounds(android.graphics.Rect);
  public void setBounds(int, int, int, int);
  public void set(int, int, int, int);          // android.graphics.Rect
  public boolean contains(int, int);
```

Where the binding table has both, **prefer the primitive form**: no object is
constructed, nothing escapes, no copy is made, and no field analysis is needed
because there are no fields. This is a binding-table decision, it is free, and
it removes the problem instead of managing it.

## 5. And `keeps`, from drawback 3

So that our objects passed to a foreign call do not escape when the callee does
not retain them. Listed last because it is already covered, not because it is
least.

**The ordering is the point.** Items 2 to 5 are advantages to gain, and if we
never build them the compiler stays as good as it is today. Item 1 is an
advantage we already have, that interop would take away silently, program-wide,
on the day it lands -- and it is the only one with a deadline.

# Three projects, and everything they have to exercise

Requested so the end result can be *looked at* -- the generated `.d.ts`, the
call sites, the ergonomics -- rather than inferred from a design document. They
are therefore written to be **read before they are built**, and every decision
in this document should be visible in at least one of them.

**Where they live is not mine to decide.** `examples/**` belongs to another lane,
and more sharply: the jvm gate line is `backend_examples 203 ... exact`, which
fails on `passed != total`. Three new example directories change that number, so
they cannot be added unilaterally -- the floor moves in the same commit or the
gate goes red for everyone. Agreed with the owner first, or they live under a
separate `interop/` tree that no floor counts until they are ready.

## The coverage matrix, so nothing is exercised by accident

| | 1. java-from-ts | 2. ts-from-java | 3. android-shape |
| --- | --- | --- | --- |
| `HashMap` in and out | ● | ● | |
| `NtsMap implements java.util.Map` | | ● | |
| `List<String>` / `string[]` | ● | ● | |
| `int[]` / `byte[]` / subarray | ● | | ● |
| Generics, wildcards, raw types | ● | ● | |
| Overloads, primitive-preferred | ● | | ● |
| Nullability, annotated and not | ● | | ● |
| Exceptions | ● | ● | |
| Public fields (`Rect`-shaped) | ● | | ● |
| Accessors, not public fields | | ● | ● |
| Static constants and enums | ● | | |
| Nested and inner classes | ● | | |
| Varargs | ● | | |
| `long` / `bigint` | ● | ● | |
| Branded `int` | ● | | ● |
| TS implements a Java interface | | | ● |
| TS extends a Java class | | | ● |
| Callback returning a value, same thread | | | ● |
| Callback void, foreign thread, via inbox | | | ● |
| Closure as a functional interface | | ● | ● |

## 1. `java-from-ts` — TypeScript consumes Java

```
interop/java-from-ts/
  java/com/example/Catalog.java     the library being bound
  java/com/example/Kind.java        an enum
  build.sh                          javac -> catalog.jar
  types/com.example.d.ts            GENERATED by `nts bind`, checked in
  bind.overrides.json               nullability + keeps, for what annotations miss
  src/main.ts                       the consumer
  tsconfig.json
```

The Java side is written to be awkward on purpose -- every row of the matrix
that this project owns appears in it:

```java
package com.example;

public final class Catalog {
    public static final int MAX = 512;              // ConstantValue -> inlined
    public int hits;                                // a public field, Rect-shaped

    public Catalog(String name) { ... }

    public java.util.HashMap<String, Integer> index() { ... }
    public java.util.List<String> names() { ... }
    public int[] counts() { ... }
    public long id() { ... }                        // exceeds 2^53 -> bigint

    public int find(int key) { ... }                // overload set
    public int find(long key) { ... }
    public int find(double key) { ... }
    public int find(String key) { ... }

    public int sum(int... values) { ... }           // varargs

    @Nullable public String describe(int id) { ... }
    public String name() { ... }                    // @NullMarked package

    public int parse(String s) throws NumberFormatException { ... }

    public <T> java.util.List<T> repeat(T item, int times) { ... }
    public double total(java.util.List<? extends Number> xs) { ... }

    public static final class Entry { ... }         // static nested
    public final class Cursor { ... }               // true inner
}
```

and the generated declarations are the artefact to review:

```ts
declare module "java:com.example" {
  export class Catalog {
    constructor(name: string);

    static readonly MAX: int;              // inlined at the call site, no getstatic
    hits: int;                             // a real getfield/putfield, not a FieldGet

    index(): java.util.HashMap<string, int>;   // stays a HashMap; no copy
    names(): java.util.List<string>;           // stays a List
    counts(): Int32Array;                      // no brand needed -- see cost 10a
    id(): bigint;                              // long does not fit in a number

    find(key: number): int;                    // resolves to find(double), lossless
    find(key: bigint): int;                    // resolves to find(long)
    find(key: string): int;

    sum(...values: int[]): int;

    describe(id: int): string | null;          // @Nullable, read from the CLASS-retention table
    name(): string;                            // @NullMarked package -> non-null

    parse(s: string): int;                     // throws: declines with NtsRefusal today

    repeat<T>(item: T, times: int): java.util.List<T>;
    total(xs: java.util.List<number>): number; // ? extends Number -> readonly in TS terms

    static readonly Entry: { new (...): Catalog.Entry };
    newCursor(): Catalog.Cursor;               // inner: outer instance passed first
  }
}
```

**What to look at, because these are the decisions rather than the syntax.**
`find(1.5)` picking `find(double)` and not truncating. `counts()` being an
`Int32Array` rather than a `number[]`, which is the whole of cost 10a. `id()`
being `bigint` and therefore *unusable* in arithmetic with a `number` without a
conversion -- correct, and worth feeling. `describe` being `| null` while `name`
is not, from two different annotation mechanisms. And `MAX` compiling to a
constant with **no reference to `Catalog` at all**, which is what lets a program
use a constant without loading the class.

## 2. `ts-from-java` — Java consumes TypeScript

The direction with no reader involved: we emit class files, `javac` compiles
against them, and the question is what the API *looks like* from Java.

```
interop/ts-from-java/
  src/api.ts                 the TypeScript being published
  java/Main.java             a plain Java consumer
  expected/Api.javap         `javap -p -s` of what we emit, checked in
  build.sh                   nts emit-jvm, then javac Main.java -cp out
```

```ts
export class Session {
  #hits: int = 0;                       // private: NOT an own enumerable key
  get hits(): int { return this.#hits; }
  bump(): int { this.#hits = this.#hits + 1; return this.#hits; }

  tags(): Map<string, string> { ... }   // NtsMap implements java.util.Map
  each(fn: (name: string) => void): void { ... }   // closure <- Java lambda
}
```

```java
public final class Main {
  public static void main(String[] args) {
    Session s = new Session();
    s.bump();
    int n = s.hits();                            // an accessor, not a public field
    java.util.Map<String,String> t = s.tags();   // no copy, no wrapper
    s.each(name -> System.out.println(name));    // a Java lambda as our closure
  }
}
```

**This project is the guard for item 0.** `expected/Api.javap` is checked in, so
the day a generated field goes back to `public` the diff says so out loud. That
`s.hits()` is a method and not a field is the entire difference between
`fields.rs` being sound and being a comment that went false.

And `tags()` returning something Java can use as a `java.util.Map` **without a
copy or a wrapper** is the single most load-bearing claim in this document; it
should be visible in twelve lines of Java rather than argued about.

## 3. `android-shape` — both directions, in the shape Android actually imposes

No Android SDK dependency -- plain Java interfaces with the same *shapes*, so it
runs on a desktop JVM in the gate and on a device unchanged.

```
interop/android-shape/
  java/com/example/ui/View.java        setOnTouch(listener) -> boolean, same thread
  java/com/example/ui/Loader.java      load(callback) -> void, FOREIGN thread
  java/com/example/ui/Widget.java      a class to extend; has public int fields
  src/main.ts
```

```ts
import { View, Loader, Widget, Rect } from "java:com.example.ui";

// TS extends a Java class, which needs Layout.base to name a foreign type.
class Panel extends Widget {
  override onMeasure(w: int, h: int): void {
    this.setBounds(0, 0, w, h);        // primitive overload preferred over setBounds(Rect)
  }
}

const panel = new Panel();

// Same thread: returns a value, so it is a direct call and the inbox is not involved.
panel.setOnTouch((x: int, y: int): boolean => {
  return x < panel.right;              // a public foreign field read
});

// Foreign thread: void, so it posts to NtsInbox and runs on our lane.
Loader.load((bytes: Uint8Array): void => {
  process(bytes.subarray(0, 64));      // subarray -> no copy in the common case
});
```

**The three things to look at here are the ones nothing else in the tree can
show.** That `setOnTouch` returns `boolean` *at all* -- which only works because
`NtsEnv.CURRENT` is a `ThreadLocal` and an environment is installed on the
calling thread. That `Loader.load`'s callback is `void`, and that trying to make
it return something is **refused at bind time** rather than served a placeholder.
And `panel.right` reading a foreign public field through the binding table, not
through a `FieldGet`.

If a fourth is wanted later, the honest one is a **negative** project: the
constructs that are refused, each with the message it produces. A document that
only shows what works is an advertisement.

# Build item 1, measured: the brand survives exactly where it needs no representation

Run before anything downstream of it, because it was placed first and it
refutes part of what was written above.

Six arms, each differing from its control in one thing, against
`target-jvm/release/nts` at `161d2fa4`:

| where the brand appears | result |
| --- | --- |
| a **declared** (foreign) signature parameter | ✓ lowers, nothing refused |
| the same, passed a plain `number` | ✓ **`TS2345`** — the checker enforces it |
| a **local** scalar | ✓ lowers, nothing refused |
| **our own** function's parameter | ✗ `NTS1001` a parameter of unrepresentable type (an intersection) |
| `int[]` as a parameter | ✗ `NTS1001` an array of an intersection |
| `int[]` as a local array literal | ✗ `NTS1001` an array literal of unrepresentable type |

And the control that says where representation *does* come from:

| | |
| --- | --- |
| `number[]` | `managed<[f64]>`, `array.get … : f64` |
| **`Int32Array`** | **`managed<view<i32>>`, `array.get … : i32`**, nothing refused |

**The rule, and it is sharper than the question that was asked.** A brand
survives wherever the compiler never has to choose a representation for it, and
is refused wherever it must. A foreign declaration is never lowered, so a brand
there is free; a local scalar erases to its primitive; a parameter of ours and
any array both need a representation, and an intersection has none.

## What this settles, in the order the build depends on it

**1. The `.d.ts` design is validated for consuming Java, and needs no compiler
change.** This is the direction that matters most and it works today. The
binding declares `find(key: int)`, the call site must write
`find(Java.asInt(x))`, and `TS2345` is what makes that mandatory rather than
advisory — which is the whole mechanism that keeps `find(int)` and `find(double)`
apart. Measured, not assumed.

**2. `int[]` is impossible by branding, and the plan already had the right
answer for the wrong reason.** Cost 10a says an integer array is spelled
`Int32Array` because "the element type **is** the TypeScript type, so a branded
array would not narrow". That reasoning predicted this exactly, and the measured
form is stronger: a branded array does not *lower at all*. `Int32Array` gives a
real `i32` view, so `counts(): Int32Array` in the generated declarations is
right and is now checked.

**3. A limit on the other direction, which is new.** `ts-from-java` cannot
publish a function that takes an `int` — our own parameter of intersection type
is refused. So a TypeScript API exported to Java takes `double` for every
number, which is exactly what `expected/Api.javap` already shows. That is a real
constraint on that project rather than a gap in it.

**4. What it does *not* unlock, and saying so is the point.** Build item 2 reads
"the array element type, once (1) says an integer type is expressible", measured
at 14.2% on `awfy-queens`. **(1) says no**, so that route is closed — and the
`Int32Array` result must not be mistaken for an opening. `awfy-queens` holds a
`number[]`, and rewriting it to an `Int32Array` would be editing the benchmark
to win the row, which this repository does not do. The 14.2% still needs
ordinary `number[]` elements to narrow, which is the element-width work upstream
and is unchanged by anything here.

`Int32Array` is available to a programmer who writes it and to a **binding**,
where a Java `int[]` genuinely *is* 32-bit — and that second one is the whole
reason this measurement mattered to interop.

# Build item 3, measured: a copy is noise if you were going to read the data

The plan prices several copies and then says *"if the copy is noise next to the
call, the cliff matters less than this document assumes"*. That sentence had no
number under it. `benches/interop-copy` puts one there, through the same warmup,
time bound and best-of-five the rest of the suite uses.

All rows are **1024 elements** or **64 map entries** per operation, on HotSpot:

| | ns/op | bytes/op |
| --- | --- | --- |
| `inlinable-call` (1024 calls) | 170.0 | 0 |
| `uninlinable-call` (1024 calls) | 3511.7 | 28688 |
| `pass-array-no-copy` (read 1024 doubles) | 332.5 | **0** |
| `copy-double-to-int` | **316.6** | **4112** |
| `copy-int-to-double` | 529.9 | 8208 |
| `build-hashmap-64` | 371.5 | 3120 |
| `reuse-hashmap-64` | 119.5 | 0 |

The allocation column is exact and worth reading first: `copy-double-to-int` is
**4112 bytes**, which is 1024 × 4 plus a 16-byte header — *precisely one
`int[1024]` and nothing else*. Passing the array instead is **0**. So the copy's
entire cost is one array allocation, and the no-copy path allocates nothing at
all rather than nearly nothing.

## The finding, which is not the one the sentence expected

**A 1024-element `double`→`int` copy costs 316.6 ns. Merely *reading* the same
array once costs 332.5 ns.** The copy is *cheaper than one pass over the data it
copies* — same memory traffic, one extra store per element, and the allocation
is a young-gen bump.

So the rule is not "copies are noise" or "copies are the cliff". It is:

> **A copy is noise if you were going to touch the data anyway, and it is the
> whole cost if you were not.**

Where TypeScript iterates an array it received, the copy disappears into the
iteration — one extra pass against the N passes the program was already going to
make. Where an array is handed to Java untouched, a buffer written by the
callee and never read on our side, the copy *is* the entire operation and
zero-copy earns all of it.

That is a sharper design rule than the document had, and it says where to spend:
**the pass-through paths**, not the compute paths.

## Against a call, which is the comparison the sentence asked for

One 1024-element copy costs about **92 uninlinable calls** (3511.7 / 1024 =
3.43 ns each). So next to a *single* foreign call a bulk copy is not noise — it
is two orders of magnitude more.

Two honest caveats on that ratio:

- **Reflection is a desktop stand-in for "a call the JIT cannot inline", and it
  is a generous one.** It boxes every argument — 28688 bytes/op says so — where
  a plain JNI call does not. A real JNI call is *cheaper* than this, which makes
  the copy relatively **more** expensive than 92-to-1, not less.
- **A binder transaction is not measured here and cannot be on a desktop.** It
  is IPC and is orders of magnitude above any row in this table, so for the
  Android APIs that cross a process the copy genuinely is noise. That is the one
  case the original sentence was right about, and confirming it needs
  `tooling/android` and a device.

## What it changes

Nothing is retracted. The eliminations in the cost list stay worth having —
4112 bytes/op is 4112 bytes/op, and `pass-array-no-copy` allocating **zero**
rather than a little is the kind of difference that shows up in a GC pause
rather than in a mean.

What changes is the *order* to do them in. The copies worth eliminating first
are the ones on data TypeScript never reads, because those are the ones where
the copy is 100% of the cost rather than 49% of one pass.

# Build item 6: `.d.ts` generation, and what the generator does that the spec did not

`compiler/jvm-emitter/src/bind.rs` turns a parsed class file into declarations.
The hand-written `examples/interop/java-from-ts/types/com.example.d.ts` was the
**specification** for it; running the generator on the same fixture is how that
spec stopped being aspirational.

Every type-mapping row is forced by something measured rather than chosen: `J`
is `bigint` because a `long` exceeds 2^53; `I` is a branded `int` because a
brand in a **declared** signature lowers cleanly and the checker rejects a plain
`number` with `TS2345`, which is the whole mechanism separating `find(int)` from
`find(double)`; `[I` is `Int32Array` because a branded array does not lower at
all while a typed array gives a real `managed<view<i32>>`.

## Two things the generated output got wrong, and the class file could prove

**A `ConstantValue` field read `string | null`.** It is a compile-time constant
-- the value is *in the class file* and the JVM resolves the read to an `ldc` --
so there is no execution in which it is null. Every use was getting a null check
that could never fire, which is exactly the noise that makes a generated binding
unpleasant enough to hand-edit.

**Enum constants read `Kind | null`.** `ACC_ENUM` on both the class and the
field says what they are, and the JLS guarantees `<clinit>` creates every
constant before any is observable.

Both are now non-null. And the control that keeps the rule honest:
`Catalog.DEFAULT_KIND` is a `static final Kind` that is *not* an enum constant
and has no `ConstantValue`, so it stays `| null` -- the class file genuinely
cannot prove it, and the overrides file is the escape. A rule that made every
static non-null would pass the first two assertions and fail that one.

## Where the generator is right and the hand-written spec was wrong

The spec omitted `find(key: int)`, calling it "unreachable from TypeScript".
That was wrong: `find(Java.asInt(3))` reaches it, and reaching it is the entire
point of the brand. The generator emits all four overloads and the spec should
follow it.

## The gaps, named rather than discovered

- ~~**Generics are read but not rendered.**~~ **Closed.** `names()` now
  surfaces as `java.util.List<string> | null`, `index()` as
  `java.util.HashMap<string, java.lang.Integer>`, `repeat` keeps its own type
  variable `T`, and `List<? extends Number>` renders as its bound because
  TypeScript has no wildcard. The control that proves the `Signature` attribute
  is what is being read: `raw()` has the *same erased descriptor* as `names()`
  and no `Signature`, and must stay unparameterised.
- **A raw type renders as a bare `java.util.List`** rather than
  `List<unknown>`. **Priced and refused**, rather than left as a gap:

  The resolver added for inherited members could answer it -- a class's own
  `Signature` declares its type parameters, so the arity is readable. But
  `reference` has six call sites and the two renderers have fifteen between
  them, and none takes a resolver; threading one through is twenty-one edits,
  and the alternative is another `thread_local`, which the package one already
  is and which should not become a habit.

  **And the symptom does not exist.** `raw(): java.util.List | null` typechecks
  with **zero** TypeScript errors today, because the prelude declares
  `List<T = unknown>` and a defaulted parameter may be omitted. It becomes real
  only when the prelude is itself generated from `java.base` -- which is not
  built, and would be the change that pays for the plumbing.

  So the cost is twenty-one call sites for a case that does not occur. Recorded
  here with the condition that makes it worth doing, rather than built now.
- ~~**Inherited members are not surfaced.**~~ **Closed, through a resolver.**
  `declarations_with(class, resolve)` walks `super_name` upward and emits what
  the subclass does not declare, marked `/** Inherited. */`. `java/lang/Object`
  is skipped -- `toString` and `wait` on every generated class is noise.
  Overrides are matched on name **and** erased descriptor, so a covariant
  override's bridge method does not hide the real one.

  **A callback rather than a jar reader, deliberately.** A jar is a zip, and
  this crate's `Cargo.toml` says every dependency is a maintenance obligation;
  taking a zip *and* a deflate crate to resolve a superclass would be two, for
  a job the caller can already do with the jar it has open.
- **Parameter names are `a0`, `a1`.** Real names need the `MethodParameters`
  attribute, which `javac` only emits under `-parameters`, or the local
  variable table. `android.jar` has neither, so this may be as good as it gets
  and the honest fix is doc comments rather than names.
- **An array return gets `| null`.** Correct -- a Java method can return a null
  array -- and noisy. The overrides file is the answer for the APIs where it
  matters.


# The generator runs, and running it found two things reasoning had not

`compiler/jvm-emitter/examples/bind.rs` takes a directory of class files and a
package and prints the declarations. A directory rather than a jar, and an
example rather than a binary, for the same reason the resolver is a callback: a
jar is a zip, and the crate's dependencies are a maintenance obligation.
`examples/interop/java-from-ts/build.sh` now generates its `.d.ts` and diffs it
against what is committed, so the hand-written specification has been *replaced
by* the generator's output rather than kept beside it.

**Two bugs that only appeared when the output was read**, both producing
TypeScript that would not compile:

- **Declared type parameters were dropped.** `repeat` rendered as
  `repeat(a0: T, ...)` -- using a `T` that nothing introduced. The `<...>` block
  at the head of a generic signature is now parsed and rendered.
- **A sibling class was fully qualified.** `DEFAULT_KIND: com.example.Kind`
  inside `declare module "java:com.example"` names a `com` namespace that does
  not exist; the module's own members are in scope unqualified.

Neither was going to be caught by a test written from the design, because both
are properties of the *whole file* rather than of a member. The thing that found
them was printing it and reading it.

**And a third, closed the same way:** nested classes were emitted top-level, so
`Catalog.Cursor` in a return type referred to nothing. They now go inside an
`export namespace Catalog` emitted after the class, which is the order
TypeScript requires for a declaration merge. `module` is deleted rather than
kept beside `module_of` -- a second way of doing one thing is worse than
changing the one caller.

# Compiling the generated file refuted the brand design outright

Item 1 measured the brand and concluded it "survives exactly where it needs no
representation", validating the `.d.ts`. **That conclusion was drawn from the
wrong shape**, and typechecking the generated declarations against the call
sites is what exposed it.

The first probe used `declare function f(x: int)`. A binding is never a free
function -- it is a **class**. Re-measured across every position a generator
actually emits:

| position | brand |
| --- | --- |
| a **free** declared function's parameter | ✓ lowers |
| a declared **return** | ✗ refused |
| a declared **class property** | ✗ refused |
| a declared **class method's** parameter | ✗ refused |

So the brand was refused at *every* position this generator emits one, and the
single position where it works is the one a binding never takes. The earlier
measurement was correct about what it measured and its scope was drawn by the
design it was checking -- the same failure the compiler lane hit the same day
with `withResolvers`, arriving here by my own hand.

## What replaced it

**Every Java integral width is `number`, and a colliding overload is renamed.**
`find(int)`, `find(long)` and `find(double)` all take a `number`, so the
*least lossy* keeps the plain name -- a `number` **is** an f64, so `double`
receives it without loss -- and the others become `find$int`, `find$long`. That
is greppable, needs no compiler change, and says at the call site which one you
meant, which is the entire job the brand was doing.

**Arrays keep their width for free**, and this is cost 10a's point arriving
intact: `[I` is an `Int32Array`, a distinct TypeScript type that needs no brand
to be one. The width survives exactly where it was always going to.

## Five generator bugs, three found by compiling and two by lowering

None was reachable by reading the file, and three of them produce TypeScript
that does not compile:

1. **A top-level `import` made the file a module**, so `declare module
   "java:com.example"` was a module *augmentation* -- it augments a module that
   must already exist and declares nothing. Every import site read `TS2307
   Cannot find module`. The generated file and the prelude are both global
   scripts now, and the comment in `module_of` says why so it does not get
   "tidied" back.
2. **Declared type parameters were dropped** -- `repeat(a0: T)` using a `T`
   nothing introduced.
3. **Nested classes were emitted top-level**, so `Catalog.Cursor` referred to
   nothing.
4. **Varargs were not spread** -- `sum(a0: Int32Array)` called as `sum(1, 2, 3)`
   is `TS2554 Expected 1 arguments, but got 3`. `ACC_VARARGS` says which method,
   and the ABI type stays the array because `javac` packs at the call site.
5. **The brands, above**, which compiled and then refused in the lowering.

## Where it stops, and it is a precise work list

With zero TypeScript errors, what remains are lowering refusals that each name
what the binding needs and does not have:

```
a member of `HashMap`, a class this compiler has no type for
a method without a body
a parameter of unrepresentable type (the type parameter `T`)
```

Those are the foreign-layout work, the binding table, and generics in our own
signatures -- the three things gated upstream. A `.d.ts` that typechecks and
refuses to lower for exactly three named reasons is a much better place to hand
over from than one that has never been compiled.


# The three upstream patches, built and sent

All three are in `compiler/core/src/hir/**`, which this lane does not own, so
each was built and tested in a detached worktree and handed over as a diff. All
three are **inert on landing** -- none has a caller until a binding table exists
-- so none can move a number on anyone else's side.

| | what it is | why it is sound |
| --- | --- | --- |
| `nominal_name` | `+ is_foreign_name(name)`, where a foreign layout is named by its JVM binary name and `/` cannot appear in a TypeScript identifier | measured: two field-less layouts *do* merge, the emitter repairs it by subclassing, and that repair works by **inventing a name** -- which is exactly what a class whose binary name is fixed by its jar cannot have |
| `Facts::from_jvm_descriptor` | `I` gives `whole = true`, no NaN, no `-0`, 32-bit bounds | the JVM enforces it at class load, so it is a platform invariant rather than an inference. `D`, `J` and references return `None` |
| `foreign_key` / `foreign_keeps` | a canonical `owner.member:descriptor` key, and `keeps` routing one to a separate table | needs **no `Program` change**: `Callee::External` already carries a string, so a bound call carries the key as its name and `escape.rs`'s call site is untouched |

**Each carries the control that would fail if the change did nothing**, which is
the half worth more than the feature:

- `nominal_name`: `Alpha` and `Beta` must still **not** be nominal, or the rule
  stops ordinary empty classes merging and costs the subclass repair its purpose.
- `from_jvm_descriptor`: the result must differ from `Facts::TOP`, or the patch
  buys nothing; and `D`/`J`/references must answer `None`, or it claims a
  narrowing that does not exist.
- `foreign_keeps`: every **existing** helper answer must be unchanged --
  `nts_str_append` keeps `[0]`, `nts_concat` keeps `[]`. A routing change that
  quietly stopped answering for the helpers would pass every new test and break
  the thing the table was built for.

The key is **one derivation** shared by the generator and the reader, because
two would drift in the worst available way: a mismatch surfaces as a *silently
missing* escape answer. The argument gets assumed to escape, the program stays
correct, and the optimisation never happens -- it costs speed and reports
nothing.


# The escape analysis, and the 88.5% that was a lie

`foreign_keeps` returning `None` means every argument to a Java call is assumed
to escape. The jar has the callee's bytecode, so for a method with a body the
answer is computable rather than declarable -- and *"a copy you did not have to
make"* is the whole thesis, so this is the mechanism that earns it.

`compiler/jvm-emitter/src/escapes.rs` walks the `Code` attribute with an
abstract stack whose entries are "this is parameter *n*" or "something else",
and marks a parameter escaped when something that can publish a reference
consumes it. Conservative at every fork -- any `invoke` escapes the whole stack,
a branch target resets it, an unknown opcode abandons the method -- so it is
only ever wrong in the direction that costs speed.

## Measured on `android.jar`, and the first number was spectacular and false

| | before the guard | after |
| --- | --- | --- |
| methods taking a reference | 2724 | 2724 |
| analysed | 2442 | **52** |
| proved: none escapes | **2411 (88.5%)** | **26 (1.0%)** |

**`android.jar` is a stub jar.** Every body in it is:

```
new java/lang/RuntimeException; dup; ldc "Stub!"; invokespecial; athrow
```

The parameter is never loaded, so "did anything publish it" answers **nothing
escapes** -- about a method whose real implementation, on the device, may retain
everything. A **permissive** wrong answer, which is the one direction this
analysis must never fail in, and it would have let us stack-allocate an object
Android keeps.

The guard is not a stub-specific hack: **a body with no return instruction never
returns normally, and tells you nothing about its parameters.** True of any
method that only throws, and exactly the class of body whose bytecode is not its
behaviour.

The control is the other column: our own fixture, whose bodies are real, is
**unchanged at 23.1%**. A guard that rejected everything would have collapsed
both.

## And then the same failure again, one level down

The first corrected numbers were **still** inflated, by the same sign. The
unmodelled-opcode arm cleared the stack and pushed "something else" -- which
*discards the evidence* and reports non-escaping. `FilterOutputStream.write
(byte[])` calls `write(b, 0, b.length)` and came back `escaping=[]`: the
textbook escape, answered permissively, because `b` left the model at
`arraylength` two instructions before the `invoke` that publishes it.

An instruction whose effect is not modelled **might have published what it
consumed**, so the safe reading is that it did. Four one-pop-one-push
instructions are now modelled exactly -- `arraylength`, `getfield`, `checkcast`,
`instanceof` -- because they are what stand between a parameter and the call
that publishes it, and everything else fails closed.

| corpus | before | after |
| --- | --- | --- |
| `java.base` (real code) | 25.6% | **4.5%** |
| our fixture | 23.1% | **7.7%** |
| `android.jar` (declarations) | 1.0% | **0.0%** |

The control that it has not simply become "everything escapes": 348 methods of
`java.base` still prove non-escaping, including `String.rangeCheck([CII)` -- a
pure validator over a `char[]` -- and `String(String)`, which copies rather than
retains.

## What 4.5% settles, and it is not what 25.6% would have

**The overrides file is the mechanism for every jar, not just for Android.** The
analysis proves non-escape for about **one in twenty-two** reference-taking
methods even on a jar that is nothing but real code. That is worth having and it
is not a substitute for a curated list.

The earlier conclusion -- "the analysis earns its keep on jars that ship real
code" -- was drawn from the inflated 25.6% and is withdrawn.

**And the generalisation is about a class of input rather than about Android.**
Any jar of *declarations* is unanalysable by construction, and an analysis that
answers confidently about one is answering about the absence of code. The tell
is now unambiguous: `android.jar` proves non-escape for **zero** methods and
demonstrates escape for 52, where `java.base` demonstrates escape for 6,551. A
corpus where almost nothing demonstrably escapes is a corpus where almost
nothing is implemented.


# The table, which is where the analysis stops being unobservable

`escapes::table(class)` emits one row per method the analysis could read, keyed
in `hir::runtime::foreign_key`'s format -- `owner.member:descriptor` -- so the
generator and `keeps` share **one** derivation of the key. `NTS_BIND_KEEPS=1`
on the `bind` example prints it.

```json
"com/example/Catalog.find:(I)I": [],
"com/example/Catalog.find:(Ljava/lang/String;)I": [0],
```

**That pair is the test that matters**, and it is not "this key answers `[0]`".
It is *"this key answers `[0]` and a key differing only in descriptor does
not"* -- because a lookup that ignored the descriptor would pass the first and
fail the second. Two overloads sharing a name is exactly why the descriptor is
in the key, pointed at the test rather than at the format.

## Methods the analysis could not read are **absent**, not empty

An absent entry means "assume every argument escapes", which is always sound.
An empty entry is a *claim* that nothing does. A table that wrote `[]` for an
`abstract` method would turn ignorance into permission -- which is the failure
this analysis has now made twice, so the table is built so it cannot be made a
third time.

## The table size is itself the declarations-jar signal

| | methods | rows |
| --- | --- | --- |
| `java.base` (real code) | 15,309 | **11,523** |
| `android.jar` (declarations) | 7,402 | **97** |

A jar whose escape table is nearly empty is a jar with nearly no code in it.
That reading needs no threshold and no heuristic: the artefact's own size says
which class of input it came from, which is what makes the next stub jar
recognisable before it produces a number.


# `Session$bump` — why the `$` is awkward, and the order the fix has to come in

Raised as DX feedback on `ts-from-java`, which is what that project is for.

**The `$` is correct as a mangling rule and wrong as an API.** It comes from
`symbols::jvm_member_name`, which replaces every non-alphanumeric ASCII
character because DEX forbids them -- so HIR's `Session#bump` becomes
`Session$bump`. The rule is right and the comment above it earned itself: an
earlier hand-written list of six characters was missing `@` and twenty-one
others, a space among them, which `class C { "a b": number }` produces from four
lines of legal TypeScript.

And `$` is the JVM's **own** convention for compiler-generated names:
`Outer$Inner`, `lambda$main$0`, `this$0`. Seeing one means *"synthetic, not
yours to call"*. So the character is not the problem. The problem is that this
name is currently **the public API**, and a name that looks synthetic should not
be the thing a caller types.

## Two fixes, and one of them cannot come first

**The signal.** `ACC_SYNTHETIC` on the mangled statics tells IDEs and
decompilers to hide them, which is exactly what the flag is for --
`class.rs` already carries it with the comment *"Debuggers and decompilers use
it to decide what to show a human."*

**Measured before proposing it, and it inverts the order.** `javac` does not
merely hide a synthetic member -- it **refuses to reference one**. Patching
`ACC_SYNTHETIC` onto an ordinary static and compiling a caller against it:

```
error: cannot find symbol
    System.out.println(Lib.helper(1));
                          ^
  symbol: method helper(int)
```

So marking the statics synthetic *today* would make TypeScript **uncallable from
Java at all**. It is the right end state and it is only safe once something else
is callable.

**The facade, which has to come first.** An instance method per exported method,
forwarding to the static:

```java
public double bump() { return Program.Session$bump(this); }
```

Three instructions, inlined to nothing by C2 and ART, emitted only on exported
classes. Our own call sites keep `invokestatic` and lose nothing; the Java
caller writes `s.bump()` and never sees the static. **Then `$` is not awkward,
because it is no longer the API** -- it is a synthetic name marked synthetic,
which is what the convention is for.

## Why the facade is a patch and not a commit

It needs to know **which layout a method belongs to**, and HIR does not say.
`Func` carries `name`, `params`, `return_type` and `exported`; there is no
owner. `Layout.methods` is the *dispatch* table, so a non-virtual method like
`Session.bump` is not in it either.

The two available routes are parsing the name for `#` -- a second derivation of
a fact the lowering already had, which is the hazard this document keeps
hitting -- or an owner on `Func`, which is a middle-end change and therefore
goes upstream as a patch rather than being built here on a string prefix.


# `s.bump()`, and the order the two halves had to come in

The DX question was answered by building it, and the answer is that the surface
sugars to zero cost.

```java
nts.gen.Session s = new nts.gen.Session();
double first = s.bump();
```

**The intention behind the static is unchanged.** `Callee::Direct` still lowers
to `invokestatic`, and our own call sites never look at the class. What the
class gained is one instance method per exported method, forwarding to the
static.

**Measured, because "without performance cost" is a claim about generated
code.** `benches/interop-facade` times the same static called directly against
the same static through a forwarder:

| | minimum over four sittings |
| --- | --- |
| `static-call` | 458.96 ns |
| `through-facade` | **457.43 ns** |

The forwarder is nominally faster -- which is to say the difference is noise,
and the spread *inside* each arm (6.2 ns) is larger than the gap between them.
Both arms return the same checksum and both read from an array the JIT cannot
fold, because an earlier benchmark in this tree read 0.3554 ns for 1024 calls by
being foldable.

## Ownership, without asking HIR to carry it

`Func` has no owner and `Layout.methods` is the *dispatch* table, so a
non-virtual method is in neither. What the lowering does record is structural:

```
export func Session#bump(this: managed<obj#1>) -> f64
```

First parameter named `this`, typed as the layout, set deliberately in `lower`.
So ownership is read from the **type**, and the name is an independent check --
`<layout>#<member>` must agree, and a disagreement skips rather than guesses.
That keeps a hand-written `function f(this: Foo)`, which TypeScript allows, from
being silently attached to a class.

One predicate answers it, asked by both the forwarder emission and the access
flags below. Two copies would drift into a static marked synthetic with no
instance method to replace it -- which is not a wrong answer that runs, it is an
API that vanishes.

## And then the statics go synthetic, which could not have come first

`ACC_SYNTHETIC` tells a debugger or decompiler to hide a member. `javac` proves
it took effect:

```
error: cannot find symbol
    nts.gen.Program.Session$bump(s)
  symbol: method Session$bump(Session)
```

**The order was forced by a measurement, not chosen.** `javac` does not merely
*hide* a synthetic member -- it refuses to reference one. Marking these before
the forwarders existed would have made TypeScript **uncallable from Java**
rather than merely tidier.

The control is the half that matters: a free function has **no** forwarder, so
`Program.greet(...)` *is* its API and marking it synthetic would make it
uncallable. A rule that marked every static would pass the first assertion and
break every free function in the program. `tests/java_surface.rs` asserts both
directions.

So `$` is no longer awkward, because it is no longer the API: it is a synthetic
name marked synthetic, which is what the JVM convention is for.
