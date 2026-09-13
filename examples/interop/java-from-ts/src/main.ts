// TypeScript calling Java. What a consumer actually writes.
//
// Read this for the ergonomics, not the logic: every line is chosen because it
// is a decision in docs/jvm-interop.md arriving at a call site.

import { Catalog, Kind } from "java:com.example";
import type { int } from "../types/java";

// `Java.asInt` and friends are the explicit narrowing conversions. They are
// *not* runtime calls -- a brand erases -- so this is a checker-level cast that
// costs nothing and forces you to say which width you meant.
import { Java } from "nts:java";

export function main(): void {
  const catalog = new Catalog("widgets");

  // --- a public Java field, read and written -------------------------------
  // A plain `getfield` / `putfield`, byte-identical to what javac emits.
  catalog.hits = Java.asInt(3);
  const hits: int = catalog.hits;

  // --- statics --------------------------------------------------------------
  // `MAX` and `NAME` are ConstantValue statics: these two lines compile to an
  // `ldc` each and never load `Catalog` at all.
  const cap = Catalog.MAX;
  const label = Catalog.NAME;
  // `DEFAULT_KIND` is a reference static, so this one IS a `getstatic` and
  // runs `Catalog.<clinit>`.
  const kind = Catalog.DEFAULT_KIND;
  const weight = kind.weight();

  // --- collections stay Java, and cost nothing to hold ----------------------
  // No copy anywhere on these four lines. `index()` hands back the same
  // HashMap object the Java method returned.
  const index = catalog.index();
  const boxed = index.get(label); // `Integer | null` -- Java's `get`
  const count = boxed === null ? 0 : boxed.intValue();

  const names = catalog.names(); // the same java.util.List
  const first = names.get(Java.asInt(0)); // no toArray(), so no allocation

  // A Java `int[]` IS an Int32Array. Same object, and the element type narrows
  // because it is the TypeScript type -- this loop is integer arithmetic.
  const counts = catalog.counts();
  let total = 0;
  for (let i = 0; i < counts.length; i++) {
    total = total + counts[i];
  }

  // A Java `byte[]` IS a Uint8Array, and `subarray` is a view.
  const bytes = catalog.bytes();
  const head = bytes.subarray(0, 4);

  // --- long is bigint, and the friction is deliberate ------------------------
  const id = catalog.id(); // 9007199254740993n
  // `id + total` does not compile: you cannot mix bigint and number. That is
  // the type system refusing to round 2^53+1 silently.
  const idAsText = id.toString();

  // --- overloads resolve by losslessness ------------------------------------
  const byNumber = catalog.find(1.5); // -> find(double). NOT find(int).
  const byLong = catalog.find(42n); // -> find(long)
  const byText = catalog.find("abc"); // -> find(String)
  // -> render(String), by JLS 15.12.2 most-specific, not by our guess.
  const rendered = catalog.render("x");

  // --- varargs allocate one array per call, exactly as in Java ---------------
  const summed = catalog.sum(Java.asInt(1), Java.asInt(2), Java.asInt(3));

  // --- nullability is in the type ------------------------------------------
  const described = catalog.describe(Java.asInt(1));
  const describedLength = described === null ? 0 : described.length;
  // `catalog.name()` is declared non-null via bind.overrides.json, so no check.
  const name = catalog.name();

  // --- generics surface -----------------------------------------------------
  const threeNames = catalog.repeat("x", Java.asInt(3)); // List<string>
  const sum = catalog.total([1, 2, 3]); // ? extends Number
  const anything = catalog.raw(); // List<unknown>

  // --- nested and inner -----------------------------------------------------
  const entry = new Catalog.Entry("k"); // static nested: constructs directly
  const cursor = catalog.cursorAt(Java.asInt(2)); // inner: outer passed first
  const owner = cursor.owner();

  console.log(
    `${label} ${hits} ${cap} ${weight} ${count} ${first} ${total} ` +
      `${head.length} ${idAsText} ${byNumber} ${byLong} ${byText} ${rendered} ` +
      `${summed} ${describedLength} ${name} ${threeNames.size()} ${sum} ` +
      `${anything.size()} ${entry.key} ${owner}`,
  );
}
