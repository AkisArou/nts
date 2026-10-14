// Array operations node's modules lean on. Each answers a number.

/** pop returns the last and shortens. */
export function popReturnsLast(): number {
  const xs = [1, 2, 3];
  const last = xs.pop();
  return (last ?? -1) * 10 + xs.length;
}

/** shift returns the first and shortens. */
export function shiftReturnsFirst(): number {
  const xs = [1, 2, 3];
  const first = xs.shift();
  return (first ?? -1) * 10 + xs.length;
}

/** unshift prepends and returns the new length. */
export function unshiftPrepends(): number {
  const xs = [2, 3];
  const n = xs.unshift(1);
  return n * 10 + (xs[0] ?? -1);
}

/** splice removes and returns what it removed. */
export function spliceRemoves(): number {
  const xs = [1, 2, 3, 4];
  const removed = xs.splice(1, 2);
  return removed.length * 10 + xs.length;
}

/** slice is a copy, not a view. */
export function sliceIsACopy(): number {
  const xs = [1, 2, 3];
  const s = xs.slice(0, 2);
  s[0] = 9;
  return (xs[0] ?? -1) * 10 + (s[0] ?? -1);
}

/** reverse mutates in place and returns the same array. */
export function reverseInPlace(): number {
  const xs = [1, 2, 3];
  const r = xs.reverse();
  return (xs[0] ?? -1) * 10 + (r === xs ? 1 : 0);
}

/** indexOf finds the first occurrence. */
export function indexOfFirst(): number {
  return [5, 6, 5].indexOf(5);
}

/** lastIndexOf finds the last. */
export function lastIndexOfLast(): number {
  return [5, 6, 5].lastIndexOf(5);
}

/** includes finds a value. */
export function includesFinds(): number {
  return [1, 2, 3].includes(2) ? 1 : 0;
}

/** pop on an empty array gives undefined and leaves length 0. */
export function popEmpty(): number {
  const xs: number[] = [];
  const v = xs.pop();
  return (v === undefined ? 1 : 0) * 10 + xs.length;
}

/** fill writes a range. */
export function fillRange(): number {
  const xs = [0, 0, 0];
  xs.fill(7, 1);
  return (xs[0] ?? -1) * 100 + (xs[1] ?? -1) * 10 + (xs[2] ?? -1);
}
