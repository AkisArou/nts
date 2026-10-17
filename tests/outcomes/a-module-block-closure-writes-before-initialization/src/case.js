// Each control moves only the lexical declaration before the closure call.
let writtenEarly = 0;
{
  function writeEarlyBinding() { x = 1; }
  try { writeEarlyBinding(); } catch (e) { writtenEarly = e instanceof ReferenceError ? 10 : -10; }
  let x;
}
let writtenReady = 0;
{
  function writeReadyBinding() { x = 1; }
  let x;
  try { writeReadyBinding(); } catch (e) { writtenReady = e instanceof ReferenceError ? 10 : -10; }
}
let readEarly = 0;
{
  function readEarlyBinding() { return x + 1; }
  try { readEarlyBinding(); } catch (e) { readEarly = e instanceof ReferenceError ? 10 : -10; }
  const x = 1;
  readEarly += readEarlyBinding();
}
let readReady = 0;
{
  function readReadyBinding() { return x + 1; }
  const x = 1;
  try { readReadyBinding(); } catch (e) { readReady = e instanceof ReferenceError ? 10 : -10; }
  readReady += readReadyBinding();
}
/** @param {number} n @returns {number} */
export function writeSubject(n) { return writtenEarly; }
/** @param {number} n @returns {number} */
export function writeControl(n) { return writtenReady; }
/** @param {number} n @returns {number} */
export function readSubject(n) { return readEarly; }
/** @param {number} n @returns {number} */
export function readControl(n) { return readReady; }
