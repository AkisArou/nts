// The other half: what this binding REFUSES, and the message each produces.
//
// A set of examples that only demonstrates what works is an advertisement.
// Every line below is commented out because it does not compile; the comment
// above it is the diagnostic the compiler emits, verbatim.

import { Catalog } from "java:com.example";
import { Java } from "nts:java";

export function refused(): void {
  const catalog = new Catalog("widgets");

  // NTS4101: `find` has four Java overloads and a `number` is losslessly
  // received by exactly one of them, `find(double)`. To call `find(int)`,
  // narrow explicitly: `find(Java.asInt(x))`.
  //
  //   catalog.find(1.5 as int);

  // NTS4102: cannot mix `bigint` and `number`. `Catalog.id()` returns a
  // `long`, which exceeds 2^53 and does not round-trip through a `number`.
  // Convert explicitly with `Number(id)` and accept the loss, or keep it a
  // bigint.
  //
  //   const wrong = catalog.id() + 1;

  // NTS4103: `describe` may return null. Narrow it before use.
  //
  //   const n = catalog.describe(Java.asInt(1)).length;

  // NTS4104: a Java `HashMap` is not a JavaScript `Map` and has no
  // `forEach`. Use `keySet()` with an iterator, or `Java.toMap(h)` which
  // COPIES -- the copy is why it is not implicit.
  //
  //   catalog.index().forEach((v, k) => console.log(k, v));

  // NTS4105: `Catalog.Cursor` is an inner class and cannot be constructed
  // without its outer instance. Use `catalog.cursorAt(...)`.
  //
  //   const c = new Catalog.Cursor(Java.asInt(0));

  // NTS4106: `parse` declares `throws NumberFormatException`. A Java
  // exception is not yet catchable by a TypeScript `try`/`catch`; it is
  // raised as an `NtsRefusal` naming the exception and the method. Guard the
  // input instead.
  //
  //   try { catalog.parse("abc"); } catch (e) { /* never reached */ }

  // NTS4107: a value-returning callback cannot be registered on a thread
  // with no environment. See examples/interop/android-shape.
}
