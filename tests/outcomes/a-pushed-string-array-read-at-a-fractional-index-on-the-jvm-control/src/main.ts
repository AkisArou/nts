// run: check
// backend: jvm
//
// The control for a-pushed-string-array-read-at-a-fractional-index-on-the-jvm:
// the same lookup at `seed & 3`, an integer index in range, which agrees.
const words: string[] = [];
for (let i = 0; i < 4; i++) {
  words.push("w" + i);
}
const table: Record<string, number> = { w0: 1, w1: 2, w2: 3, w3: 4 };

export function lookup(seed: number): number {
  return table[words[seed & 3]] ?? -1;
}
