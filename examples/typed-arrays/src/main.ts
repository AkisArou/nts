// A typed array is an ordinary array whose element width was *written down*
// rather than inferred. `hir::elements` proves that a `number[]` of small whole
// numbers can be an `int32_t[]`; `Int32Array` is the same storage, chosen by
// the author. So this needs no new representation -- the descriptors, the
// bounds checks and the escape analysis already work on one.
//
// What is new is the *store*. `u8[i] = v` is not a cast: ECMAScript truncates
// toward zero and takes the result modulo the width, and every non-finite value
// becomes zero. Each function below is driven over a pool that includes NaN,
// negative zero, fractions and values past the width, which is the whole point
// of comparing against node rather than reasoning about it.

export function storeU8(v: number): number {
  const xs = new Uint8Array(4);
  xs[0] = v;
  return xs[0]!;
}

export function storeI8(v: number): number {
  const xs = new Int8Array(4);
  xs[0] = v;
  return xs[0]!;
}

export function storeU16(v: number): number {
  const xs = new Uint16Array(4);
  xs[0] = v;
  return xs[0]!;
}

export function storeI16(v: number): number {
  const xs = new Int16Array(4);
  xs[0] = v;
  return xs[0]!;
}

export function storeI32(v: number): number {
  const xs = new Int32Array(4);
  xs[0] = v;
  return xs[0]!;
}

export function storeU32(v: number): number {
  const xs = new Uint32Array(4);
  xs[0] = v;
  return xs[0]!;
}

export function storeF32(v: number): number {
  const xs = new Float32Array(4);
  xs[0] = v;
  return xs[0]!;
}

export function storeF64(v: number): number {
  const xs = new Float64Array(4);
  xs[0] = v;
  return xs[0]!;
}

// A read feeds arithmetic typed in `number`, so the conversion out of the
// narrow element has to be there and has to be the identity in value.
export function sumsBytes(seed: number): number {
  const xs = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    xs[i] = seed + i;
  }
  let total = 0;
  for (let i = 0; i < 16; i++) {
    total = total + xs[i]!;
  }
  return total;
}

// Wrapping is observable across a loop: every store past 255 comes back
// reduced, and the sum is not the sum of what was written.
export function wrapsWhileCounting(seed: number): number {
  const xs = new Uint8Array(8);
  let total = 0;
  for (let i = 0; i < 8; i++) {
    xs[i] = seed * i;
    total = total + xs[i]!;
  }
  return total;
}

export function length(): number {
  return new Uint8Array(37).length;
}

// Zero-filled at allocation, like `new Array(n)`.
export function startsZeroed(): number {
  const xs = new Int16Array(8);
  let total = 0;
  for (let i = 0; i < 8; i++) {
    total = total + xs[i]!;
  }
  return total;
}
