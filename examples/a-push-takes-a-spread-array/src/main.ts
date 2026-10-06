// `xs.push(...ys)`: every element of `ys` appended in order, through the
// same helper one argument takes. React's `queueRecoverableErrors` is this
// line, and it stood at the end of the render path's refusal chain.
//
// `selfSpread` is the case the loop has to get right: the spread is evaluated
// before the call, so `xs.push(...xs)` appends the elements `xs` had, once.

class Item { constructor(public n: number) {} }
export function numbers(k: number): number {
  const xs = [1, 2];
  const ys = [k, k + 1, k + 2];
  const length = xs.push(...ys);
  return length * 1000 + xs[4] + xs[2];
}
export function selfSpread(k: number): number {
  const xs = [k, 2];
  xs.push(...xs);
  return xs.length * 100 + xs[2] + xs[3];
}
export function objects(k: number): number {
  const xs: Item[] = [new Item(1)];
  const ys = [new Item(k), new Item(k * 2)];
  xs.push(...ys);
  return xs.length * 1000 + xs[2].n;
}
export function strings(k: number): number {
  const xs: (string | null)[] = ["a"];
  const ys: (string | null)[] = [null, "bc" + k];
  xs.push(...ys, "d");
  return xs.length * 100 + (xs[1] === null ? 10 : 0) + (xs[2] as string).length;
}
export function empty(k: number): number {
  const xs = [k];
  const ys: number[] = [];
  return xs.push(...ys);
}
