import { isDevelopment, isProduction } from "./build.ts";

function development(x: number): number {
  return x + 1;
}
function production(x: number): number {
  return x * 2;
}
function neither(x: number): number {
  return x - 100;
}

/** Chooses the `whenFalse` arm. */
export const chosen = isDevelopment ? development : production;
/** Chooses the `whenTrue` arm -- a fix that always took one side would pass without this. */
export const alsoChosen = isProduction ? development : production;
/** Nested, both tests decided: `production`. */
export const nested = isDevelopment ? neither : isProduction ? production : neither;
/** **Control.** One candidate, named. It was already a direct call. */
export const named = production;
/** **Control.** An ordinary exported function, reached by an import specifier. */
export function plain(x: number): number {
  return x * 3;
}
