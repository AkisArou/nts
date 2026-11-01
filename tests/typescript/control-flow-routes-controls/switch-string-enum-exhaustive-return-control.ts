/*---
description: "Control for switch-string-enum-exhaustive-return; An exhaustive string enum switch returns from each arm before unreachable default or trailing work can run."
features: [ts-control-flow-routes, ts-control-flow-route-switch, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-enum, ts-enum-string, ts-never, ts-errors]
---*/
// A string enum parameter selects which typed payload returns; node logs only that return arm and the caller observes its identity and kind. The control selects arms with explicit ifs and fallthrough state.
type SwitchValue = number | string | undefined | null | { id: number };
const marker = { id: 7 }, other = { id: 8 };
const inputs: SwitchValue[] = [-0, NaN, "", "tail", undefined, null, marker, other];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
enum SwitchAction { Original = "", Empty = "empty", Reference = "ref" }
const actions: SwitchAction[] = [SwitchAction.Original, SwitchAction.Empty, SwitchAction.Reference];
function route(action: SwitchAction, input: SwitchValue, log: unknown[]): SwitchValue {
  if (action === SwitchAction.Original) { log.push("return.original", input); return input; }
  else if (action === SwitchAction.Empty) { log.push("return.empty", undefined); return undefined; }
  else if (action === SwitchAction.Reference) { log.push("return.reference", marker); return marker; }
  else { const impossible: never = action; log.push("default", impossible); throw new Test262Error(String(impossible)); }
  log.push("after.switch"); return other;
}
for (const input of inputs) for (let at = 0; at < actions.length; at++) {
  const log: unknown[] = [], result = route(actions[at], input, log), answers: SwitchValue[] = [input, undefined, marker];
  const events = ["return.original", "return.empty", "return.reference"];
  log.push("caller", result); same(result, answers[at]);
  assert.compareArray(log, [events[at], answers[at], "caller", answers[at]]);
}
