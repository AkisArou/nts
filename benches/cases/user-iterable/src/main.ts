// `for...of` over a user type's own iterator, in a hot loop.
//
// The protocol is a call to `[Symbol.iterator]()` once, then a call to `next()`
// and two field reads per element. What a C++ programmer writes for the same
// thing is a custom iterator behind a range-`for`, so the row asks whether the
// protocol costs more than the shape it stands for.
//
// The sequence is a multiply-add recurrence rather than the loop counter, for
// the reason `logical-assignment` records: an answer that is affine in the
// iteration count gets solved in closed form by LLVM and the reference reads
// nanoseconds while nts iterates.
//
// Nothing allocates on either side. `tooling/memory/cases/iterator-protocol`
// pins that for nts -- the result object `next()` returns is one frame slot
// reused, because each dies before the next is made -- and the C++ iterator is
// a value on the stack.

type Step = { value: number; done: boolean };

class Steps {
  at: number;
  seed: number;
  constructor(at: number) {
    this.at = at;
    this.seed = 1;
  }
  next(): Step {
    this.at = this.at - 1;
    this.seed = (this.seed * 31 + this.at) | 0;
    return { value: this.seed & 255, done: this.at < 0 };
  }
}

class Series {
  from: number;
  constructor(from: number) {
    this.from = from;
  }
  [Symbol.iterator](): Steps {
    return new Steps(this.from);
  }
}

export function run(rounds: number): number {
  let total = 0;
  for (const v of new Series(rounds)) {
    total = (total + v) | 0;
  }
  return total;
}
