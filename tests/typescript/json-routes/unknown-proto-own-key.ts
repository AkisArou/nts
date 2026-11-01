/*---
description: An unknown JSON record retains __proto__ as an own data key without exposing its nested field on the outer object.
features: [ts-json-routes, ts-json-unknown, ts-unknown, ts-narrowing, ts-functions, ts-iteration, ts-objects, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined]
---*/
// Parse __proto__ to unknown and narrow both records; node keeps an ordinary own key and leaves polluted off the outer object.
function check(n: number): void {
  const text = '{"before":' + n + ',"__proto__":{"polluted":' + (n + 1) + '},"after":true}';
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || !("before" in value) || !("__proto__" in value) || !("after" in value)) throw new Error("record");
  assert.sameValue(typeof value, "object"); assert.compareArray(Object.keys(value), ["before", "__proto__", "after"]);
  assert.sameValue(Object.hasOwn(value, "__proto__"), true); assert.sameValue("polluted" in value, false);
  assert.sameValue(typeof value.before, "number"); assert.sameValue(Object.is(value.before, n), true);
  assert.sameValue(typeof value.after, "boolean"); assert.sameValue(Object.is(value.after, true), true);
  const proto: unknown = value["__proto__"];
  if (typeof proto !== "object" || proto === null || !("polluted" in proto)) throw new Error("nested record");
  assert.sameValue(typeof proto, "object"); assert.compareArray(Object.keys(proto), ["polluted"]);
  assert.sameValue(typeof proto.polluted, "number"); assert.sameValue(Object.is(proto.polluted, n + 1), true);
}
for (const n of [-3, 0, 255]) check(n);
