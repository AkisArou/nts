// Source control for builtin-study-es-atomics. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
function sourceAdd(value: Int32Array, index: number, increment: number): number {
  const previous = value[index]; value[index] = previous + increment; return previous;
}

export function esAtomicsControl(): number {
  const a = new Int32Array(2); const previous = sourceAdd(a, 0, 1); return previous * 10 + a[0] + new ArrayBuffer(8).byteLength;
}
