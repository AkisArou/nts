// A seeded rotation of sorted references gives two ascending runs. Their
// unequal lengths and long winning stretches exercise merge scheduling and
// galloping without depending on a comparator's implementation-defined order.
class Item {
  key: number;
  tag: number;
  constructor(key: number, tag: number) { this.key = key; this.tag = tag; }
}

export function work(seed: number): number {
  const n = (seed & 3) + 1;
  let offset = (seed | 0) & 255;
  let total = 0;
  for (let batch = 0; batch < n; batch++) {
    const ordered: Item[] = [];
    for (let i = 0; i < 256; i++) ordered.push(new Item(i, i));
    for (let round = 0; round < 16; round++) {
      offset = (offset + 73) & 255;
      const xs: Item[] = [];
      for (let i = 0; i < 256; i++) xs.push(ordered[(i + offset) & 255]!);
      xs.sort((a, b) => a.key - b.key || a.tag - b.tag);
      for (let i = 0; i < xs.length; i++) {
        total = (total + (i + 1) * xs[i]!.tag + xs[i]!.key) | 0;
      }
    }
  }
  return total;
}

export const seed = 0;
