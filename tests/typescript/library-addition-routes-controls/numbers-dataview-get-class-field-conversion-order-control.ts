/*---
description: "Control: getFloat16 through assigned class fields; node converts the index with number hint and retains the captured receiver."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-functions, ts-iteration, ts-typeof-operator, ts-class, ts-class-fields, ts-this, ts-objects, ts-unions, ts-null-undefined, ts-unknown, ts-narrowing, ts-errors, ts-closures, ts-symbols, ts-bigint, ts-to-primitive, ts-conversions, ts-unsound-object-assign]
---*/
// getFloat16 through assigned class fields; node converts the index with number hint and retains the captured receiver.
const log: string[] = [];
class HalfRequest {
  view: DataView; offset: number = 0; little: boolean = false;
  constructor(view: DataView) { log.push("construct"); this.view = view; }
  read(expected: number): number { log.push("read"); this.view.getUint16(this.offset, this.little); return expected; }
}
const rows: [string, unknown, number | undefined, number, number, (new () => Error) | undefined][] = [
  ["fraction", 1.9, 1, 0x3e00, 1.5, undefined], ["negative-fraction", -0.9, 0, 0x8000, -0, undefined],
  ["nan", NaN, 0, 0x0001, 5.960464477539063e-8, undefined], ["text", "4.9", 4, 0x7bff, 65504, undefined],
  ["undefined", undefined, 0, 0xfc00, -Infinity, undefined], ["negative", -1, undefined, 0, 0, RangeError],
  ["bounds", 5, undefined, 0, 0, RangeError], ["infinite", Infinity, undefined, 0, 0, RangeError],
  ["huge", 4294967296, undefined, 0, 0, RangeError], ["bigint", 1n, undefined, 0, 0, TypeError],
  ["symbol", Symbol("index"), undefined, 0, 0, TypeError], ["object", {}, undefined, 0, 0, TypeError], ["throw", 0, undefined, 0, 0, URIError]
];
for (const row of rows) for (const order of [false, true, undefined]) {
  log.length = 0; const buffer = new ArrayBuffer(10), bytes = new Uint8Array(buffer); bytes.fill(165);
  const view = new DataView(buffer, 2, 6), spare = new DataView(new ArrayBuffer(6)), little = order !== false;
  if (row[2] !== undefined) view.setUint16(row[2], row[3], little);
  const before = Array.from(bytes), source = new HalfRequest(view);
  const offset = { [Symbol.toPrimitive](hint: string): unknown { log.push("index:" + hint); source.view = spare; if (row[0] === "throw") throw new URIError(); return row[1]; }, valueOf(): never { log.push("valueOf"); throw new Error(); }, toString(): never { log.push("toString"); throw new Error(); } };
  const poison = { [Symbol.toPrimitive](hint: string): never { log.push("endian:" + hint); throw new Error(); } };
  Object.assign(source, { offset, little: order === undefined ? poison : order });
  let result: number | undefined = undefined;
  function invoke(): void { log.push("invoke"); result = source.read(row[4]); }
  if (row[5] === undefined) invoke(); else assert.throws(row[5], invoke);
  assert.compareArray(log, ["construct", "invoke", "read", "index:number"]);
  assert.sameValue(Object.is(result, row[5] === undefined ? row[4] : undefined), true);
  assert.sameValue(typeof result, row[5] === undefined ? "number" : "undefined");
  assert.compareArray(Array.from(bytes), before); assert.compareArray(Array.from(new Uint8Array(spare.buffer)), [0, 0, 0, 0, 0, 0]);
  assert.sameValue(source.view, spare); assert.sameValue(Object.is(source.offset, offset), true);
  assert.sameValue(Object.is(source.little, order === undefined ? poison : order), true);
  assert.sameValue(view.buffer, buffer); assert.sameValue(view.byteOffset, 2); assert.sameValue(view.byteLength, 6);
}
