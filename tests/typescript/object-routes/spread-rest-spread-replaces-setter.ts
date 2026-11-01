/*---
description: "A present spread property replaces an earlier target setter with writable data without invoking it."
features: [ts-object-routes, ts-object-route-spread-rest, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-interfaces, ts-accessors, ts-optional-properties, ts-closures, ts-spread]
---*/
// An optional typed property distinguishes absence from present undefined; node retains the setter only for absence and invokes no setter when spread defines data.
type CopyValue = number | string | boolean | undefined | null | { id: number };
const first = { id: 7 }, second = { id: 7 }, replacement = { id: 99 };
const inputs: CopyValue[] = [-0, NaN, "", "tail", undefined, null, false, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
interface OptionalSource { value?: CopyValue; }
function inspect(input: CopyValue, mode: string): void {
  const log: unknown[] = []; let written: CopyValue = null, source: OptionalSource = {};
  const present = mode !== "absent";
  if (mode === "getter" || mode === "frozen-getter") source = { get value(): CopyValue { log.push("source.get", input); return input; } };
  else if (present) source = { value: input };
  if (mode === "frozen" || mode === "frozen-getter") Object.freeze(source);
  function receive(value: CopyValue): void { log.push("target.set", value); written = value; }
  const copy = { set value(value: CopyValue) { receive(value); }, ...source };
  order(copy, ["value"]); order(source, present ? ["value"] : []); same(copy.value, present ? input : undefined); same(Object.is(copy, source), false);
  copy.value = replacement; same(copy.value, present ? replacement : undefined); same(written, present ? null : replacement);
  same(Object.hasOwn(copy, "value"), true); same(Object.hasOwn(source, "value"), present); same(Object.isFrozen(copy), false);
  const expected: unknown[] = mode === "getter" || mode === "frozen-getter" ? ["source.get", input] : []; if (!present) expected.push("target.set", replacement);
  assert.compareArray(log, expected);
}
for (const input of inputs) for (const mode of ["absent", "data", "getter", "frozen", "frozen-getter"]) inspect(input, mode);
