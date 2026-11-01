/*---
description: Control for replacers-omit-object-property; use a plain literal at the tested route.
features: [ts-json-routes, ts-json-replacers, ts-functions, ts-function-types, ts-type-aliases, ts-interfaces, ts-objects, ts-arrays, ts-iteration, ts-unknown, ts-type-guards, ts-record, ts-typeof-operator, ts-this-parameter, ts-numbers, ts-strings, ts-arrow-functions]
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
    return key === "drop" ? undefined : value;
  } };
  const input = { drop: n, keep: -0, tail: true };
  assert.sameValue(JSON.stringify(input, handlers.callback), '{"keep":0,"tail":true}');
  const root = "{drop=number:" + n + ",keep=number:-0,tail=boolean:true}";
  const expected = [["", root, "{=" + root + "}"], ["drop", "number:" + n, root], ["keep", "number:-0", root], ["tail", "boolean:true", root]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.compareArray(holders.slice(1), [input, input, input]);
  const wrapper = holders[0]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], input);
  assert.compareArray(Object.keys(input), ["drop", "keep", "tail"]); assert.sameValue(snapshot(input), root);
  assert.sameValue(Object.is(input.drop, n), true); assert.sameValue(Object.is(input.keep, -0), true);
}
