// An array that grows.
//
// The elements live in a block the array points at rather than inline after its
// header, because growing something inline means moving it -- and moving it
// invalidates every reference anyone holds. The array object itself never moves,
// so it can grow under a reference someone else is holding, which is what
// JavaScript promises.
//
// The pointer costs one load, and that load is loop-invariant: clang hoists it
// out of any loop that does not call something which could grow the array. The
// `arrays` benchmark measured the difference at nothing.

export function grow(n: number): number {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(i * 2);
  }
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    total = total + xs[i]!;
  }
  return total;
}

export function drain(n: number): number {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(i);
  }
  let total = 0;
  while (xs.length > 0) {
    total = total + xs.pop()!;
  }
  return total;
}

// A literal's length is a constant the analysis uses to prove indexes in
// bounds -- and it stops being one the moment something can push. The claim is
// given up for any array handed to a call, which this is.
export function lengthAfterPush(extra: number): number {
  const xs = [1, 2, 3];
  xs.push(extra);
  return xs.length;
}

// Growing under a reference someone else holds. The array object does not move,
// so `alias` sees the new elements.
export function sharedGrowth(n: number): number {
  const xs: number[] = [];
  const alias = xs;
  xs.push(n);
  xs.push(n + 1);
  return alias.length * 100 + alias[1]!;
}
