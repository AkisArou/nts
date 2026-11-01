/*---
description: "Deleting an optional own getter through an alias removes it without a read and leaves sibling accessors observable."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-literal-types, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-interfaces, ts-index-signatures, ts-optional-properties, ts-accessors, ts-closures, ts-json-stringify, ts-expressions]
---*/
// An optional string-index view deletes p on empty, missing, data and getter shapes; node never calls the removed getter and retains exact sibling order and JSON.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface PresenceView { [key: string]: ObjectValue; p?: ObjectValue; }
type ShapeMode = "empty" | "missing" | "data" | "getter";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode): void {
  const log: unknown[] = []; let source: PresenceView = {};
  if (mode === "missing") source = { "2": input, get tail(): ObjectValue { log.push("get.tail", other); return other; } };
  if (mode === "data") source = { "2": input, p: input, get tail(): ObjectValue { log.push("get.tail", other); return other; } };
  if (mode === "getter") source = { "2": input, get p(): ObjectValue { log.push("get.p", input); return input; }, get tail(): ObjectValue { log.push("get.tail", other); return other; } };
  const alias: PresenceView = source, before = mode === "empty" ? [] : mode === "missing" ? ["2", "tail"] : ["2", "p", "tail"];
  same(alias, source); assert.compareArray(Object.keys(source), before);
  const removed = delete alias.p; log.push("delete", removed); same(removed, true); same(source.p, undefined);
  same("p" in source, false); same(Object.hasOwn(source, "p"), false); same(Object.prototype.hasOwnProperty.call(source, "p"), false);
  const names = mode === "empty" ? [] : ["2", "tail"], keys = Object.keys(source), visited: string[] = []; for (const key in source) visited.push(key);
  assert.compareArray(keys, names); assert.compareArray(visited, names);
  const values: ObjectValue[] = mode === "empty" ? [] : [input, other];
  for (let i = 0; i < keys.length; i++) { const value = source[keys[i]]; log.push("entry", keys[i], value); same(value, values[i]); }
  const json = JSON.stringify(source); log.push("json", json);
  const text = mode === "empty" ? '{}' : '{' + (input === undefined ? "" : '"2":' + encoded + ',') + '"tail":{"id":7}}'; same(json, text);
  const expected: unknown[] = ["delete", true];
  if (mode !== "empty") expected.push("entry", "2", input, "get.tail", other, "entry", "tail", other, "get.tail", other);
  expected.push("json", text); assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["empty", "missing", "data", "getter"];
for (const sample of samples) for (const mode of modes) inspect(sample[0], sample[1], mode);
