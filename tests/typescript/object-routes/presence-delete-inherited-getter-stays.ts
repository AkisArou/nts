/*---
description: "Deleting an optional view succeeds without removing an inherited accessor or creating an own field."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-literal-types, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-interfaces, ts-index-signatures, ts-optional-properties, ts-accessors, ts-closures, ts-class, ts-json-stringify, ts-expressions]
---*/
// An optional interface hides own versus class-inherited p; node deletes only the own property, keeps inherited reads and excludes the inherited getter from JSON.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface PresenceView { [key: string]: ObjectValue; p?: ObjectValue; }
type ShapeMode = "empty" | "own" | "inherited";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode): void {
  const log: unknown[] = [];
  class Inherited { [key: string]: ObjectValue; get p(): ObjectValue { log.push("get", input); return input; } }
  let source: PresenceView = {};
  if (mode === "inherited") { source = new Inherited(); source["2"] = input; source.tail = other; }
  if (mode === "own") source = { "2": input, get p(): ObjectValue { log.push("get", input); return input; }, tail: other };
  const alias: PresenceView = source, before = mode === "empty" ? [] : mode === "own" ? ["2", "p", "tail"] : ["2", "tail"];
  assert.compareArray(Object.keys(alias), before); same(alias, source);
  const removed = delete alias.p; log.push("delete", removed); same(removed, true);
  const exists = "p" in source, own = Object.hasOwn(source, "p"), legacy = Object.prototype.hasOwnProperty.call(source, "p");
  log.push("presence", exists, own, legacy); same(exists, mode === "inherited"); same(own, false); same(legacy, false);
  const value = source.p; log.push("read", value); same(value, mode === "inherited" ? input : undefined);
  const names = mode === "empty" ? [] : ["2", "tail"], keys = Object.keys(source), visited: string[] = []; for (const key in source) visited.push(key);
  assert.compareArray(keys, names); assert.compareArray(visited, names);
  if (mode !== "empty") { same(source["2"], input); same(source.tail, other); }
  const json = JSON.stringify(source); log.push("json", json);
  const text = mode === "empty" ? '{}' : '{' + (input === undefined ? "" : '"2":' + encoded + ',') + '"tail":{"id":7}}'; same(json, text);
  const expected: unknown[] = ["delete", true, "presence", mode === "inherited", false, false];
  if (mode === "inherited") expected.push("get", input); expected.push("read", mode === "inherited" ? input : undefined, "json", text); assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["empty", "own", "inherited"];
for (const sample of samples) for (const mode of modes) inspect(sample[0], sample[1], mode);
