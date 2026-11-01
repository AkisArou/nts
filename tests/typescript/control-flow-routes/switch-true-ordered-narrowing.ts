/*---
description: "Switch true narrows after ordered logged guards and skips every later guard once a member matches."
features: [ts-control-flow-routes, ts-control-flow-route-switch, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-narrowing]
---*/
// A primitive/object union reaches logged typeof and absence cases; node performs the member-specific read, returns it and never evaluates later guards.
type SwitchValue = number | string | undefined | null | { id: number };
const marker = { id: 7 }, other = { id: 8 };
const inputs: SwitchValue[] = [-0, NaN, "", "tail", undefined, null, marker, other];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function route(value: SwitchValue, log: unknown[]): unknown {
  switch (true) {
    case (log.push("test.number", value), typeof value === "number"): log.push("number", value); return value.toFixed(0);
    case (log.push("test.string", value), typeof value === "string"): log.push("string", value); return value.length;
    case (log.push("test.null", value), value === null): log.push("null", value); return value;
    case (log.push("test.undefined", value), value === undefined): log.push("undefined", value); return value;
    default: log.push("object", value); return value.id;
  }
}
const answers: unknown[] = ["0", "NaN", 0, 4, undefined, null, 7, 8];
const kinds = ["number", "number", "string", "string", "undefined", "null", "object", "object"];
const counts = [1, 1, 2, 2, 4, 3, 4, 4], tests = ["test.number", "test.string", "test.null", "test.undefined"];
for (let at = 0; at < inputs.length; at++) {
  const input = inputs[at], log: unknown[] = [], expected: unknown[] = [], result = route(input, log);
  for (let i = 0; i < counts[at]; i++) expected.push(tests[i], input);
  expected.push(kinds[at], input); log.push("caller", result); expected.push("caller", answers[at]);
  same(result, answers[at]); assert.compareArray(log, expected);
}
