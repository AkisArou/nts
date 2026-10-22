// A `Map<string, number>` keyed by run-time strings: 64 inserts, 512 lookups
// of which half miss, 128 updates and 64 final reads, on a fresh map per call.
//
// Hashing and comparing a string key is the operation. **Every lookup and
// update uses a separately built copy of the key**, so a lookup that hits must
// compare contents: no identity test can answer it, as none can for keys read
// from input. The keys are 4-32 units.
//
// The keys are drawn at module load from a linear congruential generator, so
// nothing folds, and `ref.cpp` draws the identical keys. The seed picks the
// values stored and the order of the lookups.
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

const KEYS = words(64, 4, 32, 41);
// The same words again from the same state: equal content, different strings.
const PRESENT = words(64, 4, 32, 41);
const ABSENT = words(64, 4, 32, 43);

export function work(seed: number): number {
  const s = (seed | 0) & 127;
  const map = new Map<string, number>();
  for (let i = 0; i < 64; i++) {
    map.set(KEYS[i]!, i + s);
  }
  let total = 0;
  for (let i = 0; i < 512; i++) {
    const j = (i * 5 + s) & 127;
    const key = j < 64 ? PRESENT[j]! : ABSENT[j - 64]!;
    total = (total + (map.get(key) ?? -1)) | 0;
  }
  for (let i = 0; i < 128; i++) {
    const key = PRESENT[(i * 3 + s) & 63]!;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  for (let i = 0; i < 64; i++) {
    total = (total * 31 + (map.get(PRESENT[i]!) ?? 0)) | 0;
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
