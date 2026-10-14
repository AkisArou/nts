// `f.bind(r, ...bound)`: a function that calls `f` with `r` as its `this` and
// the bound arguments before its own (`docs/function-receivers.md`). It holds
// `f`, `r` and the bound arguments, and calls `f` through the entry any call
// of a function value takes, so `f` may be a declared function, a closure or a
// `function` that reads its own `this`.

function add(a: number, b: number): number {
  return a * 10 + b;
}

/** Partial application of a declared function, `this` unused. */
export function partial(n: number): number {
  const addTo = add.bind(null, n & 7);
  return addTo(3) * 100 + addTo(4);
}

class Counter {
  count: number;
  constructor(count: number) {
    this.count = count;
  }
}

/** A bound `this`, read by a `function` expression. */
export function boundThis(n: number): number {
  const read = function (this: Counter, plus: number): number {
    return this.count + plus;
  };
  const fromCounter = read.bind(new Counter(n & 7));
  return fromCounter(1) * 10 + fromCounter(2);
}

type Unary = (x: number) => number;

/** A bound function held through its signature and called later. */
export function heldAndCalled(n: number): number {
  const scale = function (this: Counter, factor: number, x: number): number {
    return this.count * factor + x;
  };
  const fns: Unary[] = [scale.bind(new Counter(2), 3), scale.bind(new Counter(5), n & 3)];
  let total = 0;
  for (const f of fns) {
    total = total * 100 + f(1);
  }
  return total;
}

/** An arrow keeps its own `this`; `bind` only fixes the arguments. */
export function anArrow(n: number): number {
  const sum = (a: number, b: number): number => a + b;
  const fromOne = sum.bind(undefined, 1);
  return fromOne(n & 7);
}
