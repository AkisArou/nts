// Reading a `let` before its declaration runs throws a ReferenceError (the
// temporal dead zone); nts reads on. Found by test262's statements/let/
// global-use-before-initialization-in-prior-statement.js (and const's twin),
// negative tests whose `x; let x;` completes. The control declares with
// `var`, which is `undefined` there and throws nothing, and differs in the
// keyword only.
// **Root: the same question as `a-var-read-before-its-declaration` and a
// different answer.** Both ask whether an assignment dominates this read. Where
// they part is what the language wants when it does not:
//
//   var    `undefined`, which is a REPRESENTATION question -- the binding needs
//          somewhere to hold an absence. That sibling's header carries the
//          measured mechanism (`Global`'s `initial` and `deferred`, and why
//          deferring alone is not enough).
//   let    a **ReferenceError**, which is not a representation question at all.
//          No value satisfies it. It needs a *guard*: a per-binding flag, tested
//          at every read the initializer does not dominate, throwing.
//
// **So widening is wrong here**, and the obvious inference from that record to
// this one is false. Two fixtures, one analysis, two mechanisms.
//
// What is recorded below is that nts throws nothing: it reads the global's initial
// storage and carries on, so `caught` stays `none` where node has `ReferenceError`.
// The `var` control beside it answers `none` in both, which is correct -- and is
// what makes this fixture about the *throw* rather than about the value.
//
// `an-undefined-incremented` was thought to be a third instance of the shared
// root and was not: converting in `step` closed it (1bf78c21d).
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
