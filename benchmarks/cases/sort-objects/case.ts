// Object identity survives each sort. Descending/ascending alternation keeps
// later sorts nontrivial; the comparator reads object fields on every call.
class Item {
  key: number;
  tag: number;
  constructor(key: number, tag: number) { this.key = key; this.tag = tag; }
}

export function work(n: number): number {
  n = (n & 3) + 1;
  let total = 0;
  for (let batch = 0; batch < n; batch++) {
    const xs: Item[] = [];
    for (let i = 0; i < 256; i++) {
      xs.push(new Item(((i * 73 + batch * 11) % 257) | 0, i));
    }
    for (let round = 0; round < 16; round++) {
      xs.reverse();
      xs.sort((a, b) => a.key - b.key || a.tag - b.tag);
      for (let i = 0; i < xs.length; i++) {
        total = (total + (i + 1) * xs[i]!.tag + xs[i]!.key) | 0;
      }
    }
  }
  return total;
}

export const seed = 0;
