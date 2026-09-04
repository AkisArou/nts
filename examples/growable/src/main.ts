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

// `splice(start, count)`, which removes a run and hands it back.
//
// Two arguments only: the insert form takes as many more as it is given and is
// a different signature rather than a longer one. Ten of the twelve `splice`
// calls in `runtime/node` are this shape, and every one of the twelve throws
// the result away.
export function removedOne(n: number): number {
  const xs = [n, n + 1, n + 2, n + 3, n + 4];
  const gone = xs.splice(1, 1);
  return gone[0]! * 1000 + xs.length * 100 + xs[0]! * 10 + xs[1]!;
}

// A prefix, which is the other shape node writes.
export function removedPrefix(n: number): number {
  const xs = [n, n + 1, n + 2, n + 3];
  const gone = xs.splice(0, 2);
  return gone.length * 1000 + gone[1]! * 100 + xs.length * 10 + xs[0]!;
}

// Past the end, and none at all: both clamp rather than fail.
export function splicedClamped(n: number): number {
  const xs = [n, n + 1, n + 2];
  const past = xs.splice(10, 5);
  const none = xs.splice(1, 0);
  return past.length * 1000 + none.length * 100 + xs.length * 10 + xs[2]!;
}

// A negative start counts from the end, as `slice` does.
export function splicedFromTheEnd(n: number): number {
  const xs = [n, n + 1, n + 2, n + 3];
  const gone = xs.splice(-2, 1);
  return gone[0]! * 100 + xs.length * 10 + xs[2]!;
}

// References, where the removed elements *move*: the new array holds them and
// the old one does not, so no count changes.
export function splicedNames(n: number): string {
  const names = ["a" + String(n % 10), "b", "c", "d"];
  const gone = names.splice(1, 2);
  return gone.join("+") + ":" + names.join(",") + ":" + String(names.length);
}

// `concat(ys)`, one array argument.
//
// JavaScript's `concat` takes any number and *spreads* the ones that are arrays
// while appending the ones that are not. One array argument is the shape worth
// a helper; the rest is refused by name rather than answered wrongly.
export function joined(n: number): number {
  const xs = [n, n + 1];
  const ys = [n + 2, n + 3, n + 4];
  const both = xs.concat(ys);
  return both.length * 1000 + both[0]! * 100 + both[4]! * 10 + xs.length;
}

// Neither side is modified, which is what makes it not `push`.
export function leavesBothAlone(n: number): number {
  const xs = [n];
  const ys = [n + 1];
  const both = xs.concat(ys);
  return both.length * 100 + xs.length * 10 + ys.length;
}

export function joinedEmpty(n: number): number {
  const xs: number[] = [];
  const ys = [n];
  return xs.concat(ys).length * 10 + ys.concat(xs).length;
}

// References, where the new array holds each element too and so retains it.
export function joinedNames(n: number): string {
  const a = ["x" + String(n % 10)];
  const b = ["y", "z"];
  const both = a.concat(b);
  return both.join("-") + ":" + String(both.length) + ":" + String(a.length);
}

// `[...xs]`, which is a copy of `xs` and nothing else.
//
// Fourteen of the twenty-six spreads in `runtime/node` are this shape, and a
// copy is what `slice` already is. `[...a, ...b]` and `[...a, x]` are a
// different lowering rather than a longer version of this one, and say so.
export function copied(n: number): number {
  const xs = [n, n + 1, n + 2];
  const copy = [...xs];
  copy[0] = 99;
  return copy.length * 1000 + copy[0]! * 10 + xs[0]!;
}

export function copiedEmpty(n: number): number {
  const xs: number[] = [];
  const copy = [...xs];
  return copy.length + n * 0;
}

// References, where both arrays hold each element afterwards.
export function copiedNames(n: number): string {
  const names = ["a" + String(n % 10), "b"];
  const copy = [...names];
  copy.push("c");
  return copy.join(",") + ":" + names.join(",");
}

// The copy is a different array, which is the whole reason to write one.
export function copyIsSeparate(n: number): number {
  const xs = [n];
  const copy = [...xs];
  copy.push(n + 1);
  return copy.length * 10 + xs.length;
}

// A spread among other elements: `[...a, x]`, `[...a, ...b]`, `[x, ...a, y]`.
//
// Everything is evaluated first, left to right, because that is the order
// JavaScript evaluates it in and the lengths are not known until it has been.
// Then the lengths are added and only then is the result allocated, with the
// room it needs and no length -- so `push` never reallocates.
export function spreadThenOne(n: number): number {
  const xs = [n, n + 1];
  const out = [...xs, n + 2];
  return out.length * 1000 + out[0]! * 100 + out[2]! * 10 + xs.length;
}

export function twoSpreads(n: number): number {
  const xs = [n];
  const ys = [n + 1, n + 2];
  const out = [...xs, ...ys];
  return out.length * 1000 + out[0]! * 100 + out[2]! * 10 + ys.length;
}

export function spreadInTheMiddle(n: number): number {
  const xs = [n + 1, n + 2];
  const out = [n, ...xs, n + 3];
  return out.length * 1000 + out[0]! * 100 + out[1]! * 10 + out[3]!;
}

// An empty spread contributes nothing and must not leave a hole.
export function emptySpreadAmongst(n: number): number {
  const none: number[] = [];
  const out = [n, ...none, n + 1];
  return out.length * 100 + out[0]! * 10 + out[1]!;
}

// Left to right, which a counter makes visible: the spread's source is
// evaluated where it is written, not before or after.
let ticks = 0;

function tick(v: number): number {
  ticks = ticks + 1;
  return v * 10 + ticks;
}

function tickList(v: number): number[] {
  ticks = ticks + 1;
  return [v * 10 + ticks];
}

export function evaluatedInOrder(n: number): number {
  ticks = 0;
  const out = [tick(n), ...tickList(n), tick(n)];
  return out[0]! * 10000 + out[1]! * 100 + out[2]! + ticks;
}

// References, where both the source and the result hold each element.
export function spreadNames(n: number): string {
  const xs = ["a" + String(n % 10)];
  const ys = ["b", "c"];
  const out = [...xs, "mid", ...ys];
  return out.join(",") + ":" + String(out.length) + ":" + xs.join(",");
}

// `Array.from(xs)` where `xs` is already an array, which is the same copy
// `[...xs]` is. Twelve of the twenty-two `Array.from` calls in `runtime/node`
// take one argument; a mapper, or something iterable that is not an array, is
// a different question and is refused by name.
export function fromArray(n: number): number {
  const xs = [n, n + 1, n + 2];
  const copy = Array.from(xs);
  copy[0] = 77;
  return copy.length * 1000 + copy[0]! * 10 + xs[0]!;
}

export function fromEmpty(n: number): number {
  const xs: number[] = [];
  return Array.from(xs).length + n * 0;
}

export function fromNames(n: number): string {
  const names = ["p" + String(n % 10), "q"];
  const copy = Array.from(names);
  copy.push("r");
  return copy.join(",") + ":" + names.join(",");
}

// `const xs = []` with no annotation, which TypeScript calls an *evolving*
// array: it is `never[]` where it is written, because with no elements and no
// annotation the checker has nothing to infer from yet, and it fills that in
// from the pushes as it walks.
//
// So the type at the declaration is the one that says nothing, and every later
// mention carries what it evolved to. Reading one of those back is the whole
// feature; repeating the inference here would be a second answer to a question
// that already has one.
export function evolvedStrings(n: number): string {
  const parts = [];
  for (let i = 0; i < 3 + (n - n); i++) {
    parts.push("p" + String(i));
  }
  return parts.join("/") + ":" + String(parts.length);
}

export function evolvedNumbers(n: number): number {
  const nums = [];
  for (let i = 0; i < 4 + (n - n); i++) {
    nums.push(i * 2 + n);
  }
  let total = 0;
  for (let i = 0; i < nums.length; i++) {
    total = total + nums[i]!;
  }
  return total;
}

// Pushed in a branch, so the array is empty on one path and not on the other.
export function evolvedConditionally(n: number): number {
  const kept = [];
  if (n > 5) {
    kept.push(n);
  }
  return kept.length * 100 + (kept[0] ?? -1);
}
