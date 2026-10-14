// expect: nothing refused
//
// The name an `import { f }` or an `export { f } from` writes is not a use of
// `f` as a value. `functions_used_as_values` read every identifier not in a
// callee position as one, and once it resolved through the import to the
// function (2d8f37484, for imported functions genuinely used as values), the
// specifier's own identifier counted: `noCopy`, which throws and has no raising
// copy (a class with a throwing field initialiser), was "used as a value", and
// held the program's raising gate off -- so the unrelated `try { twice() }`
// below was refused: "through a closure, and `noCopy` is used as a value and
// can throw, and has no raising copy". The Chromium lane's probe lost four
// functions to it on main fe162458e (`idlTranscript`, imported and called
// directly, and `ntsChromiumDomProgram`, re-exported).
//
// **A guard from the day it was written (2026-10-08)**, by MainClaude: refused
// on fe162458e (the import) and on b62243224 (the re-export); compiles and
// agrees with node now.
import { noCopy } from "./lib.ts";
export { noCopy as reexported } from "./lib.ts";

export function direct(n: number): number {
  return n < 0 ? -1 : noCopy(n);
}

export function viaClosure(n: number): number {
  const twice = (): number => {
    if (n > 7) throw new RangeError("big");
    return n * 2;
  };
  try {
    return twice();
  } catch {
    return -2;
  }
}
