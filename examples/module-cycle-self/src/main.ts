// A module that imports itself. The smallest cycle there is, and legal: the
// import binding resolves to this file's own export, so `viaImport` and
// `helper` are the same function reached two ways.
//
// Node was asked. It evaluates the file once, and the self-edge adds nothing
// to the order -- which is exactly what a post-order walk does with a module
// already being visited.
import { helper as viaImport } from "./main.js";

let evaluated = 0;

evaluated = 1;

export function helper(n: number): number {
  return n * 3;
}

export function selfImport(n: number): number {
  return viaImport(n) + evaluated;
}
