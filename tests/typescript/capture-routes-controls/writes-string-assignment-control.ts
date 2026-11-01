/*---
description: Control for writes-string-assignment; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-strings]
---*/
// Control: Every captured read becomes a direct read at the same point.
const inputs: string[] = ["", "ascii", "\u00e9\u00df\u00ff", "\u0101", "\u4e2d", "\ud83d\ude00", "\ud800", "a\u4e2db"];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; let value: string = "a";
  log.push("read"); const before = value; checkCapture(before, "a");
  value = input; log.push("write");
  log.push("read"); const after = value; checkCapture(after, input);
  value = "a"; log.push("restore");
  log.push("read"); const restored = value; checkCapture(restored, "a");
  log.push("state"); checkCapture(value, "a");
  assert.compareArray(log, ["initial", "read", "write", "read", "restore", "read", "state"]);
}
