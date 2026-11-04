/*---
description: "Control: setFloat16 through assigned class fields; node captures arguments, converts offset then value, and checks bounds before writing."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-functions, ts-iteration, ts-typeof-operator, ts-class, ts-class-fields, ts-this, ts-objects, ts-unions, ts-null-undefined, ts-unknown, ts-narrowing, ts-errors, ts-closures, ts-symbols, ts-bigint, ts-to-primitive, ts-conversions, ts-unsound-object-assign, ts-spread]
---*/
// setFloat16 through assigned class fields; node captures arguments, converts offset then value, and checks bounds before writing.
const log: string[] = [];
class HalfRequest {
  view: DataView; offset: number = 0; value: number = 0; little: boolean = false;
  constructor(view: DataView) { log.push("construct"); this.view = view; }
  write(bits: number): void { log.push("write"); const view = this.view, rawIndex = this.offset, rawValue = this.value, little = this.little;
    const numeric = +rawIndex, index = Number.isNaN(numeric) ? 0 : Math.trunc(numeric);
    if (index < 0 || index > Number.MAX_SAFE_INTEGER) throw new RangeError();
    const converted = +rawValue;
    return view.setUint16(index, bits, little); }
}
const rows: [string, unknown, unknown, number, number | undefined, (new () => Error) | undefined, string[]][] = [
  ["ok", 1, 1.5, 0x3e00, 1, undefined, ["offset", "value"]], ["fraction", 1.9, 1.00048828125, 0x3c00, 1, undefined, ["offset", "value"]],
  ["negative-fraction", -0.9, -0, 0x8000, 0, undefined, ["offset", "value"]], ["nan-index", "x", 65520, 0x7c00, 0, undefined, ["offset", "value"]],
  ["fallback", 1, 1.5, 0x3e00, 1, undefined, ["offset", "offset-string", "value", "value-string"]],
  ["negative", -1, 1.5, 0x3e00, undefined, RangeError, ["offset"]], ["infinite", Infinity, 1.5, 0x3e00, undefined, RangeError, ["offset"]],
  ["bounds", 3, 1.5, 0x3e00, undefined, RangeError, ["offset", "value"]], ["offset-throw", 0, 1.5, 0x3e00, undefined, SyntaxError, ["offset"]],
  ["value-throw", 1, 1.5, 0x3e00, undefined, URIError, ["offset", "value"]], ["big-index", 1n, 1.5, 0x3e00, undefined, TypeError, ["offset"]],
  ["big-value", 1, 1n, 0x3e00, undefined, TypeError, ["offset", "value"]], ["symbol-value", 1, Symbol("value"), 0x3e00, undefined, TypeError, ["offset", "value"]]
];
for (const row of rows) for (const order of [false, true, undefined]) {
  log.length = 0; const buffer = new ArrayBuffer(8), bytes = new Uint8Array(buffer); bytes.fill(165);
  const view = new DataView(buffer, 2, 4), source = new HalfRequest(view), little = order !== false;
  const offset = { valueOf(): unknown { log.push("offset"); source.value = 9; if (row[0] === "offset-throw") throw new SyntaxError(); return row[0] === "fallback" ? {} : row[1]; }, toString(): string { log.push("offset-string"); return String(row[1]); } };
  const value = { valueOf(): unknown { log.push("value"); if (row[0] === "value-throw") throw new URIError(); return row[0] === "fallback" ? {} : row[2]; }, toString(): string { log.push("value-string"); return String(row[2]); } };
  const poison = { [Symbol.toPrimitive](hint: string): never { log.push("endian:" + hint); throw new Error(); } };
  Object.assign(source, { offset, value, little: order === undefined ? poison : order });
  let returned = false, result: void | string = "unreturned";
  function invoke(): void { log.push("invoke"); result = source.write(row[3]); returned = true; }
  if (row[5] === undefined) invoke(); else assert.throws(row[5], invoke);
  assert.compareArray(log, ["construct", "invoke", "write", ...row[6]]); assert.sameValue(returned, row[5] === undefined);
  assert.sameValue(Object.is(result, row[5] === undefined ? undefined : "unreturned"), true); assert.sameValue(typeof result, row[5] === undefined ? "undefined" : "string");
  assert.sameValue(source.value, 9); assert.sameValue(Object.is(source.offset, offset), true);
  assert.sameValue(Object.is(source.little, order === undefined ? poison : order), true);
  const expected: number[] = [165, 165, 165, 165, 165, 165, 165, 165];
  if (row[4] !== undefined) { expected[2 + row[4]] = little ? row[3] & 255 : row[3] >> 8; expected[3 + row[4]] = little ? row[3] >> 8 : row[3] & 255; }
  assert.compareArray(Array.from(bytes), expected); assert.sameValue(source.view, view);
  assert.sameValue(view.buffer, buffer); assert.sameValue(view.byteOffset, 2); assert.sameValue(view.byteLength, 4);
}
