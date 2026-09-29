// Reading a `let` before its declaration runs throws a ReferenceError (the
// temporal dead zone); nts reads on. Found by test262's statements/let/
// global-use-before-initialization-in-prior-statement.js (and const's twin),
// negative tests whose `x; let x;` completes. The control declares with
// `var`, which is `undefined` there and throws nothing, and differs in the
// keyword only.
// **Root, diagnosed 2026-09-29:** a definite-assignment analysis -- does an
// assignment dominate this read. The checker settles `x` to its assigned type
// at every reference, and a global's initial storage is the settled
// representation's zero, where the language says `undefined` (or a TDZ
// throw). Shared with a-var-read-before-its-declaration and a-let-read-
// before-its-declaration. an-undefined-incremented was thought to be a third
// and was not: converting in `step` closed it (1bf78c21d).
let caught = "none";
try {
  // @ts-expect-error -- JavaScript: a let in its temporal dead zone throws
  x;
} catch (error) {
  caught = (error as Error).name;
}
let x = 1;
let caughtVar = "none";
try {
  // @ts-expect-error -- as above, though JavaScript does not throw
  y;
} catch (error) {
  caughtVar = (error as Error).name;
}
var y = 1;
observe("let", caught);
observe("var", caughtVar);
done();
