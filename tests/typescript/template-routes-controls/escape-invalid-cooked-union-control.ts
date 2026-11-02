/*---
description: Control for a widened typed cooked-array view preserves undefined segments from invalid tagged escapes.
features: [ts-template-routes, ts-template-route-escapes-raw, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-objects, ts-unknown, ts-interfaces, ts-readonly, ts-unions, ts-numbers, ts-null-undefined, ts-tuples, ts-generics, ts-generic-constraints, ts-conversions, ts-spread, ts-interface-extends, ts-closures, ts-rest-parameters]
---*/
// Plain control: Create one frozen array containing actual undefined, empty and valid strings plus independently written raw strings, then call the tag with the same four typed arguments.
interface Cooked extends ReadonlyArray<string | undefined> { readonly raw: readonly string[]; }
type Value = number | string | null | undefined;
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function check(s: Cooked, cooked: readonly (string | undefined)[], raw: readonly string[]): void {
  exact(s, cooked); exact(s.raw, raw); same(Array.isArray(s), true); same(Array.isArray(s.raw), true);
  same(Object.isFrozen(s), true); same(Object.isFrozen(s.raw), true); same(s === s.raw, false);
}
const seen: Cooked[] = [];
const site: Cooked = Object.freeze(Object.assign([undefined, "", undefined, "ok", undefined], { raw: Object.freeze(["\\xZ", "", "\\u{110000}", "ok", "\\8"]) }));
function inspect<T extends Value>(value: T, text: string): void {
  const log: unknown[] = [];
  function tag(s: Cooked, ...values: T[]): string {
    check(s, [undefined, "", undefined, "ok", undefined], ["\\xZ", "", "\\u{110000}", "ok", "\\8"]);
    if (seen.length > 0) { same(s, seen[0]); same(s.raw, seen[0].raw); } seen.push(s);
    exact(values, [value, value, value, value]); let result = "";
    for (let i = 0; i < s.length; i++) { log.push(s[i], typeof s[i], s.raw[i]); result += s.raw[i]; if (i < values.length) result += String(values[i]); }
    log.push(...values, result); return result;
  }
  const expected = "\\xZ" + text + text + "\\u{110000}" + text + "ok" + text + "\\8";
  same(tag(site, value, value, value, value), expected);
  exact(log, [undefined, "undefined", "\\xZ", "", "string", "", undefined, "undefined", "\\u{110000}", "ok", "string", "ok", undefined, "undefined", "\\8", value, value, value, value, expected]);
}
const rows: [Value, string][] = [[-0, "0"], [NaN, "NaN"], ["", ""], ["undefined", "undefined"], [undefined, "undefined"], [null, "null"]];
for (const [value, text] of rows) inspect(value, text);
