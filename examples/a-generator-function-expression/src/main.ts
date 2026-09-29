// A `function*` **expression** is a generator, and `begin_generator` had two
// callers: `lower_function` and the method path. `lower_closure` was the third
// and did not ask, so the body was lowered as an ordinary function and every
// `yield` in it said "a `yield` outside a generator" -- true of the lowering and
// false of the source.
//
// The comment at the second call site records the same discovery for *methods*
// ("`begin_generator` had one caller, `lower_function`, so a `*named()` ...
// reached its body with no frame reserved"). This is the third time one lowering
// path of three missed a per-function `begin_*`, which is why the fix is the call
// the other two already make rather than a clause of its own.
//
// The conformance lane counts **460 of the corpus's ~800 no-verdict rows** behind
// it: `FellThrough { func: "Closure0#call" }` where the body was lowered as an
// ordinary function, and "a `yield` outside a generator" where it was not. Every
// `dstr/` test in test262 builds its iterator this way -- `var iter =
// function*() { yield 1; }()`.

/** The reported shape: a `function*` expression bound to a name. */
const make = function* (): Generator<number> {
  yield 1;
  yield 2;
};

export function viaExpression(n: number): number {
  let total = 0;
  for (const value of make()) {
    total += value;
  }
  return total + n;
}

/**
 * **One generator closure, and that is the JVM's limit rather than a choice.**
 *
 * A generator's `#call` returns its own frame class, and every closure's `#call`
 * overrides one dispatch slot -- `Hierarchy::closure_slot`, one for the whole
 * program. Two generator closures are two frame classes on that slot, which the JVM
 * refuses by name and is right to: `NTS4009 Closure1.call is
 * ()Lnts/gen/Closure1$call$frame; where the method it overrides is
 * ()Lnts/gen/Closure0$call$frame; -- the JVM would treat these as two unrelated
 * methods`. C and LLVM cannot see it, because a frame is a pointer to both of them.
 *
 * So the other shapes are their own programs rather than arms here:
 * `a-generator-function-expression-invoked-where-it-is-written`, and
 * `a-private-generator-method-handed-out-as-a-value`, which is the regression guard.
 * Putting them together would make this example decline on the JVM, and a fourth
 * standing decline is that lane's decision rather than a side effect of this one.
 *
 * The slot is what would have to change -- a uniform entry whose return is erased
 * would let every closure share it -- and that is the erased-call adapter's work.
 */
