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
