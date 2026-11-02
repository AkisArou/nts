/*---
description: Callable fields preserve distinct raw spellings for three sites with equal cooked text.
features: [ts-template-routes, ts-template-route-escapes-raw, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-objects, ts-unknown, ts-interfaces, ts-readonly, ts-unions, ts-numbers, ts-null-undefined, ts-tuples, ts-function-types, ts-arrow-functions, ts-conversions, ts-interface-extends, ts-closures, ts-tagged-templates, ts-template-literals]
---*/
// Callable interface fields select literal, hex and Unicode A sites; node returns equal cooked strings but retains three distinct frozen cooked/raw identities.
interface Cooked extends ReadonlyArray<string | undefined> { readonly raw: readonly string[]; }
type Value = number | string | null | undefined;
type Tag = (s: Cooked, value: Value) => string;
interface Slot { run: (tag: Tag, value: Value) => string; raw: string; }
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function check(s: Cooked, cooked: readonly (string | undefined)[], raw: readonly string[]): void {
  exact(s, cooked); exact(s.raw, raw); same(Array.isArray(s), true); same(Array.isArray(s.raw), true);
  same(Object.isFrozen(s), true); same(Object.isFrozen(s.raw), true); same(s === s.raw, false);
}
const slots: Slot[] = [{ run: (tag, value) => tag`A${value}Z`, raw: "A" }, { run: (tag, value) => tag`\x41${value}Z`, raw: "\\x41" }, { run: (tag, value) => tag`\u0041${value}Z`, raw: "\\u0041" }];
const seen: (Cooked | undefined)[] = [];
function inspect(index: number, value: Value, text: string): void {
  const slot = slots[index], log: unknown[] = [];
  const tag: Tag = (s, observed) => {
    same(observed, value); check(s, ["A", "Z"], [slot.raw, "Z"]);
    const previous = seen[index];
    if (previous !== undefined) { same(s, previous); same(s.raw, previous.raw); }
    else { for (const other of seen) if (other !== undefined) { same(s === other, false); same(s.raw === other.raw, false); } seen[index] = s; }
    const result = String(s[0]) + String(observed) + String(s[1]); log.push(s[0], s[1], s.raw[0], s.raw[1], observed, result); return result;
  };
  same(slot.run(tag, value), "A" + text + "Z"); exact(log, ["A", "Z", slot.raw, "Z", value, "A" + text + "Z"]);
}
const rows: [Value, string][] = [[-0, "0"], [NaN, "NaN"], ["", ""], ["A", "A"], [undefined, "undefined"], [null, "null"]];
for (const [value, text] of rows) for (const index of [0, 1, 2]) inspect(index, value, text);
