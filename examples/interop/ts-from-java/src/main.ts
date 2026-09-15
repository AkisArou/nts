// TypeScript published so that Java can call it.
//
// This project COMPILES AND RUNS TODAY: `nts emit-jvm` produces the class
// files, `javac` type-checks Java against them, and `expected/Api.javap` is a
// real artefact rather than a specification.

export class Session {
  // `#hits` rather than `private hits`: `private` is a checker-only marker and
  // leaves an own enumerable key, where `#` is genuinely inaccessible.
  #hits: number = 0;

  // The accessor that makes item 0 work. A Java caller mutating through this
  // performs a `FieldSet` *in the HIR*, which is exactly what `hir::fields`
  // needs to keep its narrowing sound. The field itself is package-private and
  // Java cannot reach it.
  bump(): number {
    this.#hits = this.#hits + 1;
    return this.#hits;
  }

  hits(): number {
    return this.#hits;
  }
}

export function greet(name: string): string {
  return "hello " + name;
}

export function total(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum = sum + values[i];
  }
  return sum;
}

/// A JavaScript `Map`, handed to Java as a `java.util.Map` with **no copy**.
///
/// `NtsMap implements java.util.Map` is what makes this work: the object a
/// Java caller receives IS the table this function wrote, backed by the same
/// arrays. The alternative -- converting at the boundary -- is O(n) plus an
/// allocation on every crossing.
export function tags(): Map<string, string> {
  const m = new Map<string, string>();
  m.set("kind", "session");
  m.set("state", "open");
  return m;
}

/// And the SameValueZero property, which is the reason this table is not a
/// `LinkedHashMap`: JS keys `+0` and `-0` as the same key, and normalising at
/// insert makes that coincide exactly with Java's `Double.equals`.
export function zeroKeyed(): Map<number, string> {
  const m = new Map<number, string>();
  m.set(0, "positive zero");
  return m;
}

/// `long` and `bigint` do not meet in the middle, and here the friction lands
/// on the *Java* side.
///
/// A TypeScript `bigint` is `nts.rt.NtsBigInt` -- 128 bits, wrapping, two
/// `long` slots and no allocation per operation -- so this publishes as
/// `NtsBigInt scaled(NtsBigInt)` and a Java caller cannot hand it a primitive.
/// They write `NtsBigInt.fromLong(n)` and read the result back with
/// `toBigInteger`, `toText` or `toNumber`.
///
/// Publishing `long` would be the smaller-looking API and the wrong one: the
/// result below exceeds `Long.MAX_VALUE`, so that signature would truncate
/// precisely the range a program reaches for `bigint` to get.
export function scaled(seed: bigint): bigint {
  return seed * 1000000007n;
}

/// A `string[]` is a `java.lang.String[]`, on the same no-copy rule as
/// `number[]` -> `double[]` above: the array a Java caller passes IS the array
/// this loop reads.
///
/// That holds only because nothing in this program can `push`. `arrays_can_grow`
/// is whole-program, so one `push` anywhere moves *every* array in the program
/// behind a growable wrapper and this signature becomes a wrapper type.
export function joined(names: string[], sep: string): string {
  let out = "";
  for (let i = 0; i < names.length; i++) {
    if (i > 0) {
      out = out + sep;
    }
    out = out + names[i];
  }
  return out;
}

/// A JavaScript `Set`, handed to Java as a `java.util.Set` with **no copy**.
///
/// `NtsSet implements java.util.Set`, the sibling of `NtsMap` over a shared
/// `NtsTable`. Until 2026-09-15 there was one class carrying a boolean for
/// which it was, so it implemented `java.util.Map` whichever it was -- and this
/// function would have handed Java a `Map` whose values equalled its keys.
/// Coherent, and not what the TypeScript says.
///
/// The obstacle was never the JVM. `Map.remove` returns `V` and `Set.remove`
/// returns `boolean`, and the design doc called that "a return-type clash the
/// JVM rejects outright" -- measured false: a descriptor includes the return
/// type, so those are two methods, and a class implementing both loads and
/// dispatches correctly under `-Xverify:all`. What refuses is `javac`, which
/// this runtime is compiled with, so the answer was two classes.
export function labels(): Set<string> {
  const s = new Set<string>();
  s.add("alpha");
  s.add("beta");
  return s;
}

/// A TypeScript function taking a callback, which Java may satisfy with a
/// **lambda**.
///
/// The parameter's own type is a closure base -- an `abstract class`, not an
/// interface, because a closure call is `invokevirtual` on it and making it an
/// interface would turn every closure call in every program into
/// `invokeinterface` to serve the ones Java reaches. Java has no syntax for an
/// abstract class, so the emitter publishes a second overload taking the
/// matching `Nts*Callback`, which Java can lambda, and wraps it.
///
/// **One allocation, and only on this path.** A TypeScript caller passes its
/// own closure to the closure form and never touches the wrapper; `javac` picks
/// the most specific overload, so only a lambda -- which is not a closure --
/// reaches it.
export function eachUpTo(n: number, f: (x: number) => void): void {
  for (let i = 0; i < n; i++) {
    f(i);
  }
}

/// A closure of our own, so the lowering has one: a program with no closures at
/// all refuses to call a function value, which is a `NTS1001` from lowering
/// rather than from this backend.
export function triangle(n: number): number {
  let total = 0;
  eachUpTo(n, (x: number): void => {
    total = total + x;
  });
  return total;
}
