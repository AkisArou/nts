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
// Nothing allocates on either side. `tests/memory/iterator-protocol`
// pins that for nts -- the result object `next()` returns is one frame slot
// reused, because each dies before the next is made -- and the C++ iterator is
// a value on the stack.
//
// **Node pays for this file's field declarations, and that is the program's
// own semantics.** The fixtures target ESNext, so a field declared without
// an initializer is defined as `undefined` when the object is built; V8 then
// types it for any value rather than for the numbers it holds. The same file
// with those fields as `declare` runs 3.4x faster on node 24.20,
// so `nts/V8` here is quoted with that factor beside it. The source stays
// as a TypeScript programmer writes it, which is what every column compiles.

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

/**
 * The input the harness calls `run` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 100000;
