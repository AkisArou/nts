// `xs.slice()` and `xs.concat()` with nothing: a copy of the whole array, and
// `s.slice()` and `s.concat()`: the string.
//
// A built-in's omitted argument was padded with "to the end", an Infinity,
// which is right for the *second* -- `slice(1)` runs to the end -- and was
// used for the first too. `xs.slice()` became `xs.slice(Infinity, Infinity)`,
// an empty array, and `"abc".slice()` the empty string; `xs.concat()` passed
// that Infinity where the array to append goes, and its C did not compile.
// The language converts an absent start as it converts `undefined`, to 0.
// `absent_argument` in the lowering is now the one table of what each omitted
// argument is.

interface Item {
  x: number;
}

export function numbersSliced(n: number): number {
  const xs = [n, n + 1, n + 2];
  const copy = xs.slice();
  copy[0] = -1;
  return copy.length * 100 + xs[0] + copy[2];
}

export function objectsSliced(n: number): number {
  const xs: Item[] = [{ x: n }, { x: n * 2 }];
  const copy = xs.slice();
  return copy.length * 100 + copy[1].x;
}

export function stringsSliced(n: number): string {
  const xs = ["a", "b", String(n)];
  return xs.slice().join("|");
}

export function numbersConcatenated(n: number): number {
  const xs = [n, n + 1];
  const copy = xs.concat();
  copy[1] = 0;
  return copy.length * 100 + xs[1];
}

export function objectsConcatenated(n: number): number {
  const xs: Item[] = [{ x: n }];
  return xs.concat().length * 100 + xs.concat()[0].x;
}

export function stringSliced(n: number): string {
  return ("ab" + String(n)).slice();
}

export function stringConcatenated(n: number): string {
  return ("ab" + String(n)).concat();
}

// Still "to the end" where the second is what is missing.
export function fromOneOn(n: number): number {
  return [n, n + 1, n + 2].slice(1).length + ("abc" + String(n)).slice(1).length;
}
