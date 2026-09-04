// The illegal half of a cycle. `main` imports `a`, `a` imports `b`, so the
// post-order walk evaluates `b` first -- and `b`'s module body reads `seed`,
// which does not exist until this file runs.
//
// Node refuses this program at runtime: `ReferenceError: Cannot access 'seed'
// before initialization`, thrown when the read executes. This compiler refuses
// it at compile time instead, which is the whole advantage of knowing the
// evaluation order statically. There is no `nts check` for it: node does not
// produce an answer to compare against.
import { echo } from "./b.js";

export let seed = 7;

export function readEcho(n: number): number {
  return echo + n;
}
