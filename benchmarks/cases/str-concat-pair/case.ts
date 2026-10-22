// `a + b` where both sides are strings and the result is fresh: one operation,
// the first row of the string matrix (inventory §7 of the string study).
//
// Every input is drawn at module load from a linear congruential generator, so
// none of it is a literal that clang, V8 or this compiler could fold, and
// `ref.cpp` draws the identical sequence. The seed picks the order the pairs
// are made in, so the checksum depends on it.
//
// **The checksum reads characters of every string it makes**, at both ends and
// two places between, so the concatenation has to exist: a checksum of the
// length alone lets V8 and JSC keep a rope they never flatten.
function next(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) | 0;
}

function words(count: number, shortest: number, longest: number, state: number): string[] {
  const out: string[] = [];
  let x = state;
  for (let i = 0; i < count; i++) {
    x = next(x);
    const length = shortest + ((x >>> 24) % (longest - shortest + 1));
    let word = "";
    for (let k = 0; k < length; k++) {
      x = next(x);
      word += String.fromCharCode(97 + ((x >>> 24) % 26));
    }
    out.push(word);
  }
  return out;
}

const LEFT = words(8, 3, 40, 11);
const RIGHT = words(8, 3, 40, 23);

export function work(seed: number): number {
  const s = (seed | 0) & 63;
  let total = 0;
  for (let i = 0; i < 256; i++) {
    const j = (i + s) & 63;
    const joined = LEFT[j & 7]! + RIGHT[j >> 3]!;
    const n = joined.length;
    let h = n;
    h = (h * 31 + joined.charCodeAt(0)) | 0;
    h = (h * 31 + joined.charCodeAt(n >> 2)) | 0;
    h = (h * 31 + joined.charCodeAt(n >> 1)) | 0;
    h = (h * 31 + joined.charCodeAt(n - 1)) | 0;
    total = (total * 31 + h) | 0;
  }
  return total;
}

/**
 * The input the harness calls `work` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
