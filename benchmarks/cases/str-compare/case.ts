// `<` and `>` between strings: an insertion sort of 64 strings, written out so
// the comparison is the operator itself and not a comparator callback.
//
// The strings share prefixes of 0, 4, 8 and 16 units, as paths, names and keys
// do, so a comparison has to walk past the common part before it decides.
// Random letters alone would differ at the first unit nineteen times in
// twenty and measure only the call.
//
// The strings are drawn at module load from a linear congruential generator,
// so nothing folds, and `ref.cpp` draws the identical ones. The seed rotates
// the order they start in. The checksum hashes every unit of the sorted array.
function next(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) | 0;
}

function keys(count: number, state: number): string[] {
  let x = state;
  let stem = "";
  for (let k = 0; k < 16; k++) {
    x = next(x);
    stem += String.fromCharCode(97 + ((x >>> 24) % 26));
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    x = next(x);
    const shared = [0, 4, 8, 16][(x >>> 24) & 3]!;
    let key = stem.slice(0, shared);
    x = next(x);
    const tail = 2 + ((x >>> 24) % 9);
    for (let k = 0; k < tail; k++) {
      x = next(x);
      key += String.fromCharCode(97 + ((x >>> 24) % 26));
    }
    out.push(key);
  }
  return out;
}

const KEYS = keys(64, 37);

export function work(seed: number): number {
  const s = (seed | 0) & 63;
  const sorted: string[] = [];
  for (let i = 0; i < 64; i++) {
    sorted.push(KEYS[(i + s) & 63]!);
  }
  for (let i = 1; i < sorted.length; i++) {
    const key = sorted[i]!;
    let j = i - 1;
    while (j >= 0 && sorted[j]! > key) {
      sorted[j + 1] = sorted[j]!;
      j--;
    }
    sorted[j + 1] = key;
  }
  let h = 0;
  for (let i = 0; i < sorted.length; i++) {
    const key = sorted[i]!;
    for (let k = 0; k < key.length; k++) {
      h = (h * 31 + key.charCodeAt(k)) | 0;
    }
  }
  return h;
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
