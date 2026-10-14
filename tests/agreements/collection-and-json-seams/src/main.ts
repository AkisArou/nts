// The operations node's own modules reach for constantly. Each answers a number.

/** for...of over an array visits every element in order. */
export function forOfOrder(): number {
  let out = 0;
  for (const n of [1, 2, 3]) out = out * 10 + n;
  return out;
}

/** Array.isArray on an array and on an object. */
export function isArrayDiscriminates(): number {
  const a: unknown = [1];
  const o: unknown = { a: 1 };
  return (Array.isArray(a) ? 1 : 0) * 10 + (Array.isArray(o) ? 1 : 0);
}

/** Object.keys returns own enumerable names in insertion order. */
export function objectKeysOrder(): number {
  const o: Record<string, number> = { b: 1, a: 2 };
  const keys = Object.keys(o);
  return keys.length * 10 + (keys[0] === "b" ? 1 : 0);
}

// `integerKeysFirst` lived here and now has its own case file,
// `integer-like-key-order`, with the two controls that place it: string keys
// alone keep insertion order and agree, and the key *count* is right either
// way, so it is the order and not the set.

/** JSON.stringify of a flat object. */
export function jsonStringifyFlat(): number {
  return JSON.stringify({ a: 1, b: 2 }).length;
}

/** JSON.stringify drops undefined values. */
export function jsonDropsUndefined(): number {
  const o: { a: number; b?: number } = { a: 1 };
  return JSON.stringify(o).length;
}

/** sort is by string order by default, not numeric. */
export function sortIsLexicographic(): number {
  const xs = [10, 9, 1];
  xs.sort();
  return (xs[0] ?? -1) * 100 + (xs[1] ?? -1) * 10 + (xs[2] ?? -1) / 10;
}

/** sort with a comparator is numeric. */
export function sortWithComparator(): number {
  const xs = [10, 9, 1];
  xs.sort((a, b) => a - b);
  return (xs[0] ?? -1) * 100 + (xs[1] ?? -1);
}

/** replace substitutes only the first occurrence without a global flag. */
export function replaceFirstOnly(): number {
  return "aXaXa".replace("X", "-").length;
}

/** join with a separator. */
export function joinWithSeparator(): number {
  return [1, 2, 3].join("-").length;
}

/** concat does not mutate. */
export function concatDoesNotMutate(): number {
  const a = [1];
  const b = a.concat([2]);
  return a.length * 10 + b.length;
}
