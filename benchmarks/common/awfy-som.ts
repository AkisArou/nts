// The pieces of `som.js` the micro benchmarks use.
//
// Ported from `third_party/are-we-fast-yet/benchmarks/JavaScript/som.js`,
// transcribed rather than rewritten: same fields, same order, same arithmetic.

// The linear congruential generator every benchmark seeds itself from. Its
// exact sequence is part of each benchmark's expected result, so the masking
// and the constants are not adjustable.
export class Random {
  seed: number;

  constructor() {
    this.seed = 74755;
  }

  next(): number {
    this.seed = (this.seed * 1309 + 13849) & 65535;
    return this.seed;
  }
}
