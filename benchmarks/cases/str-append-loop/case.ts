// `out += piece` in a loop: one string of 4,096 pieces of 1-24 units.
//
// The accumulator every serializer and template engine is built on. Here it
// is appended in place when the string is uniquely held and has room, and
// otherwise reallocated to the next power of two; V8 and JSC build a rope and
// flatten it on the first character read.
//
// **The checksum reads every 64th unit**, so the string has to be flat: a rope
// that is never read is `str-append-length`'s question, which is this loop
// with only the length checked.
//
// The pieces are drawn at module load from a linear congruential generator,
// so nothing folds, and `ref.cpp` draws the identical sequence. The seed picks
// where in the piece cycle the loop starts.
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

const PIECES = words(64, 1, 24, 13);

export function work(seed: number): number {
  const s = (seed | 0) & 63;
  let out = "";
  for (let i = 0; i < 4096; i++) {
    out += PIECES[(i * 13 + s) & 63]!;
  }
  let h = 0;
  for (let k = 0; k < out.length; k += 64) {
    h = (h * 31 + out.charCodeAt(k)) | 0;
  }
  return (h * 31 + out.length) | 0;
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
