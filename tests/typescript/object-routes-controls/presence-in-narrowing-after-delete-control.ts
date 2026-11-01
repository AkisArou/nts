/*---
description: "Control for presence-in-narrowing-after-delete; An in guard after conditional deletion selects the current optional member instead of a stale narrowed branch."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-function-types, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-closures, ts-json-stringify, ts-literal-types]
---*/
// A declared object union is checked, optionally deleted and checked again; node distinguishes retained undefined, removed getters and the other union member with exact JSON and ordered keys. The control uses explicit names, stored values and presence flags.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function serialize(names: string[], read: (key: string) => ObjectValue): string { const parts: string[] = []; for (const key of names) { const value = read(key), text = JSON.stringify(value); if (text !== undefined) parts.push(JSON.stringify(key) + ":" + text); } return "{" + parts.join(",") + "}"; }
type ShapeMode = "absent" | "undefined" | "value" | "getter" | "other";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode, remove: boolean): void {
  const log: unknown[] = [], source = { hasP: mode !== "absent" && mode !== "other", hasOther: mode === "other", p: mode === "undefined" ? undefined : input, other: input, tail: other, getter: mode === "getter" };
  function readP(): ObjectValue { if (!source.hasP) return undefined; if (source.getter) log.push("get", source.p); return source.p; }
  function read(key: string): ObjectValue { if (key === "p") return readP(); if (key === "other") return source.other; return source.tail; }
  const initial = mode !== "absent" && mode !== "other", present = initial && !remove, wanted = mode === "undefined" ? undefined : input;
  if (source.hasP) { log.push("before:present"); if (remove) { source.hasP = false; same(true, true); log.push("delete"); } }
  else log.push("before:absent");
  let actual: ObjectValue = undefined;
  if (source.hasP) { actual = readP(); log.push("after:present", actual); }
  else log.push("after:absent", actual);
  if (source.hasOther) same(source.other, input);
  same(actual, present ? wanted : undefined); same(source.hasP, present); same(source.tail, other);
  const names = mode === "other" ? ["other", "tail"] : present ? ["p", "tail"] : ["tail"], keys = source.hasOther ? ["other", "tail"] : source.hasP ? ["p", "tail"] : ["tail"], visited: string[] = []; for (const key of keys) visited.push(key);
  assert.compareArray(keys, names); assert.compareArray(visited, names);
  const json = serialize(keys, read); const field = mode === "other" ? (input === undefined ? "" : '"other":' + encoded + ',') : present && wanted !== undefined ? '"p":' + encoded + ',' : "";
  const text = '{' + field + '"tail":{"id":7}}'; same(json, text); log.push("json", json);
  const expected: unknown[] = [initial ? "before:present" : "before:absent"];
  if (initial && remove) expected.push("delete"); if (present && mode === "getter") expected.push("get", input);
  expected.push(present ? "after:present" : "after:absent", present ? wanted : undefined);
  if (present && mode === "getter") expected.push("get", input); expected.push("json", text); assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["absent", "undefined", "value", "getter", "other"];
for (const sample of samples) for (const mode of modes) for (const remove of [false, true]) inspect(sample[0], sample[1], mode, remove);
