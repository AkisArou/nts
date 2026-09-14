// TypeScript calling Java. What a consumer actually writes.
//
// **This file compiles, and lowers.** `nts check` runs over it and the
// generated declarations together, which is what turned five generator bugs
// into fixes -- three that would not compile, and two that compiled and then
// refused in the lowering. The friction below is measured rather than
// predicted.

import { Catalog, Kind } from "java:com.example";

export function main(): string {
  const catalog = new Catalog("widgets");

  // --- a public Java field, read and written -------------------------------
  // A plain `getfield` / `putfield`, byte-identical to what javac emits.
  catalog.hits = 3;
  const hits = catalog.hits;

  // --- statics --------------------------------------------------------------
  // `MAX` and `NAME` are ConstantValue statics, so these compile to an `ldc`
  // each and never load `Catalog` at all. Note neither needs a null check: a
  // compile-time constant is provably present, which the generator reads from
  // the class file rather than being told.
  const cap = Catalog.MAX;
  const label = Catalog.NAME;

  // `DEFAULT_KIND` is a reference static: a real `getstatic` that runs
  // `<clinit>` -- and it IS nullable, because nothing in the class file proves
  // otherwise. This is the friction the binding cannot remove for you.
  const kind = Catalog.DEFAULT_KIND;
  const weight = kind === null ? 0 : kind.weight();

  // An enum constant needs no check: `ACC_ENUM` proves it.
  const small = Kind.SMALL.weight();

  // --- collections stay Java, and cost nothing to hold ----------------------
  // No copy on any of these lines: `index()` hands back the same HashMap the
  // Java method returned.
  const index = catalog.index();
  // A boxed `Integer` is a `number`, so this is `?? 0` rather than a null
  // check and an `intValue()`. The nullability survives the mapping -- `get`
  // still returns `number | null`, because a Java map answers null for a key
  // it does not have.
  const count = index === null ? 0 : (index.get(label) ?? 0);

  const names = catalog.names();
  const first = names === null ? "" : names.get(0);

  // A Java `int[]` IS an Int32Array: same object, no copy, and the element
  // type narrows, so this loop is integer arithmetic.
  const counts = catalog.counts();
  let total = 0;
  if (counts !== null) {
    for (let i = 0; i < counts.length; i++) {
      total = total + counts[i];
    }
  }

  // A Java `byte[]` IS a Uint8Array, and `subarray` is a view rather than a copy.
  const bytes = catalog.bytes();
  const head = bytes === null ? 0 : bytes.subarray(0, 4).length;

  // --- long is bigint, and the friction is deliberate ------------------------
  const id = catalog.id();
  // `id + total` does not compile: you cannot mix bigint and number. That is
  // the type system refusing to round 2^53+1 silently.
  const idAsText = id.toString();

  // --- overloads resolve by losslessness ------------------------------------
  // `find(number)` is `find(double)`: the only overload that receives a
  // `number` without loss. The truncating one is reachable under a different
  // NAME rather than a different type, because a branded `int` does not lower
  // in a class method's parameter -- measured, and it is why `find$int` exists.
  const byNumber = catalog.find(1.5);
  const byInt = catalog.find$int(3);
  const byLong = catalog.find(42n);              // -> find(long)
  const byText = catalog.find("abc");            // -> find(String)
  const rendered = catalog.render("x");          // -> render(String), JLS 15.12.2

  // --- varargs spread at the call site, exactly as in Java -------------------
  // `javac` packs these into an `int[]` here; the ABI type is still the array.
  const summed = catalog.sum(1, 2, 3);

  // --- nullability is in the type ------------------------------------------
  const described = catalog.describe(1);
  const describedLength = described === null ? 0 : described.length;
  const name = catalog.name();

  // --- generics surface -----------------------------------------------------
  const threeNames = catalog.repeat("x", 3);
  const repeated = threeNames === null ? 0 : threeNames.size();

  // `total(List<? extends Number>)` takes a **Java** List, and TypeScript has
  // no literal for one. `catalog.total([1, 2, 3])` does not compile, and there
  // is no conversion that is free -- building a Java List means allocating one
  // and copying into it. So the honest call passes a List Java already made:
  const raw = catalog.raw();
  const anything = raw === null ? 0 : raw.size();

  // --- nested and inner -----------------------------------------------------
  // --- a Map going IN, which is the direction the design is about ---------
  //
  // `NtsMap implements java.util.Map`, so this is a reference crossing: the
  // table Java iterates IS the one built two lines up. No copy, no wrapper, no
  // O(n) at the boundary.
  //
  // `weigh` takes `Map<String, Double>`. `countOf` next door takes
  // `Map<String, Integer>` and **cannot** take this map -- see `refused.ts`.
  // A map from TypeScript carries `java.lang.Double` for a number, so the
  // binder offers the TypeScript `Map` arm only where a `Double` satisfies the
  // declaration. It used to offer it everywhere, which type-checked on both
  // sides and then threw `ClassCastException` inside the Java loop.
  const weights = new Map<string, number>();
  weights.set("a", 1.5);
  weights.set("b", 2.5);
  const weighed = catalog.weigh(weights);

  // A `Set` goes in on the same terms as the `Map` above: `NtsSet implements
  // java.util.Set`, so Java iterates the table this built.
  const words = new Set<string>();
  words.add("ab");
  words.add("cde");
  const counted = catalog.countIn(words);

  const entry = new Catalog.Entry("k");           // static nested: constructs directly
  const cursor = catalog.cursorAt(2); // inner: outer passed first
  const owner = cursor === null ? "" : cursor.owner();

  return `${label} ${hits} ${cap} ${weight} ${small} ${count} ${first} ${total} ` +
    `${head} ${idAsText} ${byNumber} ${byInt} ${byLong} ${byText} ${rendered} ` +
    `${summed} ${describedLength} ${name} ${repeated} ${anything} ${entry.key} ${owner} ${weighed} ${counted}`;
}
