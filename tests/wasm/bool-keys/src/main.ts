// Boolean keys in a Map and a Set, against node: stored as the i32 they
// are, hashed apart, and read back through iteration in insertion order.
export function grouped(seed: number): number {
  const groups = new Map<boolean, number[]>();
  for (let i = 0; i < 6; i++) {
    const even = (seed + i) % 2 === 0;
    const group = groups.get(even);
    if (group) group.push(i);
    else groups.set(even, [i]);
  }
  let total = groups.size;
  for (const [even, items] of groups) {
    total += (even ? 100 : 0) + items.length;
  }
  total += (groups.get(true)?.length ?? -1) * 7;
  total += groups.has(seed % 2 === 0) ? 3 : 0;
  groups.delete(true);
  return total + groups.size;
}
export function flags(seed: number): number {
  const seen = new Set<boolean>();
  seen.add(seed > 0);
  seen.add(seed > 1);
  seen.add(seed > 0);
  let total = seen.size;
  for (const flag of seen) total += flag ? 10 : 1;
  return total + (seen.has(false) ? 100 : 0);
}
export function erasedKey(seed: number): number {
  const holder = new Map<boolean, number>();
  const key: any = seed > 1;
  holder.set(key, seed + 5);
  holder.set(key, seed + 9);
  return (holder.get(key) ?? -1) - seed + holder.size;
}
