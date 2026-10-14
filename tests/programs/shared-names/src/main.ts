// Both modules, so both `isSeparator`s are in one program and each must reach
// its own body. Answering with the wrong one is the failure this catches; the
// failure it *did* catch was neither -- the wrapper called a name the program
// does not define, so the closure's method table came out null and the
// compiled program dereferenced it.
import { slashes as posixSlashes, directly as posixDirectly } from "./posix.ts";
import { slashes as win32Slashes, directly as win32Directly } from "./win32.ts";

export function counted(n: number): number {
  return posixSlashes(n) * 1000 + win32Slashes(n) * 100 + posixDirectly(n) * 10 + win32Directly(n);
}

export function separators(n: number): number {
  return posixDirectly(n) * 2 + win32Directly(n);
}
