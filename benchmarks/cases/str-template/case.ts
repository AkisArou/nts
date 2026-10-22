// A template literal of a string, an integer and a string:
// `${name}:${id},${tag}`, the shape of every log line, key and label.
//
// Today this compiles to a left-folded chain of binary concatenations, so the
// second link reallocates the first link's exact-size result. One exact
// allocation is what it should cost, and this row says when it does.
//
// The names and tags are drawn at module load from a linear congruential
// generator, so nothing is a literal to fold, and `ref.cpp` draws the identical
// sequence. The integer is formatted inside the template on purpose: that is
// what a template holds.
//
// Every character of every string made is hashed, so each has to exist.
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

const NAMES = words(8, 3, 16, 5);
const TAGS = words(8, 2, 10, 7);

export function work(seed: number): number {
  const base = seed | 0;
  const s = base & 63;
  let total = 0;
  for (let i = 0; i < 256; i++) {
    const j = (i + s) & 63;
    const id = (i * 7919 + base) | 0;
    const text = `${NAMES[j & 7]!}:${id},${TAGS[j >> 3]!}`;
    let h = text.length;
    for (let k = 0; k < text.length; k++) {
      h = (h * 31 + text.charCodeAt(k)) | 0;
    }
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
