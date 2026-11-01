/*---
description: "Control for switch-loop-break-continue-return; Switch break reaches the loop tail while continue skips it and return exits the typed loop route."
features: [ts-control-flow-routes, ts-control-flow-route-switch, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types]
---*/
// A keep|skip|return parameter chooses exits from a switch in for; node logs iteration updates, tail visits and the exact union result. The control selects arms with explicit ifs and fallthrough state.
type SwitchValue = number | string | undefined | null | { id: number };
const marker = { id: 7 }, other = { id: 8 };
const inputs: SwitchValue[] = [-0, NaN, "", "tail", undefined, null, marker, other];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type SwitchExit = "keep" | "skip" | "return";
const modes: SwitchExit[] = ["keep", "skip", "return"];
function route(mode: SwitchExit, input: SwitchValue, log: unknown[]): SwitchValue {
  let state: SwitchValue = other;
  for (let i = 0; i < 2; log.push("update", i, state), i++) {
    log.push("enter", i, input);
    let skipTail = false;
    if (mode === "keep") { log.push("break.switch", i, input); state = input; }
    else if (mode === "skip") { log.push("continue.loop", i, input); state = input; skipTail = true; }
    else if (mode === "return") { log.push("return", i, input); return input; }
    if (!skipTail) log.push("tail", i, state);
  }
  log.push("loop.exit", state); return state;
}
for (const input of inputs) for (const mode of modes) {
  const log: unknown[] = [], expected: unknown[] = [], result = route(mode, input, log);
  if (mode === "return") expected.push("enter", 0, input, "return", 0, input);
  else {
    for (let i = 0; i < 2; i++) { expected.push("enter", i, input, mode === "keep" ? "break.switch" : "continue.loop", i, input); if (mode === "keep") expected.push("tail", i, input); expected.push("update", i, input); }
    expected.push("loop.exit", input);
  }
  same(result, input); assert.compareArray(log, expected);
}
