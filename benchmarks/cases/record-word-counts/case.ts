// Word counting through a string record, `Record<string, number>`, read the
// way real code reads one.
//
// `counts[w] = (counts[w] || 0) + 1` is the idiom, and the first read of each
// word misses: the record answers `undefined` and the `||` supplies the 0.
// That read only asks whether the entry is there, so it takes the erased
// value the lookup answers and tests its tag. The second pass asks about a
// vocabulary a third of which was never counted, through `?? 0`, the same
// kind of read. The last pass reads every counted word at a number,
// `counts[w] * (i + 1)`, which is checked to be the number its type says
// before it is read as one: the price of the stop a missing key there makes.
//
// The comparison is `std::unordered_map<std::string, double>`, `HashMap<String,
// Double>`, and node's own object used as a dictionary.
//
// Everything depends on `seed`, and the trip count carries it so nothing folds.
const vocabulary: string[] = [];
for (let i = 0; i < 96; i++) {
  vocabulary.push("word" + i);
}

export function wordCounts(seed: number): number {
  const counts: Record<string, number> = {};
  // A small non-negative integer whatever `seed` is, so every index below is
  // a word and every word the last pass reads was counted.
  const s = (seed | 0) & 1023;
  const rounds = 509 + s;
  // An odd stride over 64 words, so every one of them is counted.
  for (let i = 0; i < rounds; i++) {
    const w = vocabulary[(i * 13 + s) & 63];
    counts[w] = (counts[w] || 0) + 1;
  }
  let total = 0;
  // Words 64 to 95 were never counted: a third of these lookups miss.
  for (let i = 0; i < rounds; i++) {
    total = (total + (counts[vocabulary[(i * 7 + s) % 96]] ?? 0)) | 0;
  }
  for (let i = 0; i < 64; i++) {
    total = (total + counts[vocabulary[i]] * (i + 1)) | 0;
  }
  return total;
}

/**
 * The input the harness calls `wordCounts` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
