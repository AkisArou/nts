// This type graph cannot cycle: Pair -> Leaf -> numbers. Keep each batch in
// an array until it has been read, then release its 768 objects together.
class Leaf {
  value: number;
  constructor(value: number) { this.value = value; }
}
class Pair {
  left: Leaf;
  right: Leaf;
  constructor(left: Leaf, right: Leaf) { this.left = left; this.right = right; }
}

export function work(n: number): number {
  n = (n & 3) + 1;
  let total = 0;
  for (let batch = 0; batch < 16 * n; batch++) {
    const xs: Pair[] = [];
    for (let i = 0; i < 256; i++) {
      xs.push(new Pair(new Leaf((batch + i) | 0), new Leaf((batch - i) | 0)));
    }
    for (let i = 0; i < xs.length; i++) {
      total = (total + xs[i]!.left.value + xs[i]!.right.value) | 0;
    }
  }
  return total;
}

export const seed = 0;
