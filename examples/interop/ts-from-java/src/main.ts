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
