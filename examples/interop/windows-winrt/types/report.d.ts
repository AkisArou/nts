declare module "c:report" {
  import type { c_uint } from "c:types";
  export function report(line: string): void;
  // How many runtime classes the Windows Runtime has activated so far.
  export function activations(): c_uint;
  // How many COM references the program has released so far.
  export function releases(): c_uint;
  // Whether the program was run with `word` as its first argument.
  export function asked(word: string): boolean;
  // How many delegates the program made are still alive.
  export function delegates(): c_uint;
}
