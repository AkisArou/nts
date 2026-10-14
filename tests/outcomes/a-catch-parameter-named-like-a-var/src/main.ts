// **FIXED by `7ba421b8f` and kept as a guard.** A `var` inside a `catch` of the
// same plain name now writes the catch parameter (Annex B.3.5), and the hoisted
// `var` keeps "prior to throw"; the record is `agrees`.
//
// Annex B: `var foo = ...` inside `catch (foo)` assigns the catch
// parameter, not the var -- the outer foo keeps "prior to throw". nts
// assigns the var. Found by test262's annexB/language/statements/try/
// catch-redeclared-var-statement.js and its three siblings. The control
// names the catch parameter differently and differs in that only.
foo = "prior to throw";
try {
  throw new Error();
} catch (foo) {
  var foo = "initializer in catch";
}
bar = "prior to throw";
try {
  throw new Error();
} catch (other) {
  var bar = "initializer in catch";
}
observe("shadowed", String(foo));
observe("distinct", String(bar));
done();
