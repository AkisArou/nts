/** @param {number} n @returns {number} */
export function directLet(n) {
  let result = 0;
  try { x = n; } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  let x = 0;
  return result;
}
/** @param {number} n @returns {number} */
export function initializedLet(n) {
  let result = 0;
  let x = 0;
  try { x = n; } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  return result;
}
/** @param {number} n @returns {number} */
export function capturedLet(n) {
  let result = 0;
  function write() { x = n; }
  try { write(); } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  let x = 0;
  return result;
}
/** @param {number} n @returns {number} */
export function capturedLetReady(n) {
  let result = 0;
  function write() { x = n; }
  let x = 0;
  try { write(); } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  return result;
}
/** @param {number} n @returns {number} */
export function localRest(n) {
  let result = 0;
  try { [...x] = [n]; } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  let x = [0];
  return result;
}
/** @param {number} n @returns {number} */
export function localRestReady(n) {
  let result = 0;
  let x = [0];
  try { [...x] = [n]; } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  return result;
}
