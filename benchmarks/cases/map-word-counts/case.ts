// Word counting through a `Map<string, number>`, updated the way real code
// updates one: `counts.set(w, (counts.get(w) ?? 0) + 1)`.
//
// The read and the write name one table and one key, so they can share one
// lookup: the first read of each word misses and the write inserts it, every
// later one finds it and overwrites in place. The second pass asks about a
// vocabulary a third of which was never counted; the last reads every counted
// word at a number.
//
// The comparison is `std::unordered_map<std::string, double>` updated with
// `counts[w] += 1`, `HashMap<String, Double>` with `merge`, and node's `Map`:
// each looks the key up once per update.
//
// Everything depends on `seed`, and the trip count carries it so nothing folds.
const vocabulary: string[] = [];
for (let i = 0; i < 96; i++) {
  vocabulary.push("word" + i);
}

export function mapWordCounts(seed: number): number {
  const counts = new Map<string, number>();
  // A small non-negative integer whatever `seed` is, so every index below is
  // a word and every word the last pass reads was counted.
  const s = (seed | 0) & 1023;
  const rounds = 509 + s;
  // An odd stride over 64 words, so every one of them is counted.
  for (let i = 0; i < rounds; i++) {
    const w = vocabulary[(i * 13 + s) & 63];
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let total = 0;
  // Words 64 to 95 were never counted: a third of these lookups miss.
  for (let i = 0; i < rounds; i++) {
    total = (total + (counts.get(vocabulary[(i * 7 + s) % 96]) ?? 0)) | 0;
  }
  for (let i = 0; i < 64; i++) {
    total = (total + (counts.get(vocabulary[i]) ?? 0) * (i + 1)) | 0;
  }
  return total;
}

/**
 * The input the harness calls `mapWordCounts` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
