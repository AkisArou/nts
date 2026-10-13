// A `string | null` conditional erased into a declaration admitting both
// absences: the erasure says `null`, which the value is.
export function wider(n: number): number {
  const v: string | null | undefined = n < 10 ? null : "x";
  return v === null ? 1 : v === undefined ? 2 : 3;
}
