// `toLowerCase` and `toUpperCase`, which are a table rather than an algorithm.
//
// The tables come from quickjs-ng (`runtime/c/quickjs`) and are what makes these
// methods *exist*. They are not what makes them fast: this loop is ASCII, and
// the ASCII path never reaches a table. It allocates one string whose length
// and storage width are both known before it starts, and walks it once.
//
// ASCII on purpose, and it is the honest choice twice over. It is what a
// program converting case almost always has; and it is the only thing the C++
// column can do at all, since `std::tolower` is one byte to one byte and
// JavaScript's mapping is neither. The non-ASCII paths -- `ß` to `SS`, `ÿ` to
// `Ÿ`, astral Deseret -- are covered against node in `examples/strings`, where
// correctness is the question and node is the oracle.
//
// **The inputs vary per round, and that is load-bearing.** Written first with
// one constant string, this measured nothing: `ascii.toLowerCase()` is
// loop-invariant, V8 hoisted it out, and node reported 43 ns for what nts did
// in 15 us. A benchmark whose body can be computed once is measuring the
// optimizer's ability to notice, not the operation.
export function convert(seed: number): number {
  const base = "The Quick Brown Fox Jumps Over The Lazy Dog " + String(seed | 0);
  const inputs: string[] = [];
  for (let i = 0; i < 16; i++) {
    inputs.push(base + String(i));
  }

  let total = 0;
  for (let round = 0; round < 64; round++) {
    const s = inputs[round % 16]!;
    const lower = s.toLowerCase();
    const upper = s.toUpperCase();
    total = (total + lower.length + upper.length) | 0;
    total = (total + lower.charCodeAt(0) + upper.charCodeAt(0)) | 0;
  }
  return total;
}

/**
 * The input the harness calls `convert` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
