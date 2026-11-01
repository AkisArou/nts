/*---
description: For-of var readers retain the correct replacement when typed iteration values change representation.
features: [ts-capture-route-loops, ts-closures, ts-function-types, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-objects]
---*/
// Route: a for-of var union binding is read before and after replacement and after the loop; node retains binding identity.
type LoopValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const identity = { mark: 7 }; const arrayValue: number[] = [3];
const inputs: { value: LoopValue; kind: string }[] = [
  { value: -0, kind: "number" }, { value: NaN, kind: "number" },
  { value: 0.5, kind: "number" }, { value: 2147483648, kind: "number" },
  { value: "", kind: "string" }, { value: "\u0101", kind: "string" },
  { value: false, kind: "boolean" }, { value: true, kind: "boolean" },
  { value: undefined, kind: "undefined" }, { value: 9n, kind: "bigint" },
  { value: identity, kind: "object" }, { value: arrayValue, kind: "object" }
];
function checkLoop(actual: LoopValue, expected: LoopValue, kind: string): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, kind);
}
for (const row of inputs) {
  const log: string[] = []; const retained: LoopValue[] = [];
  const readers: ((phase: string) => LoopValue)[] = [];
  const source: LoopValue[] = [undefined, row.value, true]; const sourceKinds: string[] = ["undefined", row.kind, "boolean"];
  const wanted: LoopValue[] = [row.value, undefined, false]; const kinds: string[] = [row.kind, "undefined", "boolean"];
  let turn = 0;
  for (var value of source) {
    log.push("write:iteration:" + turn);
    const read: (phase: string) => LoopValue = phase => { log.push("read:" + phase); return value; }; readers.push(read);
    const before = read("before:" + turn); checkLoop(before, source[turn], sourceKinds[turn]);
    value = wanted[turn]; log.push("write:body:" + turn);
    const after = read("after:" + turn); checkLoop(after, wanted[turn], kinds[turn]);
    retained.push(value); log.push("retain:" + turn); turn++;
  }
  for (let at = 0; at < 3; at++) {
    const actual = readers[at]("late:" + at); checkLoop(actual, false, "boolean");
    checkLoop(retained[at], wanted[at], kinds[at]);
  }
  assert.sameValue(turn, 3); assert.sameValue(retained.length, 3);
  value = row.value; log.push("write:outside");
  for (let at = 0; at < 3; at++) { const actual = readers[at]("again:" + at); checkLoop(actual, row.value, row.kind); }
  checkLoop(value, row.value, row.kind);
  assert.compareArray(log, ["write:iteration:0", "read:before:0", "write:body:0", "read:after:0", "retain:0", "write:iteration:1", "read:before:1", "write:body:1", "read:after:1", "retain:1", "write:iteration:2", "read:before:2", "write:body:2", "read:after:2", "retain:2", "read:late:0", "read:late:1", "read:late:2", "write:outside", "read:again:0", "read:again:1", "read:again:2"]);
}
