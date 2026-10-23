// A runtime helper called where the target provides it, and the TypeScript
// body kept where it does not (`hir::features`): `typeof` of an `@ntsAbi
// intrinsic` declaration is answered per backend, from each backend's own
// table, and the arm a backend cannot run folds away. On node the declared
// global does not exist, `typeof` answers "undefined", and the body runs.
//
// `nts_str_concat_number` is in the C runtime's header, so C and LLVM call it;
// the JVM and Wasm do not provide it, and run the body. The two arms answer
// alike, so every backend agrees with node. The control, `nts_no_such_helper`,
// is declared and provided by nothing: every backend runs its body.

/** @ntsAbi intrinsic */
declare function nts_str_concat_number(text: string, n: number): string;

/** @ntsAbi intrinsic */
declare function nts_no_such_helper(text: string): string;

function checksum(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    sum = (sum * 31 + text.charCodeAt(i)) | 0;
  }
  return sum;
}

function suffixed(text: string, n: number): string {
  if (typeof nts_str_concat_number === "function") {
    return nts_str_concat_number(text, n);
  }
  return text + String(n);
}

function shouted(text: string): string {
  if (typeof nts_no_such_helper !== "undefined") {
    return nts_no_such_helper(text);
  }
  return text + "!";
}

export function guarded(seed: number): number {
  const n = ((seed & 31) - 7) * 1.5;
  const text = suffixed("n=", n) + "," + shouted("abc");
  return text.length * 1000 + (checksum(text) & 511);
}
