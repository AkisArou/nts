// A module `const` that asks whether the target provides a runtime helper is
// that question wherever it is read (`ModuleScope::questions`), so it folds per
// backend as the inline `typeof` does: C and LLVM call `nts_str_concat_number`,
// and the JVM and Wasm keep the TypeScript, with no call left for them to
// decline. A host asks once, at module load: a bare `typeof` of a name nothing
// declares, in every call, cost Bun 130 ns and the function's optimisation.
//
// The control, `ORDINARY`, is the same kind of `const` with an initializer
// that is code, and stays storage that `module#init` writes. The early reads
// are the dead zone: read before their lines during module evaluation, both
// constants throw `ReferenceError`, as node's do.

/** @ntsAbi intrinsic */
declare function nts_str_concat_number(text: string, n: number): string;

const WORDS = ["alpha", "beta", "gamma"];

function readQuestion(): boolean {
  return CONCATS;
}
function readOrdinary(): boolean {
  return ORDINARY;
}

function asked(read: () => boolean): string {
  try {
    return String(read());
  } catch (e) {
    return e instanceof ReferenceError ? "dead zone" : "other";
  }
}

const earlyQuestion = asked(readQuestion);
const earlyOrdinary = asked(readOrdinary);

const CONCATS = typeof nts_str_concat_number === "function";
const ORDINARY = WORDS.join("").length > 3;

function checksum(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    sum = (sum * 31 + text.charCodeAt(i)) | 0;
  }
  return sum;
}

export function suffixed(seed: number): number {
  const n = ((seed | 0) & 63) - 9;
  const text = CONCATS ? nts_str_concat_number("n=", n) : "n=" + String(n);
  return text.length * 1000 + (checksum(text) & 511);
}

export function ordinary(seed: number): number {
  return (ORDINARY ? 2 : 1) * 100 + ((seed | 0) & 7);
}

export function early(seed: number): number {
  return checksum(earlyQuestion + "|" + earlyOrdinary) + ((seed | 0) & 1);
}
