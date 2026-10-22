// `split(",")`: 64 CSV lines of 12 fields each, split and every field read.
//
// Fields are 0-10 units, so some are empty, as CSV fields are. Each split
// makes an array and a string per field, which is what the operation asks for.
//
// The lines are drawn at module load from a linear congruential generator, so
// nothing folds, and `ref.cpp` draws the identical lines. The seed rotates the
// order the lines are split in. The checksum reads the length and first unit
// of every field.
function next(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) | 0;
}

function lines(count: number, state: number): string[] {
  let x = state;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let line = "";
    for (let field = 0; field < 12; field++) {
      if (field > 0) line += ",";
      x = next(x);
      const length = (x >>> 24) % 11;
      for (let k = 0; k < length; k++) {
        x = next(x);
        line += String.fromCharCode(97 + ((x >>> 24) % 26));
      }
    }
    out.push(line);
  }
  return out;
}

const LINES = lines(64, 59);

export function work(seed: number): number {
  const s = (seed | 0) & 63;
  let total = 0;
  for (let i = 0; i < 64; i++) {
    const fields = LINES[(i + s) & 63]!.split(",");
    for (let k = 0; k < fields.length; k++) {
      const field = fields[k]!;
      total = (total * 31 + field.length) | 0;
      if (field.length > 0) {
        total = (total + field.charCodeAt(0)) | 0;
      }
    }
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
