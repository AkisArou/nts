/*---
description: An own class cast to RegExpConstructor retains its source and test method.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-strings, ts-instanceof]
---*/
// Route: a class is asserted to be RegExp; node calls the own exact-string test.
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
  const Target = OwnPattern as unknown as typeof RegExp;
  const value = new Target(pattern);
  assert.sameValue(calls, 1);
  assert.sameValue(value.source, "own:" + pattern);
  assert.sameValue(value.test(text), false);
  assert.sameValue(value.test(pattern), true);
  assert.sameValue(value instanceof OwnPattern, true);
  assert.sameValue(value instanceof RegExp, false);
}
for (const text of ["a", "bb", "c7", "tail"]) check(text);
