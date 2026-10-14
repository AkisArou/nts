// expect: NTS1001 `eval`, a builtin this compiler does not provide
//
// `var result = eval(source())` with `result` never read. Until 093733f2d the
// statement was dropped whole -- no refusal, and `source()` never ran -- and
// this was an outcomes record of that wrong answer. `eval` returns `any`,
// which had no representation; as an Erased value the call is lowered and
// refused by name, and this blocker holds that. Found by test262's nine
// statementList/eval-block-with-statment-* files, which had passed because the
// eval they test was never compiled. The control, outcomes/
// an-unread-string-result-keeps-its-statement, writes `String` for `eval`.
let calls = 0;
function source(): string {
  calls = calls + 1;
  return "1";
}
var result = eval(source());
if (calls !== 1) throw new Error("source() did not run");
