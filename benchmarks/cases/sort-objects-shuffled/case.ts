// The same object sort on freshly shuffled input each round. Xorshift32 and
// Fisher-Yates give every engine the same seeded permutation, with no ordered
// run carried over from the previous sort.
class Item {
  key: number;
  tag: number;
  constructor(key: number, tag: number) { this.key = key; this.tag = tag; }
}

export function work(seed: number): number {
  const n = (seed & 3) + 1;
  let state = (seed ^ 0x6d2b79f5) | 0;
  let total = 0;
  for (let batch = 0; batch < n; batch++) {
    const xs: Item[] = [];
    for (let i = 0; i < 256; i++) {
      xs.push(new Item(((i * 73 + batch * 11) % 257) | 0, i));
    }
    for (let round = 0; round < 16; round++) {
      for (let i = xs.length - 1; i > 0; i--) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const j = (state >>> 0) % (i + 1);
        const held = xs[i]!;
        xs[i] = xs[j]!;
        xs[j] = held;
      }
      xs.sort((a, b) => a.key - b.key || a.tag - b.tag);
      for (let i = 0; i < xs.length; i++) {
        total = (total + (i + 1) * xs[i]!.tag + xs[i]!.key) | 0;
      }
    }
  }
  return total;
}

export const seed = 0;
