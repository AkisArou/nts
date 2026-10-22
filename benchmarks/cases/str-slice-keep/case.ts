// `slice` whose result escapes: a 2 KiB line split at spaces into an array of
// pieces that are kept, then read.
//
// `substrings` slices too, but reads each word only for its length and first
// unit, which lets the compiler never build the slice at all. Here every piece
// is pushed into an array and outlives the loop that made it, so it has to be
// a real string -- the shape of every tokenizer that hands its tokens on.
//
// The line is drawn at module load from a linear congruential generator, words
// of 1-12 letters with one space between, so no piece is empty and nothing
// folds; `ref.cpp` draws the identical line. The checksum reads the first unit
// and the length of every piece.
function next(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) | 0;
}

function line(state: number): string {
  let x = state;
  let out = "";
  while (out.length < 2048) {
    if (out.length > 0) out += " ";
    x = next(x);
    const length = 1 + ((x >>> 24) % 12);
    for (let k = 0; k < length; k++) {
      x = next(x);
      out += String.fromCharCode(97 + ((x >>> 24) % 26));
    }
  }
  return out;
}

const LINE = line(31);

export function work(seed: number): number {
  const step = seed | 0;
  const pieces: string[] = [];
  let start = 0;
  for (let i = 0; i < LINE.length; i++) {
    if (LINE.charCodeAt(i) === 32) {
      pieces.push(LINE.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(LINE.slice(start));
  let total = 0;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    total = (total + piece.length * step + piece.charCodeAt(0)) | 0;
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
