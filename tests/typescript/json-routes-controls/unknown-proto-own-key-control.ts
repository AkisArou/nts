/*---
description: Control for unknown-proto-own-key; construct the same value from a plain object literal.
features: [ts-json-routes, ts-json-unknown, ts-unknown, ts-narrowing, ts-functions, ts-iteration, ts-objects, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined]
---*/
// Only the parsed source becomes a plain literal; text, narrowing and every observation remain the same.
function check(n: number): void {
  const text = '{"before":' + n + ',"__proto__":{"polluted":' + (n + 1) + '},"after":true}';
  const value: unknown = { before: n, ["__proto__"]: { polluted: n + 1 }, after: true };
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
