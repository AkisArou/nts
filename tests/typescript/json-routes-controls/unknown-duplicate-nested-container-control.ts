/*---
description: Control for unknown-duplicate-nested-container; construct the same value from a plain object literal.
features: [ts-json-routes, ts-json-unknown, ts-unknown, ts-narrowing, ts-functions, ts-iteration, ts-objects, ts-typeof-operator, ts-arrays, ts-numbers, ts-null-undefined]
---*/
// Only the parsed source becomes a plain literal; text, narrowing and every observation remain the same.
function check(n: number): void {
  const text = '{"box":{"old":' + n + '},"keep":' + n + ',"box":{"items":[' + n + ',-0],"ok":true}}';
  const value: unknown = { box: { items: [n, -0], ok: true }, keep: n };
  if (typeof value !== "object" || value === null || !("box" in value) || !("keep" in value)) throw new Error("record");
  assert.sameValue(typeof value, "object"); assert.compareArray(Object.keys(value), ["box", "keep"]);
  assert.sameValue(typeof value.keep, "number"); assert.sameValue(Object.is(value.keep, n), true);
  const box: unknown = value.box;
  if (typeof box !== "object" || box === null || !("items" in box) || !("ok" in box)) throw new Error("box");
  assert.sameValue(typeof box, "object"); assert.compareArray(Object.keys(box), ["items", "ok"]);
  assert.sameValue("old" in box, false);
  assert.sameValue(typeof box.ok, "boolean"); assert.sameValue(Object.is(box.ok, true), true);
  assert.sameValue(typeof box.items, "object");
  if (!Array.isArray(box.items)) throw new Error("items");
  const items: unknown[] = box.items, expected: number[] = [n, -0];
  assert.sameValue(items.length, 2); assert.compareArray(Object.keys(items), ["0", "1"]);
  for (let i = 0; i < 2; i++) {
    assert.sameValue(typeof items[i], "number"); assert.sameValue(Object.is(items[i], expected[i]), true);
  }
}
for (const n of [-2, 0, 7]) check(n);
