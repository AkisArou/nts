// The way an integer loop is actually written.
export function sumTo(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
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
  let h = seed | 0;
  for (let i = 0; i < rounds; i++) {
    h = (h << 5) - h + i;
    h &= 0xffff;
  }
  return h;
}

export function countDown(start: number): number {
  let steps = 0;
  let i = start;
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
