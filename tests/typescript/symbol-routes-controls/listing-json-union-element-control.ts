/*---
description: String-ID record control for JSON on union array elements omits symbol keys even when their values contain a cycle.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-unions, ts-type-aliases, ts-literal-types, ts-null-undefined, ts-json-stringify]
---*/
// A typed union array carries empty and data variants with cyclic symbol payloads; node serializes only ordered string fields without following the hidden cycle.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const secret = "token:secret", absent = "token:absent";
interface Secret { value: number; self?: Secret; }
type Source = { kind: "empty" | "data"; text: Record<string, number | string>; fields: Record<string, Secret | undefined>; order: string[] };
function makeTarget(input: number, populated: boolean): Source { if (!populated) return { kind: "empty", text: { kind: "empty" }, fields: {}, order: [] }; const part: Secret = { value: input }; part.self = part; return { kind: "data", text: { kind: "data", "2": input, label: "visible" }, fields: { [absent]: undefined, [secret]: part }, order: [absent, secret] }; }
function serialize(sources: Source[], index: number): string | undefined { const visible: Record<string, number | string> = {}; for (const key of keys(sources[index])) visible[key] = sources[index].text[key]; return JSON.stringify(visible); }
function keys(target: Source): string[] { return Object.keys(target.text); }
function tokens(target: Source): string[] { return target.order.slice(); }
function read(target: Source): Secret | undefined { return target.fields[secret]; }
for (const input of [-0, NaN, 17]) {
  const sources: Source[] = [makeTarget(input, false), makeTarget(input, true)];
  for (let at = 0; at < sources.length; at++) {
    const target = sources[at], part = read(target);
    same(serialize(sources, at), at === 0 ? '{"kind":"empty"}' : '{"2":' + (Number.isNaN(input) ? "null" : String(input)) + ',"kind":"data","label":"visible"}');
    assert.compareArray(keys(target), at === 0 ? ["kind"] : ["2", "kind", "label"]); assert.compareArray(tokens(target), at === 0 ? [] : [absent, secret]);
    same(Object.is(secret, absent), false); if (at === 0) same(part, undefined); else { if (part === undefined) throw new Error("payload"); same(part.value, input); same(part.self, part); }
  }
}
