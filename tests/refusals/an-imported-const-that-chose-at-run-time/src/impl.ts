import { outside } from "./outside.ts";

function first(x: number): number {
  return x + 1;
}
function second(x: number): number {
  return x * 2;
}

/** Nothing decides this: `decide()` is a call, and its type is `boolean`. */
function decide(): boolean {
  return true;
}

export const chose = decide() ? first : second;

/** **Control.** Decided, so it is a name and the call is direct and correct. */
const yes = true;
export const decided = yes ? first : second;

/** **Control.** An ordinary function, reached through the same re-export. */
export function plain(x: number): number {
  return x * 3;
}

/** **Control.** A `const` naming an *imported* function: one candidate, in
 * another file. The name written here is an import specifier, so answering this
 * without following the alias would refuse a call that already worked. */
export const borrowed = outside;
