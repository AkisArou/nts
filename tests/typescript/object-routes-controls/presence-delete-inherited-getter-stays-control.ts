/*---
description: "Control for presence-delete-inherited-getter-stays; Deleting an optional view succeeds without removing an inherited accessor or creating an own field."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-function-types, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-literal-types, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-closures, ts-json-stringify]
---*/
// An optional interface hides own versus class-inherited p; node deletes only the own property, keeps inherited reads and excludes the inherited getter from JSON. The control uses explicit names, stored values and presence flags.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function serialize(names: string[], read: (key: string) => ObjectValue): string { const parts: string[] = []; for (const key of names) { const value = read(key), text = JSON.stringify(value); if (text !== undefined) parts.push(JSON.stringify(key) + ":" + text); } return "{" + parts.join(",") + "}"; }
type ShapeMode = "empty" | "own" | "inherited";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode): void {
  const log: unknown[] = [];
  const source = { own: mode === "own", inherited: mode === "inherited", p: input, two: input, tail: other, names: mode === "empty" ? [] : mode === "own" ? ["2", "p", "tail"] : ["2", "tail"] };
  function readP(): ObjectValue { if (source.inherited) { log.push("get", source.p); return source.p; } return undefined; }
  function read(key: string): ObjectValue { if (key === "p") return readP(); if (key === "2") return source.two; return source.tail; }
  const alias = source, before = mode === "empty" ? [] : mode === "own" ? ["2", "p", "tail"] : ["2", "tail"];
  assert.compareArray(alias.names, before); same(alias, source);
  alias.own = false; alias.names = mode === "empty" ? [] : ["2", "tail"]; const removed = true; log.push("delete", removed); same(removed, true);
  const exists = source.own || source.inherited, own = source.own, legacy = source.own;
  log.push("presence", exists, own, legacy); same(exists, mode === "inherited"); same(own, false); same(legacy, false);
  const value = readP(); log.push("read", value); same(value, mode === "inherited" ? input : undefined);
  const names = mode === "empty" ? [] : ["2", "tail"], keys = source.names.slice(), visited: string[] = []; for (const key of source.names) visited.push(key);
  assert.compareArray(keys, names); assert.compareArray(visited, names);
  if (mode !== "empty") { same(source.two, input); same(source.tail, other); }
  const json = serialize(source.names, read); log.push("json", json);
  const text = mode === "empty" ? '{}' : '{' + (input === undefined ? "" : '"2":' + encoded + ',') + '"tail":{"id":7}}'; same(json, text);
  const expected: unknown[] = ["delete", true, "presence", mode === "inherited", false, false];
  if (mode === "inherited") expected.push("get", input); expected.push("read", mode === "inherited" ? input : undefined, "json", text); assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["empty", "own", "inherited"];
for (const sample of samples) for (const mode of modes) inspect(sample[0], sample[1], mode);
