/*---
description: "Control for presence-delete-own-getter-silence; Deleting an optional own getter through an alias removes it without a read and leaves sibling accessors observable."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-function-types, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-literal-types, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-closures, ts-json-stringify]
---*/
// An optional string-index view deletes p on empty, missing, data and getter shapes; node never calls the removed getter and retains exact sibling order and JSON. The control uses explicit names, stored values and presence flags.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function serialize(names: string[], read: (key: string) => ObjectValue): string { const parts: string[] = []; for (const key of names) { const value = read(key), text = JSON.stringify(value); if (text !== undefined) parts.push(JSON.stringify(key) + ":" + text); } return "{" + parts.join(",") + "}"; }
type ShapeMode = "empty" | "missing" | "data" | "getter";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode): void {
  const log: unknown[] = [], source = { present: mode === "data" || mode === "getter", p: input, two: input, tail: other, names: mode === "empty" ? [] : mode === "missing" ? ["2", "tail"] : ["2", "p", "tail"] };
  function readTail(): ObjectValue { log.push("get.tail", source.tail); return source.tail; }
  function read(key: string): ObjectValue { if (key === "2") return source.two; if (key === "tail") return readTail(); return source.present ? source.p : undefined; }
  const alias = source, before = mode === "empty" ? [] : mode === "missing" ? ["2", "tail"] : ["2", "p", "tail"];
  same(alias, source); assert.compareArray(source.names, before);
  alias.present = false; alias.names = mode === "empty" ? [] : ["2", "tail"]; const removed = true; log.push("delete", removed); same(removed, true); same(source.present ? source.p : undefined, undefined);
  same(source.present, false); same(source.present, false); same(source.present, false);
  const names = mode === "empty" ? [] : ["2", "tail"], keys = source.names.slice(), visited: string[] = []; for (const key of source.names) visited.push(key);
  assert.compareArray(keys, names); assert.compareArray(visited, names);
  const values: ObjectValue[] = mode === "empty" ? [] : [input, other];
  for (let i = 0; i < keys.length; i++) { const value = read(keys[i]); log.push("entry", keys[i], value); same(value, values[i]); }
  const json = serialize(source.names, read); log.push("json", json);
  const text = mode === "empty" ? '{}' : '{' + (input === undefined ? "" : '"2":' + encoded + ',') + '"tail":{"id":7}}';
  same(json, text);
  const expected: unknown[] = ["delete", true];
  if (mode !== "empty") expected.push("entry", "2", input, "get.tail", other, "entry", "tail", other, "get.tail", other);
  expected.push("json", text); assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["empty", "missing", "data", "getter"];
for (const sample of samples) for (const mode of modes) inspect(sample[0], sample[1], mode);
