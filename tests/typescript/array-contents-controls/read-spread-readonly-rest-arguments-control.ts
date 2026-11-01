/*---
description: Control for read-spread-readonly-rest-arguments; every alias uses the same mutable array element type.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown, ts-spread, ts-readonly, ts-rest-parameters]
---*/
// Paired case: ../array-contents/read-spread-readonly-rest-arguments.ts.
// Only declared array types change; executable operations and assertions are identical.
type ArrayReadValue = number | string | undefined;
function collect(...values: ArrayReadValue[]): ArrayReadValue[] { return values; }
function check(n: number): void {
  const text = String(n);
  const xs: ArrayReadValue[] = [n + 1, -0, NaN];
  const reader: ArrayReadValue[] = xs;
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const received = collect(...reader);
  assert.sameValue(received.length, 6);
  assert.compareArray<unknown>(received, [n + 1, -0, NaN, text, undefined, undefined]);
  const types: string[] = [], owns: boolean[] = [], present: boolean[] = [];
  for (const i of [0, 1, 2, 3, 4, 5]) {
    types.push(typeof received[i]); owns.push(Object.hasOwn(received, i)); present.push(i in received);
  }
  assert.compareArray(types, ["number", "number", "number", "string", "undefined", "undefined"]);
  assert.compareArray(owns, [true, true, true, true, true, true]);
  assert.compareArray(present, [true, true, true, true, true, true]);
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
