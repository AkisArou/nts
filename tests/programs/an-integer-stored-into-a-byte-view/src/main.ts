// An integer stored into a `Uint8Array` or an `Int8Array` element is that
// integer's low eight bits. The prepared HIR spelled it as a number: `convert`
// the `i32` to `f64`, then `nts_to_uint8` (or `nts_to_int8`) of that --
// ToUint8 of a double -- so the JVM ran a whole ToInt32 for every byte
// `node-utf8`'s encoder writes, and C was quick only because clang folds
// `(double)i` and the range test back into a cast.
//
// `storeInts` stores integers, which need no conversion at all; `storeNumbers`
// is the control, the same stores of numbers that are not integers --
// fractions, NaN, and values past 2^32 -- which need ToUint8 and keep the call.
//
// expect-ir: all: no call.extern(nts_to_uint8) in storeInts
// expect-ir: all: no call.extern(nts_to_int8) in storeInts
// expect-ir: all: count call.extern(nts_to_uint8) in storeNumbers >= 1
// expect-ir: all: count call.extern(nts_to_int8) in storeNumbers >= 1

function text(bytes: Uint8Array, signed: Int8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i] + "/" + signed[i] + " ";
  return out;
}

export function storeInts(n: number): string {
  const bytes = new Uint8Array(6);
  const signed = new Int8Array(6);
  for (let i = 0; i < 6; i++) {
    // An `i32` that spans negatives and values past a byte: 300, -1, 0x1ff.
    const v = ((n * 97 + i * 131) | 0) ^ 0x155;
    bytes[i] = v;
    signed[i] = v;
  }
  return text(bytes, signed);
}

export function storeNumbers(n: number): string {
  const bytes = new Uint8Array(6);
  const signed = new Int8Array(6);
  for (let i = 0; i < 6; i++) {
    const v = i === 0 ? n / 0 * 0 : i === 1 ? 4294967296 * 3 + 300 + n : n * 0.37 + i * 1.5 - 3;
    bytes[i] = v;
    signed[i] = v;
  }
  return text(bytes, signed);
}
