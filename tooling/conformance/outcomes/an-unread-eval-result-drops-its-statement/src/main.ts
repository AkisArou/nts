// A wrong answer, silent: `var result = eval(source())` whose `result` nothing
// reads is dropped -- statement, call and argument -- with no refusal, so
// `source()` never runs and `calls` stays 0. `eval` returns `any`, which had
// no representation, and the unread declaration left nothing to refuse at.
// The control, an-unread-string-result-keeps-its-statement, differs in the
// callee (`String`) and agrees. Found by the compiler lane's slice 0 (`any`
// as Erased), under which nine test262 statementList/eval-block-with-
// statment-* files went from pass to refused: they had passed because the
// eval they test was never compiled (2026-09-30).
let calls = 0;
function source(): string {
  calls = calls + 1;
  return "1";
}
var result = eval(source());
observe("calls", String(calls));
done();
