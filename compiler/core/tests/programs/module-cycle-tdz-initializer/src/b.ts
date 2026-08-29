import { seed } from "./a.js";

// `a` has not evaluated: node throws `ReferenceError: Cannot access 'seed'
// before initialization` here.
export const derived = seed + 1;
