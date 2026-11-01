/*---
description: Control for revivers-integer-key-visit-order; use a plain literal at the tested route.
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
    return value;
  } };
  const value: unknown = JSON.parse('{"b":' + n + ',"10":10,"2":2,"a":true}', handlers.callback);
  if (!jsonObject(value)) throw new Error("shape");
  const root = "{2=number:2,10=number:10,b=number:" + n + ",a=boolean:true}";
  const expected = [["2", "number:2", root], ["10", "number:10", root], ["b", "number:" + n, root], ["a", "boolean:true", root], ["", root, "{=" + root + "}"]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.sameValue(snapshot(value), root); assert.compareArray(Object.keys(value), ["2", "10", "b", "a"]);
  assert.sameValue(typeof value["2"], "number"); assert.sameValue(Object.is(value["2"], 2), true);
  assert.sameValue(typeof value["10"], "number"); assert.sameValue(Object.is(value["10"], 10), true);
  assert.sameValue(typeof value.b, "number"); assert.sameValue(Object.is(value.b, n), true); assert.sameValue(typeof value.a, "boolean"); assert.sameValue(value.a, true);
  assert.compareArray(holders.slice(0, 4), [value, value, value, value]);
  const wrapper = holders[4]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], value);
}
