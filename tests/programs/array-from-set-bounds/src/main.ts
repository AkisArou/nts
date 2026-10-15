// The collection's output position counts live entries, not table slots.
// Deleting an entry makes the cursor and the output position disagree.
export function fromSet(seed: number): number {
  const values = new Set<number>();
  const first = seed & 15;
  for (let i = 0; i < 8; i++) values.add(first + i);
  values.delete(first + 1);
  values.delete(first + 4);
  const result = Array.from(values);
  return result.length * 1000 + result[0] * 10 + result[result.length - 1];
}

export function fromEmptySet(seed: number): number {
  const values = new Set<number>();
  values.add(seed);
  values.delete(seed);
  return Array.from(values).length;
}

export function fromMapValues(seed: number): number {
  const values = new Map<number, number>();
  values.set(0, seed);
  values.set(1, seed + 2);
  values.set(2, seed + 4);
  values.delete(1);
  const result = Array.from(values.values());
  return result.length * 1000 + result[0] + result[1];
}

// Control: supplying a mapper leaves this slice's no-callback proof disabled.
// A mapper that mutates the source is a separate recorded semantic defect;
// this mapper agrees with node both before and after the bounds change.
export function fromMappedSet(seed: number): number {
  const values = new Set<number>();
  const first = seed & 15;
  for (let i = 0; i < 8; i++) values.add(first + i);
  values.delete(first + 1);
  values.delete(first + 4);
  const result = Array.from(values, (value, index) => value + index);
  return result.length * 1000 + result[0] * 10 + result[result.length - 1];
}
