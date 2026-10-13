// The erased-values benchmark's program: strings and numbers stored as
// `unknown` and read back by `typeof`, in loops the compiler emits, against
// node running the same TypeScript. Each export takes an iteration count and
// returns a number both arms must agree on.

function pick(i: number): unknown {
  return (i & 1) === 0 ? 'even' : 'odd!';
}

// Erase a string every iteration, then narrow it back and read its length.
export function eraseStrings(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const value = pick(i);
    if (typeof value === 'string') total += value.length;
  }
  return total;
}

// A mixed pool read through typeof: strings and numbers side by side.
export function mixedPool(n: number): number {
  const pool: unknown[] = ['a', 2, 'bcd', 4.5];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const value = pool[i & 3];
    if (typeof value === 'string') total += value.length;
    else if (typeof value === 'number') total += value;
  }
  return total;
}

// Strict equality between erased strings.
export function equalStrings(n: number): number {
  const a: unknown = 'same';
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const b: unknown = (i & 3) === 0 ? 'same' : 'other';
    if (a === b) hits++;
  }
  return hits;
}

function widen(value: unknown): unknown {
  return value;
}

// Numbers only, as erasure-unknown carries them: no string is erased, so this
// prices what the string representation adds to every other tag test. Once
// the core forwards `widen` and folds the round trip, this loop has no
// erasure left; storedNumbers keeps one.
export function eraseNumbers(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const value = widen(i & 1023);
    if (typeof value === 'number') total += value;
  }
  return total;
}

// Numbers whose erasure escapes into an `unknown[]`, so no fold can remove it:
// each is erased once, stored, and read back through `typeof`.
export function storedNumbers(n: number): number {
  const pool: unknown[] = [0, 0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (let i = 0; i < n; i++) {
    pool[i & 7] = i & 1023;
    const value = pool[(i + 3) & 7];
    if (typeof value === 'number') total += value;
  }
  return total;
}
