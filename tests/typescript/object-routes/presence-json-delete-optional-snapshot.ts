/*---
description: "A JSON getter deletes a later optional slot before serialization can read its value or invoke its getter."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-interfaces, ts-index-signatures, ts-optional-properties, ts-accessors, ts-closures, ts-json-stringify, ts-expressions, ts-literal-types]
---*/
// An optional interface carries absent, undefined, data and getter p shapes; node omits p after the earlier head getter deletes it, keeps the original keys snapshot and never invokes p.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface PresenceView { [key: string]: ObjectValue; p?: ObjectValue; }
type ShapeMode = "absent" | "undefined" | "data" | "getter";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode): void {
  const log: unknown[] = []; let source: PresenceView = { "2": input, get head(): ObjectValue { log.push("head", input); delete source.p; return "H"; }, tail: other };
  if (mode === "undefined") source.p = undefined; if (mode === "data") source.p = input;
  if (mode === "getter") source = { "2": input, get head(): ObjectValue { log.push("head", input); delete source.p; return "H"; }, get p(): ObjectValue { log.push("p", input); return input; }, tail: other };
  const before = mode === "absent" ? ["2", "head", "tail"] : mode === "getter" ? ["2", "head", "p", "tail"] : ["2", "head", "tail", "p"];
  const snapshot = Object.keys(source); assert.compareArray(snapshot, before);
  const json = JSON.stringify(source); log.push("json", json);
  const text = '{' + (input === undefined ? "" : '"2":' + encoded + ',') + '"head":"H","tail":{"id":7}}'; same(json, text);
  const names = ["2", "head", "tail"], keys = Object.keys(source), visited: string[] = []; for (const key in source) visited.push(key);
  assert.compareArray(snapshot, before); assert.compareArray(keys, names); assert.compareArray(visited, names);
  same(source["2"], input); same(source.tail, other); same(source.p, undefined); same("p" in source, false); same(Object.hasOwn(source, "p"), false); same(source.head, "H");
  assert.compareArray(log, ["head", input, "json", text, "head", input]);
}
const modes: ShapeMode[] = ["absent", "undefined", "data", "getter"];
for (const sample of samples) for (const mode of modes) inspect(sample[0], sample[1], mode);
