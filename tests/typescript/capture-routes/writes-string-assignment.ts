/*---
description: A captured string binding preserves assignments and restoration across representation changes.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-strings]
---*/
// Route: string binding captured before assignment and restoration; node reads the current binding at every stage.
const inputs: string[] = ["", "ascii", "\u00e9\u00df\u00ff", "\u0101", "\u4e2d", "\ud83d\ude00", "\ud800", "a\u4e2db"];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; let value: string = "a";
  const read: () => string = () => { log.push("read"); return value; };
  const before = read(); checkCapture(before, "a");
  value = input; log.push("write");
  const after = read(); checkCapture(after, input);
  value = "a"; log.push("restore");
  const restored = read(); checkCapture(restored, "a");
  log.push("state"); checkCapture(value, "a");
  assert.compareArray(log, ["initial", "read", "write", "read", "restore", "read", "state"]);
}
