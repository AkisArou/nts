/*---
description: Control for a typed field crosses physical LF and CRLF continuations with normalized raw line endings.
features: [ts-template-routes, ts-template-route-escapes-raw, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-objects, ts-unknown, ts-interfaces, ts-readonly, ts-unions, ts-interface-extends, ts-closures]
---*/
// Plain control: Pass one frozen cooked/raw array written using ordinary escaped string literals to the same tag; physical source continuations and template syntax are absent.
interface Cooked extends ReadonlyArray<string | undefined> { readonly raw: readonly string[]; }
interface Field { value: string; }
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function check(s: Cooked, cooked: readonly (string | undefined)[], raw: readonly string[]): void {
  exact(s, cooked); exact(s.raw, raw); same(Array.isArray(s), true); same(Array.isArray(s.raw), true);
  same(Object.isFrozen(s), true); same(Object.isFrozen(s.raw), true); same(s === s.raw, false);
}
const seen: Cooked[] = [];
const site: Cooked = Object.freeze(Object.assign(["ab", "cd\ne\nf"], { raw: Object.freeze(["a\\\nb", "c\\\nd\ne\nf"]) }));
function inspect(field: Field, expected: string): void {
  const log: unknown[] = [];
  function tag(s: Cooked, value: string): string {
    same(value, expected); same(field.value, expected); check(s, ["ab", "cd\ne\nf"], ["a\\\nb", "c\\\nd\ne\nf"]);
    if (seen.length > 0) { same(s, seen[0]); same(s.raw, seen[0].raw); } seen.push(s);
    const result = String(s[0]) + value + String(s[1]); log.push(value, s[0], s[1], s.raw[0], s.raw[1], result); return result;
  }
  const result = tag(site, field.value);
  same(result, "ab" + expected + "cd\ne\nf"); exact(log, [expected, "ab", "cd\ne\nf", "a\\\nb", "c\\\nd\ne\nf", "ab" + expected + "cd\ne\nf"]);
}
for (const input of ["", "x", "\n", "\r\n", "\u2028", "\ud800", "\ud83d\ude00"]) inspect({ value: input }, input);
