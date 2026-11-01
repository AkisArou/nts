/*---
description: Control for loops-continue-union-binding; direct reads retain the same inputs, writes and observations.
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
const modes = [
  {"selected": 0, "keepSample": [true, false, false], "final": 3, "trace": ["write:iteration:0", "read:before:0", "write:body:0", "read:after:0", "retain:0", "continue:0", "write:iteration:1", "read:before:1", "write:body:1", "read:after:1", "write:tail:1", "read:tail:1", "retain:1", "write:iteration:2", "read:before:2", "write:body:2", "read:after:2", "write:tail:2", "read:tail:2", "retain:2", "read:late:0", "read:late:1", "read:late:2"]},
  {"selected": 1, "keepSample": [false, true, false], "final": 3, "trace": ["write:iteration:0", "read:before:0", "write:body:0", "read:after:0", "write:tail:0", "read:tail:0", "retain:0", "write:iteration:1", "read:before:1", "write:body:1", "read:after:1", "retain:1", "continue:1", "write:iteration:2", "read:before:2", "write:body:2", "read:after:2", "write:tail:2", "read:tail:2", "retain:2", "read:late:0", "read:late:1", "read:late:2"]},
  {"selected": -1, "keepSample": [false, false, false], "final": 3, "trace": ["write:iteration:0", "read:before:0", "write:body:0", "read:after:0", "write:tail:0", "read:tail:0", "retain:0", "write:iteration:1", "read:before:1", "write:body:1", "read:after:1", "write:tail:1", "read:tail:1", "retain:1", "write:iteration:2", "read:before:2", "write:body:2", "read:after:2", "write:tail:2", "read:tail:2", "retain:2", "read:late:0", "read:late:1", "read:late:2"]},
];
for (const row of inputs) for (const mode of modes) {
  const log: string[] = []; const retained: LoopValue[] = [];
  const source: LoopValue[] = [true, row.value, undefined]; const kinds: string[] = ["boolean", row.kind, "undefined"];
  let turn = 0;
  for (let value of source) {
    log.push("write:iteration:" + turn);
    const before = (log.push("read:before:" + turn), value); checkLoop(before, source[turn], kinds[turn]);
    value = row.value; log.push("write:body:" + turn);
    const after = (log.push("read:after:" + turn), value); checkLoop(after, row.value, row.kind);
    if (turn === mode.selected) { retained.push(value); log.push("retain:" + turn); log.push("continue:" + turn); turn++; continue; }
    value = undefined; log.push("write:tail:" + turn);
    const tail = (log.push("read:tail:" + turn), value); checkLoop(tail, undefined, "undefined");
    retained.push(value); log.push("retain:" + turn);
    turn++;
  }
  assert.sameValue(turn, mode.final); assert.sameValue(retained.length, mode.keepSample.length);
  for (let at = 0; at < mode.keepSample.length; at++) {
    const expected: LoopValue = mode.keepSample[at] ? row.value : undefined; const kind = mode.keepSample[at] ? row.kind : "undefined";
    const actual = (log.push("read:late:" + at), retained[at]); checkLoop(actual, expected, kind); checkLoop(retained[at], expected, kind);
  }
  assert.compareArray(log, mode.trace);
}
