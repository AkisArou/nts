// `join`: a 256-string array joined with a separator the seed chooses.
//
// The result is one string of about 2,500 units. Its checksum reads every 16th
// unit and the length, so it has to exist, and the reading stays a small part
// of the row.
//
// The parts are drawn at module load from a linear congruential generator,
// so nothing folds, and `ref.cpp` draws the identical ones. The separators are
// literals, but which one is used is the seed's choice at run time.
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

const PARTS = words(256, 1, 16, 61);
const SEPARATORS = [",", ";", ", ", " | "];

export function work(seed: number): number {
  const joined = PARTS.join(SEPARATORS[(seed | 0) & 3]!);
  let h = 0;
  for (let k = 0; k < joined.length; k += 16) {
    h = (h * 31 + joined.charCodeAt(k)) | 0;
  }
  return (h * 31 + joined.length) | 0;
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
