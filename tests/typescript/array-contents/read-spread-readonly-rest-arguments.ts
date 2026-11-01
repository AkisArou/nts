/*---
description: Spreading a readonly numeric view into typed rest parameters materializes hole reads as own undefined arguments.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown, ts-spread, ts-readonly, ts-rest-parameters]
---*/
// Write through a union alias; read by spreading a retained readonly view into typed rest parameters; node preserves actual values and sparse-slot behavior.
type ArrayReadValue = number | string | undefined;
function collect(...values: ArrayReadValue[]): ArrayReadValue[] { return values; }
function check(n: number): void {
  const text = String(n);
  const xs: number[] = [n + 1, -0, NaN];
  const reader: readonly number[] = xs;
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
