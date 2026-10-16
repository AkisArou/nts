// A floating index needs the whole/range guard even when its conversion
// after that guard is cheap. The control explicitly converts before indexing.
export function readAt(at: number): number {
  const xs = [11, 22, 33];
  return xs[at]!;
}
export function optionalAt(at: number): number {
  const xs = [11, 22, 33];
  return xs[at] ?? -1;
}
export function convertedAt(at: number): number {
  const xs = [11, 22, 33];
  return xs[at | 0] ?? -1;
}
// Both an existing slot and the append arm must dominate the conversion.
export function writeAt(at: number, value: number): number {
  const xs = [11, 22, 33];
  xs[at] = value;
  return xs[at]!;
}
export function writeLength(at: number, value: number): number {
  const xs = [11, 22, 33];
  xs[at] = value;
  return xs.length;
}
// Numeric conversion without a GC-array proof stays total for IEEE values.
export function integerBits(value: number): number {
  return value | 0;
}
// Exposing this buffer keeps Int16Array on the byte-backed path.
export function byteBacked(at: number, value: number): number {
  const xs = new Int16Array(3);
  const view = new DataView(xs.buffer);
  view.setInt16(0, 123, true);
  xs[at] = value;
  return xs[at] ?? -1;
}
