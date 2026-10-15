// Unchecked JavaScript still has inferred symbol|string|absence types.
// A managed symbol's null pointer can mean undefined or null, so its storage
// type alone cannot license an unconditional Symbol TypeError.
function reject() { throw new TypeError("Cannot convert a Symbol value to a number"); }
/** @param {number} n */
export function optionalSymbol(n) {
  const value = (n & 1) === 0 ? undefined : Symbol("n");
  try { return String(Math.abs(value)); }
  catch { return "TypeError"; }
}
/** @param {number} n */
export function optionalSymbolControl(n) {
  try { const value = (n & 1) === 0 ? NaN : reject(); return String(Math.abs(value)); }
  catch { return "TypeError"; }
}
/** @param {number} n */
export function nullableSymbol(n) {
  const value = (n & 1) === 0 ? null : Symbol("n");
  try { return String(Math.abs(value)); }
  catch { return "TypeError"; }
}
/** @param {number} n */
export function nullableSymbolControl(n) {
  try { const value = (n & 1) === 0 ? 0 : reject(); return String(Math.abs(value)); }
  catch { return "TypeError"; }
}
/** @param {number} n */
export function optionalString(n) {
  const value = (n & 1) === 0 ? undefined : "2";
  return String(Math.abs(value));
}
/** @param {number} n */
export function optionalStringControl(n) {
  return String(Math.abs((n & 1) === 0 ? NaN : 2));
}
/** @param {number} n */
export function nullableString(n) {
  const value = (n & 1) === 0 ? null : "2";
  return String(Math.abs(value));
}
/** @param {number} n */
export function nullableStringControl(n) {
  return String(Math.abs((n & 1) === 0 ? 0 : 2));
}
