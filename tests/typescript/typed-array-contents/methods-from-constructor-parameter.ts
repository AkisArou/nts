/*---
description: From through a typed Uint16Array constructor maps an ArrayLike source before unsigned conversion.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-arrow-functions, ts-tuples, ts-interfaces, ts-objects]
---*/
// Call from through a constructor parameter; node maps ArrayLike elements in order and wraps each uint16 result.
function check(factory: Uint16ArrayConstructor, n: number, expectedValue: number): void {
  const source: ArrayLike<number> = { 0: n, 1: -1, 2: 65536, length: 3 };
  const seen: number[] = [], indices: number[] = [];
  const view: Uint16Array = factory.from(source, (value, index) => {
    seen.push(value); indices.push(index);
    return value + index;
  });
  assert.compareArray(indices, [0, 1, 2]);
  const visited = [n, -1, 65536];
  for (let i = 0; i < visited.length; i++) assert.sameValue(Object.is(seen[i], visited[i]), true);
  const expected = [expectedValue, 0, 2];
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, 6);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const [n, expectedValue] of [[0, 0], [65535, 65535], [65536, 0]]) check(Uint16Array, n, expectedValue);
