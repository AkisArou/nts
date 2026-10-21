// An integer stored into a sixteen- or thirty-two-bit integer element is that
// integer reduced to the element's width, as for a byte
// (`an-integer-stored-into-a-byte-view`): the store is the integer's wrap, not
// ToUint16 or ToInt32 of a double made from it. The values span negatives and
// both widths' ranges, so a mask, a sign extension or a reinterpretation that
// is wrong shows in the answer.
//
// `storeNumbers` is the control: the same stores of numbers that are not
// integers -- NaN, a value past 2^32, fractions -- which keep the runtime's
// conversion.
//
// expect-ir: all: no call.extern(nts_to_uint16) in storeInts
// expect-ir: all: no call.extern(nts_to_int16) in storeInts
// expect-ir: all: no call.extern(nts_to_uint32) in storeInts
// expect-ir: all: no call.extern(nts_to_int32) in storeInts
// expect-ir: all: count call.extern(nts_to_uint16) in storeNumbers >= 1
// expect-ir: all: count call.extern(nts_to_int16) in storeNumbers >= 1

function text(a: Uint16Array, b: Int16Array, c: Uint32Array, d: Int32Array): string {
  let out = "";
  for (let i = 0; i < a.length; i++) out += a[i] + "/" + b[i] + "/" + c[i] + "/" + d[i] + " ";
  return out;
}

export function storeInts(n: number): string {
  const a = new Uint16Array(6);
  const b = new Int16Array(6);
  const c = new Uint32Array(6);
  const d = new Int32Array(6);
  for (let i = 0; i < 6; i++) {
    // An `i32` past both sixteen-bit ranges and negative in half the cases.
    const v = ((n * 40503 + i * 2654435761) | 0) ^ 0x18001;
    a[i] = v;
    b[i] = v;
    c[i] = v;
    d[i] = v;
  }
  return text(a, b, c, d);
}

export function storeNumbers(n: number): string {
  const a = new Uint16Array(6);
  const b = new Int16Array(6);
  const c = new Uint32Array(6);
  const d = new Int32Array(6);
  for (let i = 0; i < 6; i++) {
    const v = i === 0 ? n / 0 * 0 : i === 1 ? 4294967296 * 3 + 70000 + n : n * 0.37 + i * 40000.5 - 99999;
    a[i] = v;
    b[i] = v;
    c[i] = v;
    d[i] = v;
  }
  return text(a, b, c, d);
}

