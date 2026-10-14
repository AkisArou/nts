// A generator `function` that reads its own `this` takes the call's, as any
// `function` does (`docs/function-receivers.md`). Its body runs at the first
// `next()`, not at the call, so the `this` waits in the generator's frame with
// its parameters, and is proven where the body starts.

class Counter {
  count: number;
  constructor(count: number) {
    this.count = count;
  }
}

const counting = function* (this: Counter, n: number): Generator<number> {
  for (let i = 0; i < n; i++) {
    yield this.count + i;
  }
};

/** A generator expression, `.call`ed with its `this`. */
export function anExpression(n: number): number {
  let total = 0;
  for (const value of counting.call(new Counter(n & 7), 3)) {
    total = total * 10 + value;
  }
  return total;
}

function* upTo(this: Counter, limit: number): Generator<number> {
  let at = 0;
  while (at < limit) {
    yield at;
    // Read after a `yield`: the `this` survived the suspension.
    at += this.count;
  }
}

/** A generator declaration, reading `this` after it resumes. */
export function aDeclaration(n: number): number {
  let total = 0;
  for (const value of upTo.call(new Counter((n & 3) + 1), 10)) {
    total += value;
  }
  return total;
}

class Bag {
  items: number[];
  constructor(items: number[]) {
    this.items = items;
  }
  *each(): Generator<number> {
    for (const item of this.items) {
      yield item * 2;
    }
  }
}

/** A generator method taken as a value and called with its object. */
export function aMethodValue(n: number): number {
  const bag = new Bag([n & 7, 1, 2]);
  const each = bag.each;
  let total = 0;
  for (const value of each.call(bag)) {
    total = total * 100 + value;
  }
  return total;
}
