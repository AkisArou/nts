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

  // NTS1001: a call inside a `try`, whose `throw` would not reach this handler
  //
  // A Java method can throw, and a TypeScript `try` cannot catch it: a `throw`
  // lowers to a jump to the handler *block*, which is a branch inside one
  // function, and a callee has no edge back to its caller's handler. Refused
  // rather than compiled, because the alternative is a `catch` that never runs.
  //
  // **This was a wrong answer until 2026-09-15 and is the reason this section
  // exists.** The guard has always been here and had always fired for a
  // TypeScript call; it could not see a bound one. `calls_compiled_code` tests
  // membership of a set built by scanning function *bodies* for a `throw`, and
  // a declaration-only foreign method has no body -- so it was structurally
  // excluded rather than overlooked. The `try` compiled, emitted no exception
  // table, and aborted where node prints the caught value.
  //
  // A native C call is still allowed inside a `try`, and that is not an
  // oversight: C cannot unwind into TypeScript, so there is nothing to catch
  // and nothing to refuse.
  //
  //   try { catalog.parse("abc"); } catch (e) { }

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

  // TS2739: Type 'Map<string, number>' is missing the following properties from type 'java.util.Map<string, number>': isEmpty, containsKey, put, remove, keySet
  //
  // **A TypeScript `Map` crosses into Java for free, but not into every
  // signature.** `catalog.weigh(m)` in `main.ts` takes the same map with no
  // copy, because it declares `Map<String, Double>`. `countOf` declares
  // `Map<String, Integer>`, and a map arriving from TypeScript carries
  // `java.lang.Double` for a number -- measured by reading `getClass()` on the
  // Java side, not assumed.
  //
  // So the binder offers the TypeScript `Map` arm only where what we actually
  // store satisfies the declaration. It used to offer it unconditionally, and
  // that was worse than this refusal in the way that matters: the call
  // type-checked on both sides, crossed with no copy, and threw
  // `ClassCastException` from inside the callee's loop, with our frame no
  // longer on the stack. Erasure means `javac` checks nothing here.
  //
  // The way through is `Double` on the Java side, or `keySet()` on ours.
  //
  //   catalog.countOf(new Map<string, number>());

  // TS2339: Property 'forEach' does not exist on type 'HashMap<string, number>'.
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
  // `parse` declares `throws NumberFormatException`, and **the exception
  // propagates as itself**: `java.lang.NumberFormatException: For input string:
  // "abc"` with a Java stack trace, terminating the program.
  //
  // Corrected 2026-09-15. This said the call was wrapped and the exception
  // raised as an `NtsRefusal` naming the Java exception and the method, so that
  // the program declined rather than dying -- and none of that happens. The
  // emitted method has **no exception table** and the class references
  // `NtsRefusal` zero times; `javap -c` says so in one line each. The stated
  // benefit, that the differential harness would not read it as a defect, was
  // therefore not being obtained either.
  //
  // Nor is it catchable by a TypeScript `try`/`catch`, which is the one part
  // of the old comment that was right.

  // A value-returning callback on a foreign thread is refused at bind time.
  // That one lives in `examples/interop/android-shape`, because it needs a
  // callback interface to refuse.
  void catalog;
}
