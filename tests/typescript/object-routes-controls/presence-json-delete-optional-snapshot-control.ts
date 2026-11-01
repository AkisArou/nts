/*---
description: "Control for presence-json-delete-optional-snapshot; A JSON getter deletes a later optional slot before serialization can read its value or invoke its getter."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-function-types, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-closures, ts-json-stringify, ts-literal-types]
---*/
// An optional interface carries absent, undefined, data and getter p shapes; node omits p after the earlier head getter deletes it, keeps the original keys snapshot and never invokes p. The control uses explicit names, stored values and presence flags.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function serialize(names: string[], read: (key: string) => ObjectValue): string { const parts: string[] = []; for (const key of names) { const value = read(key), text = JSON.stringify(value); if (text !== undefined) parts.push(JSON.stringify(key) + ":" + text); } return "{" + parts.join(",") + "}"; }
type ShapeMode = "absent" | "undefined" | "data" | "getter";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode): void {
  const log: unknown[] = [], source = { two: input, tail: other, p: mode === "undefined" ? undefined : input, present: mode !== "absent", getter: mode === "getter", names: mode === "absent" ? ["2", "head", "tail"] : mode === "getter" ? ["2", "head", "p", "tail"] : ["2", "head", "tail", "p"] };
  function readHead(): string { log.push("head", input); source.present = false; source.names = ["2", "head", "tail"]; return "H"; }
  function read(key: string): ObjectValue { if (key === "head") return readHead(); if (key === "2") return source.two; if (key === "tail") return source.tail; if (!source.present) return undefined; if (source.getter) log.push("p", source.p); return source.p; }
  const before = mode === "absent" ? ["2", "head", "tail"] : mode === "getter" ? ["2", "head", "p", "tail"] : ["2", "head", "tail", "p"];
  const snapshot = source.names.slice(); assert.compareArray(snapshot, before);
  const json = serialize(snapshot, read); log.push("json", json);
  const text = '{' + (input === undefined ? "" : '"2":' + encoded + ',') + '"head":"H","tail":{"id":7}}'; same(json, text);
  const names = ["2", "head", "tail"], keys = source.names.slice(), visited: string[] = []; for (const key of source.names) visited.push(key);
  assert.compareArray(snapshot, before); assert.compareArray(keys, names); assert.compareArray(visited, names);
  same(source.two, input); same(source.tail, other); same(source.present ? source.p : undefined, undefined); same(source.present, false); same(source.present, false); same(readHead(), "H");
  assert.compareArray(log, ["head", input, "json", text, "head", input]);
}
const modes: ShapeMode[] = ["absent", "undefined", "data", "getter"];
for (const sample of samples) for (const mode of modes) inspect(sample[0], sample[1], mode);
