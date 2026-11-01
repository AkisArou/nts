/*---
description: "Freezing a typed object rejects data writes through its mutable alias while its existing setter remains callable."
features: [ts-object-routes, ts-object-route-statics, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-interfaces, ts-optional-properties, ts-accessors, ts-closures, ts-readonly, ts-errors, ts-arrow-functions]
---*/
// FrozenAccess carries a data field, an accessor and optional own undefined; node reports frozen without reading getters, rejects even a same-value data write and lets the accessor update external state.
type StaticValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: StaticValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface FrozenAccess { "2": StaticValue; value: StaticValue; maybe?: StaticValue }
function inspect(input: StaticValue, present: boolean): void {
  const log: unknown[] = [], state: { value: StaticValue } = { value: input };
  const source: FrozenAccess = { "2": input,
    get value(): StaticValue { log.push("get", state.value); return state.value; },
    set value(value: StaticValue) { log.push("set", value); state.value = value; }
  };
  if (present) source.maybe = undefined;
  const alias: FrozenAccess = source, before = Object.isFrozen(alias), frozen = Object.freeze(source), after = Object.isFrozen(alias);
  log.push("before", before, "after", after); same(frozen, source); same(before, false); same(after, true);
  alias.value = replacement;
  assert.throws(TypeError, () => { log.push("write", input, marker); alias["2"] = marker; log.push("wrote", alias["2"]); });
  const actual = frozen.value, keys = present ? ["2", "value", "maybe"] : ["2", "value"], walked: string[] = [];
  for (const key in frozen) walked.push(key);
  assert.compareArray(Object.keys(frozen), keys); assert.compareArray(walked, keys); same(Object.hasOwn(frozen, "maybe"), present);
  same(actual, replacement); same(state.value, replacement); same(frozen["2"], input); same(frozen.maybe, undefined);
  assert.compareArray(log, ["before", false, "after", true, "set", replacement, "write", input, marker, "get", replacement]);
}
for (const input of inputs) for (const present of [false, true]) inspect(input, present);
