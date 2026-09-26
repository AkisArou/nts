// `$DONOTEVALUATE()`, from test262's `harness/sta.js`, spliced in by `project.mjs`
// only for a test that names it -- which is every planned negative test (4,122
// of 4,145 under `test/language`), and no positive one. The real one throws a
// string; this throws a `Test262Error`, because a thrown non-object prints as
// nothing nts can name, and a negative test that got this far was accepted by
// the parser -- which is already its verdict (`fail`), whatever it then throws.
function $DONOTEVALUATE(): void {
  throw new Test262Error("Test262: This statement should not be evaluated.");
}
