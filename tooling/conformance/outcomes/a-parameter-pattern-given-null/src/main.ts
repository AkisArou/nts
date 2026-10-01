// Destructuring `null` -- a parameter pattern given null, `{}` or `{ a }` --
// must throw a TypeError (RequireObjectCoercible); nts binds nothing and goes
// on. Found by test262's destructuring/binding/initialization-requires-
// object-coercible-{null,undefined}.js and its many dstr siblings: most of
// the 147 TypeError cases in the "assert.throws: nothing was thrown" family.
// The control gives the same pattern an object and differs in the argument.
function empty({}: object): void {}
function named({ a }: { a?: number }): number | undefined { return a; }
let emptyNull = "none";
let namedNull = "none";
let namedObject = "none";
try {
  // @ts-expect-error -- JavaScript: null reaches the pattern
  empty(null);
} catch (e) {
  emptyNull = e instanceof TypeError ? "TypeError" : "another error";
}
try {
  // @ts-expect-error -- as above
  named(null);
} catch (e) {
  namedNull = e instanceof TypeError ? "TypeError" : "another error";
}
try {
  named({ a: 1 });
} catch (e) {
  namedObject = "threw";
}
observe("empty pattern, null", emptyNull);
observe("named pattern, null", namedNull);
observe("named pattern, an object", namedObject);
done();
