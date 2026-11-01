// Control for tests/programs/an-instanceof-of-a-weak-collection-the-program-never-names:
// the same test without the weak collections.
function kind(value: object): number {
  if (value instanceof Map) return 3;
  return 0;
}
export function probe(n: number): number {
  const held: object = n > 0 ? new Map<number, number>([[n, n]]) : [n];
  return kind(held) * 10 + n;
}
