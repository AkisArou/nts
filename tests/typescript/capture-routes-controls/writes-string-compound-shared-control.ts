/*---
description: Control for writes-string-compound-shared; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-strings]
---*/
// Control: Every captured read becomes a direct read at the same point.
const rows: { input: string; joined: string; final: string }[] = [
  { input: "", joined: "a", final: "a!" }, { input: "bc", joined: "abc", final: "abc!" },
  { input: "\u00e9\u00df", joined: "a\u00e9\u00df", final: "a\u00e9\u00df!" },
  { input: "\u0101", joined: "a\u0101", final: "a\u0101!" },
  { input: "\u4e2d", joined: "a\u4e2d", final: "a\u4e2d!" },
  { input: "\ud83d\ude00", joined: "a\ud83d\ude00", final: "a\ud83d\ude00!" },
  { input: "\ud800", joined: "a\ud800", final: "a\ud800!" }
];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const log: string[] = ["initial"]; let value: string = "a";
  log.push("read"); const before = value; checkCapture(before, "a");
  log.push("append-read"); value += row.input; log.push("append-write", "append-result"); const written = value; checkCapture(written, row.joined);
  log.push("read"); const after = value; checkCapture(after, row.joined);
  log.push("outside-read"); value += "!"; log.push("outside-write");
  log.push("read"); const final = value; checkCapture(final, row.final);
  log.push("state"); checkCapture(value, row.final);
  assert.compareArray(log, ["initial", "read", "append-read", "append-write", "append-result", "read", "outside-read", "outside-write", "read", "state"]);
}
