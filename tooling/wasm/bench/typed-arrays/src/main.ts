// Typed-array kernels: each export takes an iteration count and touches one
// element per iteration, over a 1024-element window, so a time divided by the
// count is the cost of one element access. Wasm keeps a buffer's bytes in one
// byte array, so a byte is one read and a double is eight.

export function byteReads(n: number): number {
  const xs = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) xs[i] = i;
  let total = 0;
  for (let k = 0; k < n; k++) total += xs[k & 1023]!;
  return total;
}

export function byteWrites(n: number): number {
  const xs = new Uint8Array(1024);
  for (let k = 0; k < n; k++) xs[k & 1023] = k;
  return xs[5]! + xs[1000]!;
}

export function intReads(n: number): number {
  const xs = new Int32Array(1024);
  for (let i = 0; i < 1024; i++) xs[i] = i * 65537;
  let total = 0;
  for (let k = 0; k < n; k++) total = (total + xs[k & 1023]!) | 0;
  return total;
}

export function doubleReads(n: number): number {
  const xs = new Float64Array(1024);
  for (let i = 0; i < 1024; i++) xs[i] = i * 0.5;
  let total = 0;
  for (let k = 0; k < n; k++) total += xs[k & 1023]!;
  return total;
}

export function doubleWrites(n: number): number {
  const xs = new Float64Array(1024);
  for (let k = 0; k < n; k++) xs[k & 1023] = k * 0.25;
  return xs[5]! + xs[1000]!;
}
