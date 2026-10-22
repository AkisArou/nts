// JSON quoting: the shared escaper, `quoteJSONString` from
// `runtime/web-platform/src/json/text.ts`, imported unmodified, over a
// 64-string corpus about 2% of whose units need escaping, appended into one
// accumulator as a serializer does.
//
// `json-serialize` measures the whole serializer; this is its escaper alone,
// so a faster scan or a copy-and-check primitive moves this row and nothing
// else. Roughly half the strings carry at least one escape, so both the
// no-escape fast path and `quoteFromIndex` are taken.
//
// `JSON.stringify` is not called because compiled user code refuses it today
// (`a global member with no definition here`). The consequence for the engine
// columns is that node and bun run this same TypeScript escaper, not their own
// built-in `JSON.stringify`.
//
// ASCII only -- quote, backslash, newline, tab and U+0001 are the escapes -- so
// `ref.cpp`'s byte escaper writes exactly Table 78's text. The corpus is drawn
// at module load from a linear congruential generator, so nothing folds, and
// `ref.cpp` draws the identical one. Every unit of the output is hashed.
import { quoteJSONString } from "../../../runtime/web-platform/src/json/text.ts";

function next(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) | 0;
}

const ESCAPED = [0x22, 0x5c, 0x0a, 0x09, 0x01];

function corpus(count: number, state: number): string[] {
  let x = state;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    x = next(x);
    const length = 8 + ((x >>> 24) % 57);
    let text = "";
    for (let k = 0; k < length; k++) {
      x = next(x);
      const r = x >>> 24;
      if (r < 5) text += String.fromCharCode(ESCAPED[r]!);
      else if (r < 40) text += " ";
      else text += String.fromCharCode(97 + (r % 26));
    }
    out.push(text);
  }
  return out;
}

const CORPUS = corpus(64, 71);

export function work(seed: number): number {
  const s = (seed | 0) & 63;
  let out = "[";
  for (let i = 0; i < 64; i++) {
    if (i > 0) out += ",";
    out += quoteJSONString(CORPUS[(i + s) & 63]!);
  }
  out += "]";
  let h = 0;
  for (let k = 0; k < out.length; k++) {
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
