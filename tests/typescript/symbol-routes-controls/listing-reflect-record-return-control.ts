/*---
description: String-ID record control for Reflect own-key groups survive a typed Record return with interleaved string and symbol insertions.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-record, ts-type-aliases, ts-null-undefined]
---*/
// A returned Record carries mixed integer, string and same-description symbol keys; node lists integer keys first and symbol identities last in insertion order.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first = "token:first", second = "token:second";
interface Target { text: Record<string, number>; fields: Record<string, number | undefined>; textOrder: string[]; order: string[]; }
function makeTarget(input: number, mode: string): Target {
  const target: Target = { text: {}, fields: {}, textOrder: [], order: [] }; if (mode === "empty") return target;
  const a = mode === "forward" ? first : second, b = mode === "forward" ? second : first;
  target.order.push(a); target.fields[a] = input; target.text.tail = 11; target.text["10"] = 10; target.order.push(b); target.fields[b] = undefined; target.text["01"] = -0; target.text["2"] = 2; target.textOrder.push("tail", "10", "01", "2"); return target;
}
function keys(target: Target): string[] { const indices: string[] = [], names: string[] = []; for (const key of target.textOrder) { const n = Number(key); if (String(n) === key && Number.isInteger(n) && n >= 0 && n < 4294967295) { let at = 0; while (at < indices.length && Number(indices[at]) < n) at++; indices.splice(at, 0, key); } else names.push(key); } return indices.concat(names); }
function tokens(target: Target): string[] { return target.order.slice(); }
function all(target: Target): string[] { return keys(target).concat(tokens(target)); }
function read(target: Target, key: string): number | undefined { return Object.hasOwn(target.text, key) ? target.text[key] : target.fields[key]; }
for (const input of [-0, NaN, 19]) for (const mode of ["empty", "forward", "reverse"]) {
  const target = makeTarget(input, mode), a = mode === "forward" ? first : second, b = mode === "forward" ? second : first;
  assert.compareArray(keys(target), mode === "empty" ? [] : ["2", "10", "tail", "01"]);
  assert.compareArray(tokens(target), mode === "empty" ? [] : [a, b]); assert.compareArray(all(target), mode === "empty" ? [] : ["2", "10", "tail", "01", a, b]);
  same(Object.is(first, second), false); same(read(target, a), mode === "empty" ? undefined : input); same(read(target, b), undefined);
  same(read(target, "2"), mode === "empty" ? undefined : 2); same(read(target, "10"), mode === "empty" ? undefined : 10);
  same(read(target, "tail"), mode === "empty" ? undefined : 11); same(read(target, "01"), mode === "empty" ? undefined : -0);
}
