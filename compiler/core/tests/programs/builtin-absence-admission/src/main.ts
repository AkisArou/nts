export function storage(n: number): number {
  const values = [n];
  // @ts-expect-error Null is stored, not converted by ToNumber.
  values.fill(null);
  return values[0];
}
export function position(n: number): number {
  const values = [n];
  // @ts-expect-error Only the index argument applies ToNumber(null).
  return values.with(null, n)[0];
}
export function replacement(n: number): number {
  const values = [n];
  // @ts-expect-error The replacement is storage, not a ToNumber position.
  return values.with(n, null)[0];
}
