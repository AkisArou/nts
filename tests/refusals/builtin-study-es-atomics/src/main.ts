// expect: NTS1001
// The archived study combines shared storage and an atomic operation. Each pair
// below changes one of those causes while holding its other inputs fixed.
function sourceAdd(value: Int32Array, index: number, increment: number): number {
  const previous = value[index]; value[index] = previous + increment; return previous;
}
export function subjectShared(): void {
  const value = new SharedArrayBuffer(8); console.log("bytes", value.byteLength);
}
export function controlShared(): void {
  const value = new ArrayBuffer(8); console.log("bytes", value.byteLength);
}
export function subjectAtomic(): void {
  const value = new Int32Array(2); console.log("previous", Atomics.add(value, 0, 1));
}
export function controlAtomic(): void {
  const value = new Int32Array(2); console.log("previous", sourceAdd(value, 0, 1));
}
