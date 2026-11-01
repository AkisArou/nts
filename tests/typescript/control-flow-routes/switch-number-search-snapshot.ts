/*---
description: "Case expressions mutate a numeric literal field after its discriminant has been captured and a middle default waits for later matches."
features: [ts-control-flow-routes, ts-control-flow-route-switch, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-closures]
---*/
// A -1|0|1|2 field supplies the discriminant; logged case probes overwrite it with 2, but node selects from the original value and returns the payload.
type SwitchValue = number | string | undefined | null | { id: number };
const marker = { id: 7 }, other = { id: 8 };
const inputs: SwitchValue[] = [-0, NaN, "", "tail", undefined, null, marker, other];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type SwitchCode = -1 | 0 | 1 | 2;
const codes: SwitchCode[] = [-1, -0, 0, 1, 2];
const probes: number[][] = [[0, 1, 2], [0], [0], [0, 1], [0, 1, 2]];
const arms: string[][] = [["default", "one"], ["zero", "default", "one"], ["zero", "default", "one"], ["one"], ["two"]];
function inspect(code: SwitchCode, input: SwitchValue, at: number): void {
  const box: { code: SwitchCode } = { code }, log: unknown[] = []; let result: SwitchValue = other;
  function candidate(value: SwitchCode): SwitchCode { log.push("probe", value, box.code); box.code = 2; return value; }
  switch (box.code) {
    case candidate(0): log.push("zero", input); result = input;
    default: log.push("default", input); result = input;
    case candidate(1): log.push("one", input); result = input; break;
    case candidate(2): log.push("two", input); result = marker; break;
  }
  log.push("exit", result, box.code);
  const expected: unknown[] = [];
  for (let i = 0; i < probes[at].length; i++) expected.push("probe", probes[at][i], i === 0 ? code : 2);
  for (const arm of arms[at]) expected.push(arm, input);
  const answer = at === 4 ? marker : input; expected.push("exit", answer, 2);
  same(result, answer); same(box.code, 2); assert.compareArray(log, expected);
}
for (const input of inputs) for (let at = 0; at < codes.length; at++) inspect(codes[at], input, at);
