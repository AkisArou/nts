/*---
description: Control for string.raw as a typed tag parameter ignores invalid cooked text and preserves raw spelling.
features: [ts-template-routes, ts-template-route-escapes-raw, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-objects, ts-unknown, ts-interfaces, ts-readonly, ts-unions, ts-numbers, ts-null-undefined, ts-tuples, ts-function-types, ts-arrow-functions, ts-conversions, ts-interface-extends, ts-closures, ts-rest-parameters]
---*/
// Plain control: Replace the template site by one frozen explicit array and ordinary calls; replace the String.raw function value by a manual raw/substitution interleaving function using String and addition.
interface Cooked extends ReadonlyArray<string | undefined> { readonly raw: readonly string[]; }
type Value = number | string | boolean | null | undefined;
type RawTag = (s: Cooked, value: Value) => string;
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function check(s: Cooked, cooked: readonly (string | undefined)[], raw: readonly string[]): void {
  exact(s, cooked); exact(s.raw, raw); same(Array.isArray(s), true); same(Array.isArray(s.raw), true);
  same(Object.isFrozen(s), true); same(Object.isFrozen(s.raw), true); same(s === s.raw, false);
}
const seen: Cooked[] = [];
function rawText(source: { readonly raw: ArrayLike<string> }, ...values: unknown[]): string {
  const raw = source.raw, length = raw.length; let text = "";
  for (let i = 0; i + 1 <= length; i++) { text += String(raw[i]); if (i + 2 <= length && i < values.length) text += String(values[i]); }
  return text;
}
const site: Cooked = Object.freeze(Object.assign([undefined, "\n"], { raw: Object.freeze(["\\xZ|", "\\n"]) }));
function atSite(tag: RawTag, value: Value): string { return tag(site, value); }
function inspect(value: Value, text: string): void {
  const log: unknown[] = [];
  const observe: RawTag = (s, observed) => {
    same(observed, value); check(s, [undefined, "\n"], ["\\xZ|", "\\n"]);
    if (seen.length > 0) { same(s, seen[0]); same(s.raw, seen[0].raw); } seen.push(s);
    log.push("observe", observed); return s.raw[0] + String(observed) + s.raw[1];
  };
  const tags: RawTag[] = [observe, rawText, observe];
  for (const tag of tags) { const result = atSite(tag, value); same(result, "\\xZ|" + text + "\\n"); log.push("result", result); }
  exact(log, ["observe", value, "result", "\\xZ|" + text + "\\n", "result", "\\xZ|" + text + "\\n", "observe", value, "result", "\\xZ|" + text + "\\n"]);
}
const rows: [Value, string][] = [[-0, "0"], [NaN, "NaN"], ["", ""], ["\ud800", "\ud800"], [undefined, "undefined"], [null, "null"], [false, "false"]];
for (const [value, text] of rows) inspect(value, text);
