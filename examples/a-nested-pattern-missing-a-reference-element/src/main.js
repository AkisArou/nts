// JavaScript pattern sources can be absent despite an inferred reference type.
function objectElement([{ x }]) {}
function arrayElement([[x]]) {}
function defaultedElement([{ x } = { x: 7 }]) { return x; }

/** @param {number} n */
export function missingObject(n) {
  try { objectElement([]); return 0; }
  catch (e) { return e instanceof TypeError ? 1 + (n & 1) : -1; }
}
/** @param {number} n */
export function missingArray(n) {
  try { arrayElement([]); return 0; }
  catch (e) { return e instanceof TypeError ? 1 + (n & 1) : -1; }
}
/** @param {number} n */
export function presentObject(n) {
  try { objectElement([{ x: n }]); return 1 + (n & 1); }
  catch (e) { return -1; }
}
/** @param {number} n */
export function presentArray(n) {
  try { arrayElement([[n]]); return 1 + (n & 1); }
  catch (e) { return -1; }
}
/** @param {number} n */
export function defaultedObject(n) { return defaultedElement([]) + (n & 1); }
