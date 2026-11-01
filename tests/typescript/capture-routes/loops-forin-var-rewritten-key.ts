/*---
description: For-in var readers retain rewritten typed key strings after enumeration.
features: [ts-capture-route-loops, ts-closures, ts-function-types, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects]
---*/
// Route: a for-in var string key is captured then extended; node preserves separate let keys or the shared var.
const inputs: { suffix: string; wanted: string[]; after: string }[] = [
  { suffix: "", wanted: ["a", "\u4e2d"], after: "done:" },
  { suffix: "a", wanted: ["aa", "\u4e2da"], after: "done:a" },
  { suffix: "\u00e9", wanted: ["a\u00e9", "\u4e2d\u00e9"], after: "done:\u00e9" },
  { suffix: "\u0101", wanted: ["a\u0101", "\u4e2d\u0101"], after: "done:\u0101" },
  { suffix: "\u4e2d", wanted: ["a\u4e2d", "\u4e2d\u4e2d"], after: "done:\u4e2d" },
  { suffix: "\ud83d\ude00", wanted: ["a\ud83d\ude00", "\u4e2d\ud83d\ude00"], after: "done:\ud83d\ude00" },
  { suffix: "\ud800", wanted: ["a\ud800", "\u4e2d\ud800"], after: "done:\ud800" },
  { suffix: "\udfff", wanted: ["a\udfff", "\u4e2d\udfff"], after: "done:\udfff" },
];
function checkLoop(actual: string, expected: string): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "string"); }
for (const row of inputs) {
  const source: { [key: string]: number } = { a: 1, "\u4e2d": 2 }; const original: string[] = ["a", "\u4e2d"];
  const log: string[] = []; const retained: string[] = []; const readers: ((phase: string) => string)[] = [];
  let turn = 0; var key: string = "";
  for (var key in source) {
    log.push("write:iteration:" + turn);
    const read: (phase: string) => string = phase => { log.push("read:" + phase); return key; }; readers.push(read);
    const before = read("before:" + turn); checkLoop(before, original[turn]);
    key += row.suffix; log.push("write:body:" + turn);
    const after = read("after:" + turn); checkLoop(after, row.wanted[turn]);
    retained.push(key); log.push("retain:" + turn); turn++;
  }
  for (let at = 0; at < 2; at++) {
    const actual = readers[at]("late:" + at); checkLoop(actual, row.wanted[1]);
    checkLoop(retained[at], row.wanted[at]);
  }
  assert.sameValue(turn, 2); assert.sameValue(retained.length, 2); assert.compareArray(Object.keys(source), original);
  key = row.after; log.push("write:outside");
  for (let at = 0; at < 2; at++) { const actual = readers[at]("again:" + at); checkLoop(actual, row.after); }
  checkLoop(key, row.after);
  assert.compareArray(log, ["write:iteration:0", "read:before:0", "write:body:0", "read:after:0", "retain:0", "write:iteration:1", "read:before:1", "write:body:1", "read:after:1", "retain:1", "read:late:0", "read:late:1", "write:outside", "read:again:0", "read:again:1"]);
}
