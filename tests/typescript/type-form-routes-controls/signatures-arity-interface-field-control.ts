/*---
description: A shorter interface field hides an optional numeric parameter while the callee retains each actual argument and evaluation order. The control uses honest optional unknown parameters and unknown results.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-interfaces, ts-function-types, ts-functions, ts-optional-parameters, ts-unknown, ts-arrays, ts-tuples, ts-iteration, ts-typeof-operator]
---*/
// The shorter invoke field carries read to a wider caller; node returns each actual hidden payload, including undefined, without changing its kind. The control uses honest optional unknown parameters and unknown results.
const log: string[] = [];
function read(first: number, hidden?: unknown): unknown {
  log.push("body");
  assert.sameValue(first, 4); assert.sameValue(typeof first, "number");
  return hidden;
}
interface Slot { invoke: (first: number, hidden?: unknown) => unknown; }
const slot: Slot = { invoke: read };
const invoke: (first: number, hidden?: unknown) => unknown = slot.invoke;
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
