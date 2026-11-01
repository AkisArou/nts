/*---
description: Control for unknown-integer-key-order; construct the same value from a plain object literal.
features: [ts-json-routes, ts-json-unknown, ts-unknown, ts-narrowing, ts-functions, ts-iteration, ts-objects, ts-typeof-operator, ts-index-signatures, ts-record, ts-type-guards, ts-arrays, ts-numbers, ts-strings]
---*/
// Only the parsed source becomes a plain literal; text, narrowing and every observation remain the same.
function jsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function check(n: number): void {
  const text = '{"10":' + n + ',"2":' + (n + 1) + ',"01":' + (n + 2) + ',"4294967295":' + (n + 3) + ',"4294967294":' + (n + 4) + ',"tail":' + (n + 5) + '}';
  const value: unknown = { "10": n, "2": n + 1, "01": n + 2, "4294967295": n + 3, "4294967294": n + 4, tail: n + 5 };
  if (!jsonRecord(value)) throw new Error("record");
  assert.sameValue(typeof value, "object");
  const keys: string[] = ["2", "10", "4294967294", "01", "4294967295", "tail"];
  const expected: number[] = [n + 1, n, n + 4, n + 2, n + 3, n + 5];
  assert.compareArray(Object.keys(value), keys);
  for (let i = 0; i < keys.length; i++) {
    assert.sameValue(keys[i] in value, true);
    assert.sameValue(typeof value[keys[i]], "number");
    assert.sameValue(Object.is(value[keys[i]], expected[i]), true);
  }
}
for (const n of [-2, 0, 17]) check(n);
