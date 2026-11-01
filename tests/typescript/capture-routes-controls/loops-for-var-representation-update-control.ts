/*---
description: Control for loops-for-var-representation-update; direct reads retain the same inputs, writes and observations.
features: [ts-capture-route-loops, ts-closures, ts-function-types, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-objects]
---*/
// Control: remove readers; directly read live bindings and retained iteration slots at the same points.
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
  const wanted: LoopValue[] = [row.value, undefined, row.value]; const kinds: string[] = [row.kind, "undefined", row.kind];
  let turn = 0; let lastUpdate: LoopValue = undefined;
  for (var value: LoopValue = 1; turn < 3; turn++, lastUpdate = value = "update", log.push("write:update")) {
    log.push("write:iteration:" + turn);
    const before = (log.push("read:before:" + turn), value); checkLoop(before, turn === 0 ? 1 : "update", turn === 0 ? "number" : "string");
    value = wanted[turn]; log.push("write:body:" + turn);
    const after = (log.push("read:after:" + turn), value); checkLoop(after, wanted[turn], kinds[turn]);
    retained.push(value); log.push("retain:" + turn);
  }
  for (let at = 0; at < 3; at++) {
    const actual = (log.push("read:late:" + at), value); checkLoop(actual, "update", "string");
    checkLoop(retained[at], wanted[at], kinds[at]);
  }
  checkLoop(lastUpdate, "update", "string"); assert.sameValue(turn, 3); assert.sameValue(retained.length, 3);
  value = row.value; log.push("write:outside");
  for (let at = 0; at < 3; at++) { const actual = (log.push("read:again:" + at), value); checkLoop(actual, row.value, row.kind); }
  checkLoop(value, row.value, row.kind);
  assert.compareArray(log, ["write:iteration:0", "read:before:0", "write:body:0", "read:after:0", "retain:0", "write:update", "write:iteration:1", "read:before:1", "write:body:1", "read:after:1", "retain:1", "write:update", "write:iteration:2", "read:before:2", "write:body:2", "read:after:2", "retain:2", "write:update", "read:late:0", "read:late:1", "read:late:2", "write:outside", "read:again:0", "read:again:1", "read:again:2"]);
}
