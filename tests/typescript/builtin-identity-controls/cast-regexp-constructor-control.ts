/*---
description: Control for cast-regexp-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-strings, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-regexp-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnPattern {
  readonly source: string;
  readonly pattern: string;
  constructor(pattern: string) { calls++; this.pattern = pattern; this.source = "own:" + pattern; }
  test(text: string): boolean { return text === this.pattern; }
}
function check(text: string): void {
  calls = 0;
  const pattern = "^" + text + "$";
  const Target = RegExp;
  const value = new Target(pattern);
  assert.sameValue(calls, 0);
  assert.sameValue(value.source, pattern);
  assert.sameValue(value.test(text), true);
  assert.sameValue(value.test(pattern), false);
  assert.sameValue(value instanceof OwnPattern, false);
  assert.sameValue(value instanceof RegExp, true);
}
for (const text of ["a", "bb", "c7", "tail"]) check(text);
