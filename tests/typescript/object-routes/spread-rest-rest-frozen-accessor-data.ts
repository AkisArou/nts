/*---
description: "Rest creates writable data from frozen fields and accessors without retaining source setters."
features: [ts-object-routes, ts-object-route-spread-rest, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-interfaces, ts-accessors, ts-optional-properties, ts-closures, ts-destructuring, ts-spread]
---*/
// A RestSource may have an accessor, frozen integrity and a present-undefined extra; node copies each value once and lets the copy change without invoking the source setter.
type CopyValue = number | string | boolean | undefined | null | { id: number };
const first = { id: 7 }, second = { id: 7 }, replacement = { id: 99 };
const inputs: CopyValue[] = [-0, NaN, "", "tail", undefined, null, false, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
interface RestSource { drop: CopyValue; keep: CopyValue; extra?: CopyValue; }
function inspect(input: CopyValue, accessor: boolean, frozen: boolean, present: boolean): void {
  const log: unknown[] = []; let state = input;
  const source: RestSource = accessor ? { drop: first, get keep(): CopyValue { log.push("get.keep", state); return state; }, set keep(value: CopyValue) { log.push("set.keep", value); state = value; } } : { drop: first, keep: input };
  if (present) source.extra = undefined; if (frozen) Object.freeze(source);
  const { drop: chosen, ...copy } = source;
  const keys = present ? ["keep", "extra"] : ["keep"]; order(copy, keys); order(source, present ? ["drop", "keep", "extra"] : ["drop", "keep"]);
  same(chosen, first); same(copy.keep, input); same(copy.extra, undefined); same(Object.hasOwn(copy, "extra"), present); same(Object.is(copy, source), false);
  copy.keep = replacement; copy.extra = input; same(copy.keep, replacement); same(copy.extra, input); order(copy, ["keep", "extra"]);
  same(state, input); same(Object.hasOwn(source, "extra"), present); same(Object.isFrozen(source), frozen); same(Object.isFrozen(copy), false);
  assert.compareArray(log, accessor ? ["get.keep", input] : []);
}
for (const input of inputs) for (const accessor of [false, true]) for (const frozen of [false, true]) for (const present of [false, true]) inspect(input, accessor, frozen, present);
