/*---
description: A generic typed tag observes every ordinary escape in complete cooked and raw arrays.
features: [ts-template-routes, ts-template-route-escapes-raw, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-objects, ts-unknown, ts-interfaces, ts-readonly, ts-unions, ts-numbers, ts-null-undefined, ts-tuples, ts-generics, ts-generic-constraints, ts-conversions, ts-interface-extends, ts-closures, ts-tagged-templates, ts-template-literals]
---*/
// Generic tag: union values cross a typed parameter; node preserves source spellings in raw, cooks every escape, caches both arrays and returns both exact strings.
interface Cooked extends ReadonlyArray<string | undefined> { readonly raw: readonly string[]; }
type Value = number | string | boolean | null | undefined;
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function check(s: Cooked, cooked: readonly (string | undefined)[], raw: readonly string[]): void {
  exact(s, cooked); exact(s.raw, raw); same(Array.isArray(s), true); same(Array.isArray(s.raw), true);
  same(Object.isFrozen(s), true); same(Object.isFrozen(s.raw), true); same(s === s.raw, false);
}
const seen: Cooked[] = [];
function inspect<T extends Value>(value: T, text: string): void {
  const log: unknown[] = [];
  function tag(s: Cooked, observed: T): { cooked: string; raw: string } {
    same(observed, value); check(s, ["\n|A|A|\ud83d\ude00|\\|`|${|", "|\t|\b|\f|\r|\u000b|\u0000|A"], ["\\n|\\x41|A|\\u{1F600}|\\\\|\\`|\\${|", "|\\t|\\b|\\f|\\r|\\v|\\0|\\u0041"]);
    if (seen.length > 0) { same(s, seen[0]); same(s.raw, seen[0].raw); } seen.push(s);
    const cooked = String(s[0]) + String(observed) + String(s[1]);
    const raw = s.raw[0] + String(observed) + s.raw[1]; log.push("tag", observed, cooked, raw); return { cooked, raw };
  }
  const result = tag`\n|\x41|A|\u{1F600}|\\|\`|\${|${value}|\t|\b|\f|\r|\v|\0|\u0041`;
  same(result.cooked, "\n|A|A|\ud83d\ude00|\\|`|${|" + text + "|\t|\b|\f|\r|\u000b|\u0000|A"); same(result.raw, "\\n|\\x41|A|\\u{1F600}|\\\\|\\`|\\${|" + text + "|\\t|\\b|\\f|\\r|\\v|\\0|\\u0041");
  exact(log, ["tag", value, "\n|A|A|\ud83d\ude00|\\|`|${|" + text + "|\t|\b|\f|\r|\u000b|\u0000|A", "\\n|\\x41|A|\\u{1F600}|\\\\|\\`|\\${|" + text + "|\\t|\\b|\\f|\\r|\\v|\\0|\\u0041"]);
}
const rows: [Value, string][] = [[-0, "0"], [NaN, "NaN"], ["", ""], ["\ud800", "\ud800"], [undefined, "undefined"], [null, "null"], [true, "true"]];
for (const pass of [0, 1]) { same(typeof pass, "number"); for (const [value, text] of rows) inspect(value, text); }
