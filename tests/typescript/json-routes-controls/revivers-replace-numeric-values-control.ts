/*---
description: Control for revivers-replace-numeric-values; use a plain literal at the tested route.
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
  const log: string[][] = [], holders: unknown[] = [];
  const handlers = { callback: function(this: unknown, key: string, value: unknown): unknown {
    log.push([key, snapshot(value), snapshot(this)]); holders.push(this);
    return typeof value === "number" ? value * 2 : value;
  } };
  const value: unknown = JSON.parse('{"x":' + n + ',"y":-0}', handlers.callback);
  if (!jsonObject(value)) throw new Error("shape");
  const before = "{x=number:" + n + ",y=number:-0}", after = "{x=number:" + n * 2 + ",y=number:-0}";
  const expected = [["x", "number:" + n, before], ["y", "number:-0", after], ["", after, "{=" + after + "}"]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.sameValue(snapshot(value), after); assert.compareArray(Object.keys(value), ["x", "y"]);
  assert.sameValue(typeof value.x, "number"); assert.sameValue(Object.is(value.x, n * 2), true);
  assert.sameValue(typeof value.y, "number"); assert.sameValue(Object.is(value.y, -0), true);
  assert.compareArray(holders.slice(0, 2), [value, value]);
  const wrapper = holders[2]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], value);
}
