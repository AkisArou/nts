/*---
description: JSON on union array elements omits symbol keys even when their values contain a cycle.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-unions, ts-type-aliases, ts-literal-types, ts-null-undefined, ts-json-stringify, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// A typed union array carries empty and data variants with cyclic symbol payloads; node serializes only ordered string fields without following the hidden cycle.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const secret: unique symbol = Symbol("secret"), absent: unique symbol = Symbol("secret");
interface Secret { value: number; self?: Secret; }
type Source = { kind: "empty" } | { kind: "data"; "2": number; label: string; [secret]: Secret; [absent]: undefined };
function makeTarget(input: number, populated: boolean): Source { if (!populated) return { kind: "empty" }; const part: Secret = { value: input }; part.self = part; return { [absent]: undefined, kind: "data", "2": input, label: "visible", [secret]: part }; }
function serialize(sources: Source[], index: number): string | undefined { return JSON.stringify(sources[index]); }
function keys(target: Source): string[] { return Object.keys(target); }
function tokens(target: Source): symbol[] { return Object.getOwnPropertySymbols(target); }
function read(target: Source): Secret | undefined { return target.kind === "data" ? target[secret] : undefined; }
for (const input of [-0, NaN, 17]) {
  const sources: Source[] = [makeTarget(input, false), makeTarget(input, true)];
  for (let at = 0; at < sources.length; at++) {
    const target = sources[at], part = read(target);
    same(serialize(sources, at), at === 0 ? '{"kind":"empty"}' : '{"2":' + (Number.isNaN(input) ? "null" : String(input)) + ',"kind":"data","label":"visible"}');
    assert.compareArray(keys(target), at === 0 ? ["kind"] : ["2", "kind", "label"]); assert.compareArray(tokens(target), at === 0 ? [] : [absent, secret]);
    same(Object.is(secret, absent), false); if (at === 0) same(part, undefined); else { if (part === undefined) throw new Error("payload"); same(part.value, input); same(part.self, part); }
  }
}
