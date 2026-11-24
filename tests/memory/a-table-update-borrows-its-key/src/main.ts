// A table update borrows its key (#902): only the table's own count per key
// and each pair's count of it are references; the lookup argument takes none.
//
// Four words, counted seventeen times through `counts.set(w, (counts.get(w)
// ?? 0) + 1)`, which shares one lookup between the read and the write
// (`hir::entries`). The word is read out of `words`, which the frame holds to
// the end and nothing writes while the word is read, so the key needs no
// count of its own: the table retains it once, on first insertion, and an
// update touches only the value. Then the entries become pairs, the table is
// dropped, and the pairs' keys are read: each pair holds its own count.

function counted(words: string[], rounds: number): [string, number][] {
  const counts = new Map<string, number>();
  for (let i = 0; i < rounds; i++) {
    const w = words[i & 3];
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()];
}

export function work(n: number): number {
  const words: string[] = [];
  for (let i = 0; i < 4; i++) words.push("w" + i);
  const pairs = counted(words, 16 + n);
  let total = 0;
  for (let i = 0; i < pairs.length; i++) {
    total += pairs[i][0].length * 100 + pairs[i][1];
  }
  return total;
}
