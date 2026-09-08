// The way an integer loop is actually written.
export function sumTo(n: number): number {
  // Bounded: the differential sweeps this parameter through a pool holding
  // 2^31, 2^32 and 2^53, which are values worth testing and loop bounds that
  // finish on neither side. See `examples/generators` for the whole reason.
  const bound = n > 65536 ? 65536 : n;
  let total = 0;
  for (let i = 0; i < bound; i++) {
    total += i;
  }
  return total;
}

// Constant bound, so everything here is provable.
export function triangle(): number {
  let total = 0;
  for (let i = 0; i < 1000; i++) {
    total += i;
  }
  return total;
}

// A hash loop: bitwise operators make every value an integer by construction,
// no matter what came in.
export function hash(seed: number, rounds: number): number {
  // Bounded: the differential sweeps this parameter through a pool holding
  // 2^31, 2^32 and 2^53, which are values worth testing and loop bounds that
  // finish on neither side. See `examples/generators` for the whole reason.
  const bound = rounds > 65536 ? 65536 : rounds;
  let h = seed | 0;
  for (let i = 0; i < bound; i++) {
    h = (h << 5) - h + i;
    h &= 0xffff;
  }
  return h;
}

export function countDown(start: number): number {
  // Bounded because the differential sweeps this parameter through a pool that
  // contains 2^31, 2^32 and 2^53. Those are useful as *values* and useless as a
  // loop bound: neither node nor the compiled program finishes, both are killed
  // at twenty seconds, and the case is abandoned along with the rest of this
  // function's batch -- scored as neither agreement nor disagreement, so it
  // bought nothing but wall clock, five times over because five backend lanes
  // run the same examples. Clamped, the same case is checked instead.
  let steps = 0;
  let i = start > 65536 ? 65536 : start;
  while (i > 0) {
    i--;
    steps++;
  }
  return steps;
}

// Counting down, which the trip count has to measure from the other end.
export function countdown(seed: number): number {
  let total = 0;
  for (let i = 500; i > 0; i--) {
    total += (seed | 0) & 15;
  }
  return total;
}

// `>=` admits one more iteration than `>`, and getting that wrong is an
// off-by-one in a bound rather than in a loop -- it would not show up as a
// wrong answer, only as a refused specialization or an unsound one.
export function inclusive(seed: number): number {
  let total = 0;
  for (let i = 100; i >= 0; i--) {
    total += (seed | 0) & 3;
  }
  return total;
}
