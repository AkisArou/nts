// Five copying APIs, each replacing its sole owner. Filter removes a quarter
// of the elements; refill restores 64 so subsequent rounds do the same work.
export function work(n: number): number {
  n = (n & 3) + 1;
  let total = 0;
  for (let batch = 0; batch < n; batch++) {
    let xs: number[] = [];
    for (let i = 0; i < 64; i++) xs.push(((i * 37 + batch) & 1023) | 0);
    for (let round = 0; round < 32; round++) {
      xs = xs.toSorted((a, b) => a - b);
      xs = xs.toReversed();
      xs = xs.with(round % xs.length, (round + batch) | 0);
      xs = xs.map(x => ((x + 17) & 1023) | 0);
      xs = xs.filter(x => ((x + round) & 3) !== 0);
      while (xs.length < 64) xs.push(((batch + round + xs.length * 13) & 1023) | 0);
      for (let i = 0; i < xs.length; i++) total = (total + xs[i]!) | 0;
    }
  }
  return total;
}

export const seed = 0;
