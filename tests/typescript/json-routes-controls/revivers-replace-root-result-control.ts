/*---
description: Control for revivers-replace-root-result; use a plain literal at the tested route.
features: [ts-json-routes, ts-json-revivers, ts-functions, ts-function-types, ts-type-aliases, ts-interfaces, ts-objects, ts-arrays, ts-iteration, ts-unknown, ts-type-guards, ts-record, ts-typeof-operator, ts-this-parameter, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Remove only the callback holder interface annotation; the plain literal retains the callback body, text, logs and all assertions.
function jsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function snapshot(value: unknown): string {
  if (Array.isArray(value)) { const items: unknown[] = value; return "[" + items.map(snapshot).join(",") + "]"; }
  if (jsonObject(value)) return "{" + Object.keys(value).map(key => key + "=" + snapshot(value[key])).join(",") + "}";
  return Object.is(value, -0) ? "number:-0" : typeof value + ":" + String(value);
}
type JsonCallback = (this: unknown, key: string, value: unknown) => unknown;
interface JsonCallbackSlot { callback: JsonCallback; }
for (const n of [-2, 0, 3]) {
  const log: string[][] = [], holders: unknown[] = [], values: unknown[] = [];
  const handlers = { callback: function(this: unknown, key: string, value: unknown): unknown {
    log.push([key, snapshot(value), snapshot(this)]); holders.push(this);
    values.push(value); return key === "" ? [n, -0] : value;
  } };
  const value: unknown = JSON.parse('{"n":' + n + ',"ok":true}', handlers.callback);
  if (!Array.isArray(value)) throw new Error("shape"); const items: unknown[] = value;
  const original = holders[0]; if (!jsonObject(original)) throw new Error("original");
  const root = "{n=number:" + n + ",ok=boolean:true}";
  const expected = [["n", "number:" + n, root], ["ok", "boolean:true", root], ["", root, "{=" + root + "}"]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.sameValue(snapshot(original), root); assert.compareArray(Object.keys(original), ["n", "ok"]);
  assert.sameValue(typeof original.n, "number"); assert.sameValue(Object.is(original.n, n), true); assert.sameValue(typeof original.ok, "boolean"); assert.sameValue(original.ok, true);
  assert.sameValue(items.length, 2); assert.compareArray(Object.keys(items), ["0", "1"]);
  assert.sameValue(typeof items[0], "number"); assert.sameValue(Object.is(items[0], n), true);
  assert.sameValue(typeof items[1], "number"); assert.sameValue(Object.is(items[1], -0), true);
  assert.sameValue(holders[1], original); assert.sameValue(Object.is(items, original), false);
  assert.compareArray(values, [n, true, original]);
  const wrapper = holders[2]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], original);
}
