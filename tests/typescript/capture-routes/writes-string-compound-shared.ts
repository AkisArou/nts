/*---
description: Sibling string closures observe inside and outside compound appends after widening.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-strings]
---*/
// Route: reader and appending writer share a string binding; node preserves each wide append and the later outside append.
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
  const read: () => string = () => { log.push("read"); return value; };
  const append: (part: string) => string = part => { log.push("append-read"); value += part; log.push("append-write", "append-result"); return value; };
  const before = read(); checkCapture(before, "a");
  const written = append(row.input); checkCapture(written, row.joined);
  const after = read(); checkCapture(after, row.joined);
  log.push("outside-read"); value += "!"; log.push("outside-write");
  const final = read(); checkCapture(final, row.final);
  log.push("state"); checkCapture(value, row.final);
  assert.compareArray(log, ["initial", "read", "append-read", "append-write", "append-result", "read", "outside-read", "outside-write", "read", "state"]);
}
