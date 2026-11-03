/*---
description: A shorter interface field hides an optional numeric parameter while the callee retains each actual argument and evaluation order.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-unsound-arity, ts-interfaces, ts-function-types, ts-functions, ts-optional-parameters, ts-unions, ts-unknown, ts-arrays, ts-tuples, ts-iteration, ts-typeof-operator]
---*/
// The shorter invoke field carries read to a wider caller; node returns each actual hidden payload, including undefined, without changing its kind.
const log: string[] = [];
function read(first: number, hidden?: number): number | undefined {
  log.push("body");
  assert.sameValue(first, 4); assert.sameValue(typeof first, "number");
  return hidden;
}
interface Slot { invoke: (first: number) => number | undefined; }
const slot: Slot = { invoke: read };
const invoke: (first: number, hidden?: unknown) => number | undefined = slot.invoke;
function first(): number { log.push("first"); return 4; }
function second(value: unknown): unknown { log.push("second"); return value; }
const token = { id: 1 };
const entries: [unknown, string][] = [[undefined, "undefined"], [null, "object"], [false, "boolean"],
  [-0, "number"], [NaN, "number"], [0n, "bigint"], ["7", "string"], [token, "object"]];
for (const [payload, kind] of entries) {
  log.length = 0;
  const result = invoke(first(), second(payload));
  assert.sameValue(result, payload); assert.sameValue(typeof result, kind);
  assert.compareArray(log, ["first", "second", "body"]);
}
log.length = 0;
const missing = invoke(first());
assert.sameValue(missing, undefined); assert.sameValue(typeof missing, "undefined");
assert.compareArray(log, ["first", "body"]);
