/*---
description: "A string literal union selects fallthrough across a middle default while later matches skip that default."
features: [ts-control-flow-routes, ts-control-flow-route-switch, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types]
---*/
// A declared string mode controls a SwitchValue result; node logs head/default/tail or stop, then returns the original payload except on stop.
type SwitchValue = number | string | undefined | null | { id: number };
const marker = { id: 7 }, other = { id: 8 };
const inputs: SwitchValue[] = [-0, NaN, "", "tail", undefined, null, marker, other];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type SwitchMode = "head" | "" | "tail" | "stop";
const modes: SwitchMode[] = ["head", "", "tail", "stop"];
const arms: string[][] = [["head", "default", "tail"], ["default", "tail"], ["tail"], ["stop"]];
function route(mode: SwitchMode, input: SwitchValue, log: unknown[]): SwitchValue {
  let result: SwitchValue = other;
  switch (mode) {
    case "head": log.push("head", input); result = input;
    default: log.push("default", input); result = input;
    case "tail": log.push("tail", input); result = input; break;
    case "stop": log.push("stop", input); result = marker; break;
  }
  log.push("exit", result); return result;
}
for (const input of inputs) for (let at = 0; at < modes.length; at++) {
  const log: unknown[] = [], expected: unknown[] = [], result = route(modes[at], input, log);
  const answer = at === 3 ? marker : input;
  for (const arm of arms[at]) expected.push(arm, input);
  expected.push("exit", answer); same(result, answer); assert.compareArray(log, expected);
}
