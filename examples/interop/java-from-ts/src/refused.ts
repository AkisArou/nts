// The other half: what this binding refuses, and the message each actually
// produces.
//
// A set of examples that only demonstrates what works is an advertisement.
//
// **Every code below was measured**, by writing the line and running
// `nts check` over this project. An earlier version of this file quoted nine
// `NTS41xx` codes that **do not exist in the compiler** -- invented while
// writing the prose, and authoritative-looking in the one file whose whole job
// is to be believed about refusals. The real diagnostics are better than the
// invented ones in every case: they name the type and the member.

import { Catalog } from "java:com.example";

export function refused(catalog: Catalog): void {
  // ---------------------------------------------------------------------
  // Refused by the checker
  // ---------------------------------------------------------------------

  // TS2365: Operator '+' cannot be applied to types 'bigint' and '1'.
  //
  // `Catalog.id()` is a Java `long`, which exceeds 2^53 and does not
  // round-trip through a `number`. Convert with `Number(id)` and accept the
  // loss, or stay in bigint.
  //
  //   const wrong = catalog.id() + 1;

  // TS2531: Object is possibly 'null'.
  //
  // `describe` is `@Nullable` in the Java, read from the CLASS-retention
  // annotation table. Narrow it before use.
  //
  //   const n = catalog.describe(1).length;

  // TS2339: Property 'forEach' does not exist on type 'HashMap<string, Integer>'.
  //
  // A Java `HashMap` is not a JavaScript `Map`, and this is what that costs at
  // a call site. Use `keySet()` with an iterator. There is no implicit
  // conversion because there is no cheap one: building a JS `Map` from it is
  // O(n) plus an allocation, on every crossing.
  //
  //   catalog.index()!.forEach(() => {});

  // TS2554: Expected 2 arguments, but got 1.
  //
  // `Catalog.Cursor` is a **true inner class**, so its constructor takes the
  // outer instance as a synthetic first parameter -- which is exactly what
  // `javac` emits for `outer.new Cursor(n)`, and the count is the proof. Use
  // `catalog.cursorAt(...)`, which passes `this` for you.
  //
  //   const c = new Catalog.Cursor(0);

  // ---------------------------------------------------------------------
  // Not refused, and worth knowing why
  // ---------------------------------------------------------------------

  // `catalog.find(1.5)` **compiles**, and picks `find(double)`.
  //
  // This was listed as a refusal when the plan expected a branded `int` to
  // make the overloads distinguishable. Brands were measured and refused at
  // every position a binding emits one, so there is nothing to reject here:
  // a `number` is an f64, `double` receives it losslessly, and the truncating
  // overload is reachable under a different **name** as `find$int(3)`.

  // `catalog.parse("abc")` **compiles**, and fails at run time.
  //
  // `parse` declares `throws NumberFormatException`. The call is wrapped and
  // the exception is raised as an `NtsRefusal` naming the Java exception and
  // the method -- so the program *declines* rather than dying with a stack
  // trace, which also keeps the differential harness from reading it as a
  // defect. It is not yet catchable by a TypeScript `try`/`catch`.

  // A value-returning callback on a foreign thread is refused at bind time.
  // That one lives in `examples/interop/android-shape`, because it needs a
  // callback interface to refuse.
  void catalog;
}
