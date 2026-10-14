// `xs.length = n` -- truncation, which JavaScript does in place.
//
// Every one of the 62 sites in `runtime/` is this shape: a loop writes
// survivors to a `write` cursor and then cuts the tail. The reference arm is
// the one that matters for the runtime -- `nts_array_set_length_ref` has to
// release what it drops, because `splice` beside it only avoids that by
// *moving* the dropped run into the array it returns.

/** Under test: truncating an array of numbers, the corpus's compaction shape. */
export function compactNumbers(n: number): number {
  const xs: number[] = [1, 2, 3, 4, 5, 6];
  let write = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] % 2 === 0) { xs[write] = xs[i]; write++; }
  }
  xs.length = write;
  let total = 0;
  for (const v of xs) total += v;
  return total * 10 + xs.length + (n & 0);
}

/** Under test: an array of references, where the dropped run must be released. */
export function compactStrings(n: number): number {
  const xs: string[] = ["aa", "b", "ccc", "d"];
  let write = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i].length > 1) { xs[write] = xs[i]; write++; }
  }
  xs.length = write;
  let total = 0;
  for (const v of xs) total += v.length;
  return total * 10 + xs.length + (n & 0);
}

/** Under test: truncating to zero, and the length read after it. */
export function toZero(n: number): number {
  const xs: number[] = [1, 2, 3];
  xs.length = 0;
  return xs.length * 100 + (n & 3);
}
