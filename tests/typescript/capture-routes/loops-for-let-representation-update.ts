/*---
description: Classic for let readers observe body writes and the correct update-clause binding across representations.
features: [ts-capture-route-loops, ts-closures, ts-function-types, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-objects]
---*/
// Route: a typed for let binding is captured before body and update writes; node keeps separate let bodies or one shared var.
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
  const wanted: LoopValue[] = [row.value, undefined, row.value]; const kinds: string[] = [row.kind, "undefined", row.kind];
  let turn = 0; let lastUpdate: LoopValue = undefined;
  for (let value: LoopValue = 1; turn < 3; turn++, lastUpdate = value = "update", log.push("write:update")) {
    log.push("write:iteration:" + turn);
    const read: (phase: string) => LoopValue = phase => { log.push("read:" + phase); return value; }; readers.push(read);
    const before = read("before:" + turn); checkLoop(before, turn === 0 ? 1 : "update", turn === 0 ? "number" : "string");
    value = wanted[turn]; log.push("write:body:" + turn);
    const after = read("after:" + turn); checkLoop(after, wanted[turn], kinds[turn]);
    retained.push(value); log.push("retain:" + turn);
  }
  for (let at = 0; at < 3; at++) {
    const actual = readers[at]("late:" + at); checkLoop(actual, wanted[at], kinds[at]);
    checkLoop(retained[at], wanted[at], kinds[at]);
  }
  checkLoop(lastUpdate, "update", "string"); assert.sameValue(turn, 3); assert.sameValue(retained.length, 3);
  assert.compareArray(log, ["write:iteration:0", "read:before:0", "write:body:0", "read:after:0", "retain:0", "write:update", "write:iteration:1", "read:before:1", "write:body:1", "read:after:1", "retain:1", "write:update", "write:iteration:2", "read:before:2", "write:body:2", "read:after:2", "retain:2", "write:update", "read:late:0", "read:late:1", "read:late:2"]);
}
