// Destructuring `null` must throw a TypeError (RequireObjectCoercible, step 1
// of BindingInitialization), and an empty pattern `{}` on an erased parameter
// -- the shape test262 writes, an untyped JavaScript parameter -- binds
// nothing and goes on. Found by test262's destructuring/binding/
// initialization-requires-object-coercible-{null,undefined}.js and the
// TypeError cases of the "assert.throws: nothing was thrown" family. The
// control gives the same function an object and differs in the argument.
//
// Rewritten 2026-10-02: it first passed `null` through `@ts-expect-error`
// into a parameter typed `{ a?: number }`, input the type system excludes --
// a census counts a construct, not its spelling, and that was not test262's.
// A named pattern `{ a }` on an erased parameter already refuses ("an erased
// value where a concrete representation is wanted"), so only the empty one is
// silent.
// Re-recorded 2026-10-02 as a **guard**: `1005fe5b1` made this throw, so the record now holds the
// right answer and a regression would move it back. The arms also live in
// `examples/a-destructuring-of-null-or-undefined`, which runs them on five backends; this stays
// because the harness's `observe`/`done` form is what the census population looks like, and a
// guard here fails on a wrong *category* where the example fails on a wrong *answer*.
function empty({}: any): void {}
function attempt(value: unknown): string {
  try {
    empty(value);
  } catch (e) {
    return e instanceof TypeError ? "TypeError" : "another error";
  }
  return "none";
}
observe("empty pattern, null", attempt(null));
observe("empty pattern, an object", attempt({}));
done();
