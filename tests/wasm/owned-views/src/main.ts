// Typed arrays whose kind owns its buffers: nothing here takes a `.buffer`,
// erases a view or builds one over an explicit ArrayBuffer, except Int16Array,
// which `exposed` below gives away on purpose. So the core may mark every
// other kind owned, and Wasm stores those views' elements in arrays of their
// own type; Int16Array stays on bytes, and `set` crosses between the two.

function doubles(n: number): Float64Array {
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = i * 1.5 - 4;
  return xs;
}

export function elements(v: number): number {
  const xs = doubles(8);
  xs[(v | 0) & 7] = v;
  let total = 0;
  for (let i = 0; i < xs.length; i++) total += xs[i]! * (i + 1);
  return total + xs.byteLength * 0.001 + xs.byteOffset;
}

// Narrow kinds store ToInt32's low bits; a float32 rounds.
export function narrowing(v: number): number {
  const bytes = new Uint8Array(2);
  const signed = new Int8Array(2);
  const ints = new Uint32Array(2);
  const singles = new Float32Array(2);
  bytes[0] = v;
  signed[0] = v;
  ints[0] = v;
  singles[0] = v;
  return bytes[0]! + signed[0]! * 3 + ints[0]! * 0.25 + (singles[0]! === singles[0]! ? singles[0]! : -1);
}

// A window shares the store at an element offset; a slice copies it.
export function windows(v: number): number {
  const xs = doubles(10);
  const from = (v | 0) % 12;
  const cut = xs.subarray(from, -1);
  if (cut.length > 0) cut[0] = 100;
  const copy = xs.slice(2, 6);
  xs[3] = -1;
  let total = 0;
  for (let i = 0; i < 10; i++) total = total * 3 + xs[i]!;
  return total + cut.length * 1000 + cut.byteOffset * 7 + copy[1]! * 0.5 + copy.length;
}

export function fills(v: number): number {
  const ints = new Int32Array(8);
  ints.fill(v * 1000, 1, -2);
  const singles = new Float32Array(4);
  singles.fill(v, -3);
  const bytes = new Uint8Array(6);
  bytes.fill(v);
  let total = 0;
  for (let i = 0; i < 8; i++) total = total * 3 + ints[i]!;
  for (let i = 0; i < 6; i++) total = total * 3 + bytes[i]!;
  return total % 1000000007 + (singles[1]! === singles[1]! ? singles[1]! : -1) + singles[0]!;
}

export function copiesWithin(v: number): number {
  const ints = new Int32Array(8);
  for (let i = 0; i < 8; i++) ints[i] = i * 11 + (v | 0);
  ints.copyWithin(2, 0, 5);
  ints.copyWithin(-2, -6, (v | 0) % 9);
  let total = 0;
  for (let i = 0; i < 8; i++) total = total * 5 + ints[i]!;
  return total % 1000000007;
}

export function joins(v: number): string {
  const singles = new Float32Array(3);
  singles[0] = v;
  singles[1] = 0.1;
  const bytes = new Int8Array(2);
  bytes[0] = -v;
  return singles.join("|") + "/" + bytes.join();
}

// One kind on both sides is a move, overlapping too; two kinds convert.
export function sets(v: number): number {
  const xs = doubles(8);
  xs.set(xs.subarray(0, 5), 2);
  const ints = new Int32Array(4);
  for (let i = 0; i < 4; i++) ints[i] = (i - 2) * (v | 0) * 1000;
  const singles = new Float32Array(4);
  singles.set(ints);
  const bytes = new Uint8Array(5);
  bytes.set(xs.subarray(4), (v | 0) & 1);
  let total = 0;
  for (let i = 0; i < 8; i++) total = total * 3 + xs[i]!;
  for (let i = 0; i < 5; i++) total = total * 3 + bytes[i]!;
  return total % 1000000007 + singles[0]! * 0.001 + singles[3]!;
}

// Int16Array is given away through `.buffer`, so it stays on bytes, and
// `set` crosses between an owned kind and a byte-backed one both ways.
export function exposed(v: number): number {
  const halves = new Int16Array(6);
  for (let i = 0; i < 6; i++) halves[i] = i * 1000 + (v | 0);
  const ints = new Int32Array(6);
  ints.set(halves);
  halves.set(doubles(3), 2);
  const raw = new Uint8Array(halves.buffer.slice(0, 2));
  let total = 0;
  for (let i = 0; i < 6; i++) total = total * 3 + ints[i]! + halves[i]!;
  return total % 1000000007 + raw.length;
}
