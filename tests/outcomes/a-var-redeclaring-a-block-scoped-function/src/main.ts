// An early SyntaxError nts compiles: `var f` redeclaring a function declared in the
// same block (block-level functions are lexical). node refuses to load it; nts
// builds and runs it. Found by test262's negative
// block-scope/syntax/redeclaration/var-redeclaration-attempt-after-async-function.js.
{
  async function f() {}
  var f;
}
observe("ran", "yes");
done();
