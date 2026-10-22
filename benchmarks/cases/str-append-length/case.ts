// `str-append-loop` with only the length checked: the row that prices ropes
// honestly.
//
// It is the one row of the string matrix whose checksum reads no character,
// and that is its whole purpose. V8 and JSC append by building a rope and never
// flatten one that nobody reads, so here they copy no character at all; a
// representation that copies every piece pays for the copies. Bun's lead on
// `json-serialize` is this, because that case too reads only `.length`. The
// gap this row shows is the price of not having ropes, and the other rows say
// whether paying it buys anything back.
//
// The pieces are drawn at module load from a linear congruential generator,
// so nothing folds, and `ref.cpp` draws the identical sequence.
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
  return out.length;
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
