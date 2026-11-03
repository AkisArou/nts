/*---
description: "An enum-like const object read by keyof typeof keys through a Record retains property replacements instead of substituting its old literal values."
features: [ts-type-form-routes, ts-type-form-route-literal, ts-as-const, ts-keyof, ts-typeof-type, ts-indexed-access, ts-record, ts-readonly, ts-tuples, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-literal-types]
---*/
// as const supplies enum-like literal values behind a keyed Record; node reads current alias-written values at every lookup.
const Codes = { Zero: -0, Word: "north", Empty: undefined } as const;
type CodeKey = keyof typeof Codes;
const route: Record<"current", typeof Codes> = { current: Codes };
const writable: Record<CodeKey, unknown> = route.current;
const rows: [CodeKey, unknown, unknown][] = [["Zero", -0, "changed"], ["Word", "north", false], ["Empty", undefined, -0]];
for (const [key, initial, replacement] of rows) {
  const before: (typeof Codes)[CodeKey] = route.current[key];
  assert.sameValue(before, initial); assert.sameValue(typeof before, typeof initial);
  writable[key] = replacement;
  const after: (typeof Codes)[CodeKey] = route.current[key];
  assert.sameValue(after, replacement); assert.sameValue(typeof after, typeof replacement);
  assert.sameValue(route.current, Codes); assert.sameValue(writable, Codes);
}
assert.compareArray(Object.keys(Codes), ["Zero", "Word", "Empty"]);
