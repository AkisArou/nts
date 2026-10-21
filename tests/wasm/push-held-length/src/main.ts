// `push` reads its array's length once into a local, stores the element at
// it and writes the length once; storage grows only on the cold path, where
// the length has reached the backing's own. Pushed here across growth from
// empty and from a literal, for numbers, strings, references and open values,
// with push's answer read.

class Point {
  constructor(public x: number) {}
}

/** Numbers from empty, past several growths, and the length each push answers. */
export function numbers(seed: number): number {
  const xs: number[] = [];
  const n = 100 + ((seed | 0) & 7);
  let answered = 0;
  for (let i = 0; i < n; i++) answered += xs.push(i * 3 + seed);
  return answered + xs[xs.length - 1];
}

/** Strings onto a literal whose storage is exactly full. */
export function strings(seed: number): string {
  const xs: string[] = ["a", "b"];
  for (let i = 0; i < 5; i++) xs.push(String(i + seed));
  return xs.join(",");
}

/** References. */
export function points(seed: number): number {
  const xs: Point[] = [];
  for (let i = 0; i < 20; i++) xs.push(new Point(i * seed));
  let total = 0;
  for (const p of xs) total += p.x;
  return total;
}

/** Open values of every kind. */
export function open(seed: number): string {
  const xs: unknown[] = [null];
  xs.push(seed);
  xs.push("s");
  xs.push(undefined);
  xs.push(true);
  let kinds = "";
  for (const it of xs) kinds += typeof it + " ";
  return kinds + xs.length;
}
