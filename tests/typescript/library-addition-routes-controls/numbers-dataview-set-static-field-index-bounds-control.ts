/*---
description: "Control: setFloat16 through a static receiver field; node truncates legal indices and throws RangeError without partial writes."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-functions, ts-iteration, ts-typeof-operator, ts-class, ts-class-fields, ts-static, ts-this, ts-unions, ts-null-undefined, ts-narrowing, ts-errors, ts-closures]
---*/
// setFloat16 through a static receiver field; node truncates legal indices and throws RangeError without partial writes.
const log: string[] = [];
class Source {
  static view: DataView = new DataView(new ArrayBuffer(0));
  static write(offset: number, value: number, bits: number, little: boolean): void { log.push("write"); return this.view.setUint16(offset, bits, little); }
}
const indices: [number, number | undefined][] = [[0, 0], [-0, 0], [-0.9, 0], [NaN, 0], [0.9, 0], [1.9, 1], [4, 4], [4.9, 4], [-1, undefined], [5, undefined], [6, undefined], [Infinity, undefined], [-Infinity, undefined], [4294967296, undefined], [9007199254740992, undefined]];
const rows: [number, number][] = [[-0, 0x8000], [1.5, 0x3e00], [1.00048828125, 0x3c00], [65520, 0x7c00]];
for (const [offset, slot] of indices) for (const [value, bits] of rows) for (const little of [false, true]) {
  log.length = 0;
  const buffer = new ArrayBuffer(10), bytes = new Uint8Array(buffer); bytes.fill(165);
  const view = new DataView(buffer, 2, 6); Source.view = view;
  let result: void | string = "unreturned";
  function invoke(): void { log.push("invoke"); result = Source.write(offset, value, bits, little); }
  if (slot === undefined) assert.throws(RangeError, invoke); else invoke();
  assert.compareArray(log, ["invoke", "write"]);
  assert.sameValue(Object.is(result, slot === undefined ? "unreturned" : undefined), true);
  assert.sameValue(typeof result, slot === undefined ? "string" : "undefined");
  const expected: number[] = [165, 165, 165, 165, 165, 165, 165, 165, 165, 165];
  if (slot !== undefined) { expected[2 + slot] = little ? bits & 255 : bits >> 8; expected[3 + slot] = little ? bits >> 8 : bits & 255; }
  assert.compareArray(Array.from(bytes), expected);
  assert.sameValue(Source.view, view); assert.sameValue(Source.view.buffer, buffer);
  assert.sameValue(Source.view.byteOffset, 2); assert.sameValue(Source.view.byteLength, 6);
}
