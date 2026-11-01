/*---
description: Control for loops-labelled-continue-union-binding; direct reads retain the same inputs, writes and observations.
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
  {"selected": 0, "keepSample": [true, false, false], "final": 3, "trace": ["write:iteration:0", "read:before:0", "retain:initial:0", "write:inner:0:0", "read:inner:0:0", "retain:inner:0:0", "labelled-continue:0", "write:iteration:1", "read:before:1", "retain:initial:1", "write:inner:1:0", "read:inner:1:0", "retain:inner:1:0", "write:inner:1:1", "read:inner:1:1", "retain:inner:1:1", "write:iteration:2", "read:before:2", "retain:initial:2", "write:inner:2:0", "read:inner:2:0", "retain:inner:2:0", "write:inner:2:1", "read:inner:2:1", "retain:inner:2:1", "read:late:0", "read:late:1", "read:late:2"]},
  {"selected": 1, "keepSample": [false, true, false], "final": 3, "trace": ["write:iteration:0", "read:before:0", "retain:initial:0", "write:inner:0:0", "read:inner:0:0", "retain:inner:0:0", "write:inner:0:1", "read:inner:0:1", "retain:inner:0:1", "write:iteration:1", "read:before:1", "retain:initial:1", "write:inner:1:0", "read:inner:1:0", "retain:inner:1:0", "labelled-continue:1", "write:iteration:2", "read:before:2", "retain:initial:2", "write:inner:2:0", "read:inner:2:0", "retain:inner:2:0", "write:inner:2:1", "read:inner:2:1", "retain:inner:2:1", "read:late:0", "read:late:1", "read:late:2"]},
  {"selected": -1, "keepSample": [false, false, false], "final": 3, "trace": ["write:iteration:0", "read:before:0", "retain:initial:0", "write:inner:0:0", "read:inner:0:0", "retain:inner:0:0", "write:inner:0:1", "read:inner:0:1", "retain:inner:0:1", "write:iteration:1", "read:before:1", "retain:initial:1", "write:inner:1:0", "read:inner:1:0", "retain:inner:1:0", "write:inner:1:1", "read:inner:1:1", "retain:inner:1:1", "write:iteration:2", "read:before:2", "retain:initial:2", "write:inner:2:0", "read:inner:2:0", "retain:inner:2:0", "write:inner:2:1", "read:inner:2:1", "retain:inner:2:1", "read:late:0", "read:late:1", "read:late:2"]},
];
for (const row of inputs) for (const mode of modes) {
  const log: string[] = []; const retained: LoopValue[] = [];
  const source: LoopValue[] = [true, row.value, undefined]; const kinds: string[] = ["boolean", row.kind, "undefined"];
  let turn = 0;
  collect: for (let value of source) {
    log.push("write:iteration:" + turn);
    const before = (log.push("read:before:" + turn), value); checkLoop(before, source[turn], kinds[turn]);
    retained.push(value); log.push("retain:initial:" + turn);
    for (const pass of [0, 1]) {
      value = pass === 0 ? row.value : undefined; log.push("write:inner:" + turn + ":" + pass);
      const actual = (log.push("read:inner:" + turn + ":" + pass), value); checkLoop(actual, pass === 0 ? row.value : undefined, pass === 0 ? row.kind : "undefined");
      retained[turn] = value; log.push("retain:inner:" + turn + ":" + pass);
      if (turn === mode.selected && pass === 0) { log.push("labelled-continue:" + turn); turn++; continue collect; }
    }
    turn++;
  }
  assert.sameValue(turn, mode.final); assert.sameValue(retained.length, mode.keepSample.length);
  for (let at = 0; at < mode.keepSample.length; at++) {
    const expected: LoopValue = mode.keepSample[at] ? row.value : undefined; const kind = mode.keepSample[at] ? row.kind : "undefined";
    const actual = (log.push("read:late:" + at), retained[at]); checkLoop(actual, expected, kind); checkLoop(retained[at], expected, kind);
  }
  assert.compareArray(log, mode.trace);
}
