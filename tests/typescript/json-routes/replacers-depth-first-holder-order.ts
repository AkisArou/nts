/*---
description: A replacer in a declared function-typed field visits the root first, then properties with their exact values and holders.
features: [ts-json-routes, ts-json-replacers, ts-functions, ts-function-types, ts-type-aliases, ts-interfaces, ts-objects, ts-arrays, ts-iteration, ts-unknown, ts-type-guards, ts-record, ts-typeof-operator, ts-this-parameter, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Stringify nested values through a typed replacer holder; node calls root first and observes -0 before writing it as 0.
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
  const handlers: JsonCallbackSlot = { callback: function(this: unknown, key: string, value: unknown): unknown {
    log.push([key, snapshot(value), snapshot(this)]); holders.push(this);
    return value;
  } };
  const input = { outer: { leaf: n }, list: [-0, true], tail: null };
  assert.sameValue(JSON.stringify(input, handlers.callback), '{"outer":{"leaf":' + n + '},"list":[0,true],"tail":null}');
  const outer = "{leaf=number:" + n + "}", list = "[number:-0,boolean:true]";
  const root = "{outer=" + outer + ",list=" + list + ",tail=object:null}";
  const expected = [["", root, "{=" + root + "}"], ["outer", outer, root], ["leaf", "number:" + n, outer],
    ["list", list, root], ["0", "number:-0", list], ["1", "boolean:true", list], ["tail", "object:null", root]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.compareArray(holders.slice(1), [input, input.outer, input, input.list, input.list, input]);
  const wrapper = holders[0]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], input);
  assert.sameValue(snapshot(input), root); assert.sameValue(Object.is(input.list[0], -0), true);
}
