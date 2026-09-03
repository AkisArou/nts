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

// `shift` and `unshift`, which are `pop` and `push` at the other end.
//
// The other end costs a move: an array's elements are contiguous, so taking one
// off the front means moving the rest down. Seventeen `shift`s and sixteen
// `unshift`s in `runtime/node` are why these exist and `flat` does not.
export function shifted(n: number): number {
  const xs = [n, n + 1, n + 2, n + 3];
  const first = xs.shift() ?? -1;
  const second = xs.shift() ?? -1;
  return first * 1000 + second * 100 + xs.length * 10 + (xs[0] ?? -1);
}

// Shifting an empty array is `undefined`, not an error.
export function shiftedEmpty(n: number): number {
  const xs: number[] = [];
  const gone = xs.shift();
  return (gone ?? 77) + xs.length + n * 0;
}

export function unshifted(n: number): number {
  const xs = [n];
  const afterOne = xs.unshift(n + 1);
  const afterTwo = xs.unshift(n + 2);
  return afterOne * 10000 + afterTwo * 1000 + xs[0]! * 100 + xs[1]! * 10 + xs[2]!;
}

// Both, alternating, so the moves in each direction meet.
export function queue(n: number): number {
  const xs: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (i % 2 === 0) {
      xs.push(i + n);
    } else {
      xs.unshift(i + n);
    }
  }
  let total = 0;
  while (xs.length > 0) {
    total = total * 3 + (xs.shift() ?? 0);
  }
  return total;
}

// References, where `unshift` is consuming the way `push` is: the caller owes a
// reference and the slot takes it.
export function shiftedNames(n: number): string {
  const names = ["b" + String(n % 10), "c"];
  names.unshift("a");
  const first = names.shift() ?? "-";
  return first + ":" + names.join(",") + ":" + String(names.length);
}
