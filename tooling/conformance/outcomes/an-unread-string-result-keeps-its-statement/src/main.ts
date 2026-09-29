// The control for an-unread-eval-result-drops-its-statement, differing in the
// callee: `String` rather than `eval`, so the unread declaration has a
// representation. `source()` runs once. Agrees with node.
let calls = 0;
function source(): string {
  calls = calls + 1;
  return "1";
}
var result = String(source());
observe("calls", String(calls));
done();
