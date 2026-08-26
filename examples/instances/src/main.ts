// A method is a function whose first parameter is the receiver. There is no
// dispatch to arrange: the checker resolved every call site, so `c.advance()`
// names one target and lowers to a static call -- which is what a method *is*
// once `this` is explicit. A vtable only becomes necessary where a call site
// has more than one possible target, and TypeScript says when that is.
class Counter {
  count: number;
  step: number;

  constructor(step: number) {
    this.count = 0;
    this.step = step;
  }

  advance(): number {
    this.count = this.count + this.step;
    return this.count;
  }

  scaledBy(factor: number): number {
    return this.count * factor;
  }
}

export function run(step: number, times: number): number {
  const c = new Counter(step);
  for (let i = 0; i < times; i++) {
    c.advance();
  }
  return c.count;
}

export function scaled(step: number, times: number, factor: number): number {
  const c = new Counter(step);
  for (let i = 0; i < times; i++) {
    c.advance();
  }
  return c.scaledBy(factor);
}

// Two instances, so the receiver is genuinely an argument rather than something
// the compiler could have folded away.
export function twoCounters(a: number, b: number): number {
  const x = new Counter(a);
  const y = new Counter(b);
  x.advance();
  y.advance();
  y.advance();
  return x.count * 100 + y.count;
}

// A branch where each object dies on one arm and lives on the other. Liveness
// at block granularity says both are live out of the branch -- their union is
// -- so neither would be released there, and both would leak. The releases go
// on the edges instead, which is the only placement that is exact here.
export function eitherOr(pick: number, step: number): number {
  const a = new Counter(step);
  const b = new Counter(step + 1);
  if (pick > 0) {
    return a.advance();
  }
  return b.advance();
}

// Ownership crossing a call boundary, which is where borrowed parameters could
// go wrong if they were wrong. The callee allocates and returns, so its `return`
// retains and the caller receives something it owns. The caller then lends that
// object to `bump`, which holds no reference of its own -- and does not need
// one, because the caller cannot release it until after `bump` returns.
export function makeCounter(step: number): Counter {
  return new Counter(step);
}

function bump(c: Counter, times: number): number {
  for (let i = 0; i < times; i++) {
    c.advance();
  }
  return c.count;
}

export function borrowChain(step: number, times: number): number {
  const c = makeCounter(step);
  return bump(c, times);
}

// A managed value carried around a loop as a block parameter, replaced every
// iteration. The old one dies on the back edge and the new one is handed on, so
// this is the case that separates a loop which touches the count every
// iteration from one that does not.
export function chain(times: number): number {
  let c = makeCounter(1);
  for (let i = 0; i < times; i++) {
    c = makeCounter(i);
    c.advance();
  }
  return c.count;
}
