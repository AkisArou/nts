/*---
description: Accessor effects on a Uint8Array view: the offset tracking view loses index 2 when its buffer shrinks to 3 bytes.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-accessors, ts-closures, ts-destructuring, ts-optional-properties]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the accessor route.
// The offset tracking view loses index 2 when its buffer shrinks to 3 bytes; node reads undefined after the change, otherwise 173.
function read(change: number): { value: number | undefined; signal: number } {
  const buffer = new ArrayBuffer(6, { maxByteLength: 10 });
  const view = new Uint8Array(buffer, 2);
  const index = 2;
  view[index] = 173;
  const gate = {
    get signal(): number { buffer.resize(3); return change + 5; }
  };
  const source: { signal?: number } = change > 0 ? {} : { signal: 9 };
  if (index < view.length) {
    const { signal = gate.signal } = source;
    return { value: view[index], signal };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? undefined : 173);
  assert.sameValue(result.signal, change > 0 ? change + 5 : 9);
}
