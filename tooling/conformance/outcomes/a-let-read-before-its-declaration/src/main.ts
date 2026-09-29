// Reading a `let` before its declaration runs throws a ReferenceError (the
// temporal dead zone); nts reads on. Found by test262's statements/let/
// global-use-before-initialization-in-prior-statement.js (and const's twin),
// negative tests whose `x; let x;` completes. The control declares with
// `var`, which is `undefined` there and throws nothing, and differs in the
// keyword only.
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
