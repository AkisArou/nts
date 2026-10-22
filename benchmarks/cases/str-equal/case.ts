// `===` between strings that are different objects: 256 pairs equal in content
// and 256 pairs of equal length that differ only in their last unit.
//
// Both kinds have to be compared to the end, so this is the comparison's full
// cost and not its early exits. Every string is built separately at module
// load, unit by unit, so no two share an address and no identity shortcut can
// answer: the equal pairs are equal the way strings read from input are.
//
// The words are drawn from a linear congruential generator, so nothing folds,
// and `ref.cpp` draws the identical words. The seed picks the order of the
// pairs, which the checksum folds in.
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

// A unit-by-unit copy of each word: equal content, a different string.
function copies(from: string[], lastChanged: boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < from.length; i++) {
    const word = from[i]!;
    let copy = "";
    for (let k = 0; k < word.length; k++) {
      let unit = word.charCodeAt(k);
      if (lastChanged && k === word.length - 1) unit = unit === 122 ? 97 : unit + 1;
      copy += String.fromCharCode(unit);
    }
    out.push(copy);
  }
  return out;
}

const FIRST = words(256, 4, 64, 29);
const SAME = copies(FIRST, false);
const OTHER = copies(FIRST, true);

export function work(seed: number): number {
  const s = (seed | 0) & 255;
  let total = 0;
  for (let i = 0; i < 256; i++) {
    const j = (i + s) & 255;
    const word = FIRST[j]!;
    const same = word === SAME[j]! ? 1 : 0;
    const other = word === OTHER[j]! ? 2 : 0;
    total = (total * 31 + same + other + j) | 0;
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
