import { base, bump, count, seen } from "./state.js";

bump();

// Read through the import, not through a function. Every reference here
// resolves to a symbol declared at the import site above, which is the whole
// difficulty: module scope is keyed by the declaration.
export function total(n: number): number {
  return count + base + n;
}

// The same value reached the other way, so the two can be compared: if the
// import read a stale copy rather than the global itself, these disagree.
export function throughAFunction(n: number): number {
  return seen() + base + n;
}
