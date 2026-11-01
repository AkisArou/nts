/*---
description: "Control for switch-string-middle-default; A string literal union selects fallthrough across a middle default while later matches skip that default."
features: [ts-control-flow-routes, ts-control-flow-route-switch, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types]
---*/
// A declared string mode controls a SwitchValue result; node logs head/default/tail or stop, then returns the original payload except on stop. The control selects arms with explicit ifs and fallthrough state.
type SwitchValue = number | string | undefined | null | { id: number };
const marker = { id: 7 }, other = { id: 8 };
const inputs: SwitchValue[] = [-0, NaN, "", "tail", undefined, null, marker, other];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type SwitchMode = "head" | "" | "tail" | "stop";
const modes: SwitchMode[] = ["head", "", "tail", "stop"];
const arms: string[][] = [["head", "default", "tail"], ["default", "tail"], ["tail"], ["stop"]];
function route(mode: SwitchMode, input: SwitchValue, log: unknown[]): SwitchValue {
  let result: SwitchValue = other;
  let falling = false;
  if (mode === "head") { log.push("head", input); result = input; falling = true; }
  if (falling || (mode !== "tail" && mode !== "stop")) { log.push("default", input); result = input; falling = true; }
  if (falling || mode === "tail") { log.push("tail", input); result = input; }
  else if (mode === "stop") { log.push("stop", input); result = marker; }
  log.push("exit", result); return result;
}
for (const input of inputs) for (let at = 0; at < modes.length; at++) {
  const log: unknown[] = [], expected: unknown[] = [], result = route(modes[at], input, log);
  const answer = at === 3 ? marker : input;
  for (const arm of arms[at]) expected.push(arm, input);
  expected.push("exit", answer); same(result, answer); assert.compareArray(log, expected);
}
