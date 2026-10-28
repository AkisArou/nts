// JSON text's escaper, `runtime/web-platform/src/json/text.ts`, over strings
// drawn to reach every path of the runtime's kernel: escapes at every distance
// from a 32-byte, 16-unit or 8-byte step, wide strings, surrogate pairs and
// lone halves, Latin-1 and U+007F. Where the target provides
// `nts_json_quote` and `nts_json_first_escape` (C and LLVM) the escaper calls
// them; node, the JVM and Wasm run its TypeScript. So agreeing with node is
// the kernel agreeing with the TypeScript it replaces, unit for unit.
//
// Each call draws 120 strings from the seed, quotes each three ways -- whole,
// from its first escape as a serializer resumes, and appended into one
// accumulator after a first-escape check, as `stringify.ts` appends a key --
// and answers the length and a hash of everything written.
import {
  firstEscapeIndex,
  quoteFromIndex,
  quoteJSONString,
} from "../../../../runtime/ecmascript/src/json/text.ts";

const EDGES = [
  0x00, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1f, 0x20, 0x22, 0x23, 0x2f, 0x5c,
  0x5d, 0x7f, 0x80, 0xe9, 0xff,
];
const WIDE = [
  0xd800, 0xdbff, 0xdc00, 0xdfff, 0x263a, 0x0100, 0xffff, 0xe000, 0xd7ff,
];

function next(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) | 0;
}

function drawn(state: number, wide: boolean): string {
  let x = state;
  x = next(x);
  const length = (x >>> 8) % 90;
  let out = "";
  for (let at = 0; at < length; at++) {
    x = next(x);
    const pick = (x >>> 8) % 16;
    if (wide && pick === 0) {
      x = next(x);
      out += String.fromCharCode(WIDE[(x >>> 8) % WIDE.length] as number);
    } else if (wide && pick === 1) {
      out += "😀";
    } else if (pick === 2) {
      x = next(x);
      out += String.fromCharCode(EDGES[(x >>> 8) % EDGES.length] as number);
    } else {
      out += String.fromCharCode(0x61 + ((x >>> 8) % 26));
    }
  }
  return out;
}

function hash(text: string, into: number): number {
  let h = into;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  return h;
}

export function quoted(seed: number): number {
  let h = 17;
  let written = 0;
  let out = "[";
  for (let n = 0; n < 120; n++) {
    const value = drawn(seed * 131 + n, (n & 3) === 0);
    const whole = quoteJSONString(value);
    h = hash(whole, h);
    written += whole.length;
    const first = firstEscapeIndex(value, 0);
    h = (Math.imul(h, 31) + first) | 0;
    if (first >= 0) {
      const resumed = quoteFromIndex(value, first);
      h = hash(resumed, h);
      h = (Math.imul(h, 31) + firstEscapeIndex(value, first + 1)) | 0;
      out += resumed;
    } else {
      out += '"';
      out += value;
      out += '"';
    }
    out += ",";
  }
  out += "]";
  return (hash(out, h) & 0xfffff) * 4096 + (written & 0xfff);
}
