// Even a numeric receiver exposes the recursive generic FlatArray<Arr, Depth>
// declaration. Only its reached, instantiated result needs a complete shape.
export function depthOne(n: number): number {
  const values = [n, n + 1, n + 2].flat(1);
  return values[0] + values[1] + values[2];
}
export function depthTwo(n: number): number {
  const values = [n, n + 1, n + 2].flat(2);
  return values[0] + values[1] + values[2];
}
export function control(n: number): number {
  const values = [n, n + 1, n + 2];
  return values[0] + values[1] + values[2];
}
