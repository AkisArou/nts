// backend: jvm
// run: check
//
// A generated RangeError must reach the caller's catch just as an explicit
// throw does. Each pair changes only whether the helper writes the throw or
// asks a builtin to generate it. Catch the class rather than the message, so
// this fixture isolates propagation from changes in Node's wording.

function bigintPower(exponent: bigint): bigint {
  return 2n ** exponent;
}

function explicitPower(exponent: bigint): bigint {
  if (exponent < 0n) throw new RangeError("undefined must be positive");
  return 2n ** exponent;
}

function compoundPower(exponent: bigint): bigint {
  let base = 2n;
  base **= exponent;
  return base;
}

function explicitCompoundPower(exponent: bigint): bigint {
  if (exponent < 0n) throw new RangeError("undefined must be positive");
  let base = 2n;
  base **= exponent;
  return base;
}

function numberRadix(radix: number): string {
  return (5).toString(radix);
}

function explicitRadix(radix: number): string {
  if (radix < 2 || radix > 36) throw new RangeError("bad radix");
  return (5).toString(radix);
}

function stringRepeat(count: number): string {
  return "x".repeat(count);
}

function explicitRepeat(count: number): string {
  if (count < 0) throw new RangeError("bad count");
  return "x".repeat(count);
}

export function caughtPower(v: number): string {
  try { return bigintPower(BigInt(-(((v | 0) & 7) + 1))).toString(); }
  catch (error) { return error instanceof RangeError ? "RangeError" : "unexpected"; }
}

export function caughtExplicitPower(v: number): string {
  try { return explicitPower(BigInt(-(((v | 0) & 7) + 1))).toString(); }
  catch (error) { return error instanceof RangeError ? "RangeError" : "unexpected"; }
}

export function caughtCompoundPower(v: number): string {
  try { return compoundPower(BigInt(-(((v | 0) & 7) + 1))).toString(); }
  catch (error) { return error instanceof RangeError ? "RangeError" : "unexpected"; }
}

export function caughtExplicitCompoundPower(v: number): string {
  try { return explicitCompoundPower(BigInt(-(((v | 0) & 7) + 1))).toString(); }
  catch (error) { return error instanceof RangeError ? "RangeError" : "unexpected"; }
}

export function caughtRadix(v: number): string {
  try { return numberRadix(-(((v | 0) & 7) + 1)); }
  catch (error) { return error instanceof RangeError ? "RangeError" : "unexpected"; }
}

export function caughtExplicitRadix(v: number): string {
  try { return explicitRadix(-(((v | 0) & 7) + 1)); }
  catch (error) { return error instanceof RangeError ? "RangeError" : "unexpected"; }
}

export function caughtRepeat(v: number): string {
  try { return stringRepeat(-(((v | 0) & 7) + 1)); }
  catch (error) { return error instanceof RangeError ? "RangeError" : "unexpected"; }
}

export function caughtExplicitRepeat(v: number): string {
  try { return explicitRepeat(-(((v | 0) & 7) + 1)); }
  catch (error) { return error instanceof RangeError ? "RangeError" : "unexpected"; }
}

function bigintDivision(divisor: bigint): bigint { return 2n / divisor; }
function explicitDivision(divisor: bigint): bigint {
  if (divisor === 0n) throw new RangeError("Division by zero");
  return 2n / divisor;
}
export function caughtDivision(v: number): string {
  try { return bigintDivision(BigInt((v | 0) & 0)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}
export function caughtExplicitDivision(v: number): string {
  try { return explicitDivision(BigInt((v | 0) & 0)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}
export function nonzeroDivision(v: number): string {
  try { return bigintDivision(BigInt(((v | 0) & 0) + 1)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}

function bigintRemainder(divisor: bigint): bigint { return 2n % divisor; }
function explicitRemainder(divisor: bigint): bigint {
  if (divisor === 0n) throw new RangeError("Division by zero");
  return 2n % divisor;
}
export function caughtRemainder(v: number): string {
  try { return bigintRemainder(BigInt((v | 0) & 0)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}
export function caughtExplicitRemainder(v: number): string {
  try { return explicitRemainder(BigInt((v | 0) & 0)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}
export function nonzeroRemainder(v: number): string {
  try { return bigintRemainder(BigInt(((v | 0) & 0) + 1)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}

function bigintCompoundDivision(divisor: bigint): bigint { let base = 2n; base /= divisor; return base; }
function explicitCompoundDivision(divisor: bigint): bigint {
  if (divisor === 0n) throw new RangeError("Division by zero");
  let base = 2n; base /= divisor; return base;
}
export function caughtCompoundDivision(v: number): string {
  try { return bigintCompoundDivision(BigInt((v | 0) & 0)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}
export function caughtExplicitCompoundDivision(v: number): string {
  try { return explicitCompoundDivision(BigInt((v | 0) & 0)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}
export function nonzeroCompoundDivision(v: number): string {
  try { return bigintCompoundDivision(BigInt(((v | 0) & 0) + 1)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}

function bigintCompoundRemainder(divisor: bigint): bigint { let base = 2n; base %= divisor; return base; }
function explicitCompoundRemainder(divisor: bigint): bigint {
  if (divisor === 0n) throw new RangeError("Division by zero");
  let base = 2n; base %= divisor; return base;
}
export function caughtCompoundRemainder(v: number): string {
  try { return bigintCompoundRemainder(BigInt((v | 0) & 0)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}
export function caughtExplicitCompoundRemainder(v: number): string {
  try { return explicitCompoundRemainder(BigInt((v | 0) & 0)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}
export function nonzeroCompoundRemainder(v: number): string {
  try { return bigintCompoundRemainder(BigInt(((v | 0) & 0) + 1)).toString(); }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}

// A signed bigint comparison selects the branch even when one operand is
// negative. The paired control changes that operand to the boundary itself.
export function negativeComparedWithZero(v: number): string {
  const value = BigInt((v | 0) & 0) - 1n;
  return value < 0n ? "negative" : "nonnegative";
}
export function zeroComparedWithZero(v: number): string {
  const value = BigInt((v | 0) & 0);
  return value < 0n ? "negative" : "nonnegative";
}
export function minimumComparedWithMinusOne(v: number): string {
  const value = (-1n << 127n) + 1n + BigInt((v | 0) & 0);
  return value < -1n ? "below" : "at or above";
}
export function minusOneComparedWithMinusOne(v: number): string {
  const value = -1n + BigInt((v | 0) & 0);
  return value < -1n ? "below" : "at or above";
}

// Discarded values need no storage, while a real JavaScript throw is observable.
function discardDivision(dividend: bigint, divisor: bigint): void { dividend / divisor; }
function discardPower(base: bigint, exponent: bigint): void { base ** exponent; }
export function discardedDivisionByZero(v: number): string {
  try { discardDivision(BigInt((v | 0) & 7), 0n); return "returned"; }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}
export function discardedNonzeroDivision(v: number): string {
  try { discardDivision(BigInt((v | 0) & 7), 1n); return "returned"; }
  catch (error) { return error instanceof RangeError ? error.message : "unexpected"; }
}
export function discardedNegativePower(v: number): string {
  try { discardPower(2n, BigInt(-(((v | 0) & 7) + 1))); return "returned"; }
  catch (error) { return error instanceof RangeError ? "RangeError" : "unexpected"; }
}
export function discardedNonnegativePower(v: number): string {
  try { discardPower(2n, BigInt((v | 0) & 7)); return "returned"; }
  catch (error) { return error instanceof RangeError ? "RangeError" : "unexpected"; }
}
export function discardedOverflowingAdd(v: number): string {
  const maximum = -((-1n << 127n) + 1n);
  maximum + BigInt(((v | 0) & 0) + 1);
  return "returned";
}
export function discardedWithinAdd(v: number): string {
  const maximum = -((-1n << 127n) + 1n);
  maximum + BigInt((v | 0) & 0);
  return "returned";
}

// A result used only on an untaken path must not cause a speculative refusal.
export function untakenOverflowingBranch(v: number): string {
  const maximum = -((-1n << 127n) + 1n);
  if ((v | 0) === 123456789) return (maximum + 1n).toString();
  return "untaken";
}
export function untakenWithinBranch(v: number): string {
  const maximum = -((-1n << 127n) + 1n);
  if ((v | 0) === 123456789) return (maximum + 0n).toString();
  return "untaken";
}
export function unenteredOverflowingLoop(v: number): string {
  const maximum = -((-1n << 127n) + 1n);
  let answer = "unentered";
  for (let i = 0; i < ((v | 0) === 123456789 ? 1 : 0); i++) answer = (maximum + 1n).toString();
  return answer;
}
export function unenteredWithinLoop(v: number): string {
  const maximum = -((-1n << 127n) + 1n);
  let answer = "unentered";
  for (let i = 0; i < ((v | 0) === 123456789 ? 1 : 0); i++) answer = (maximum + 0n).toString();
  return answer;
}

export function discardedOverflowingShl(v: number): string {
  const base = BigInt(((v | 0) & 0) + 1);
  base << 200n;
  return "returned";
}
export function discardedWithinShl(v: number): string {
  const base = BigInt(((v | 0) & 0) + 1);
  base << 126n;
  return "returned";
}
export function discardedOverflowingShr(v: number): string {
  const base = BigInt(((v | 0) & 0) + 1);
  base >> -200n;
  return "returned";
}
export function discardedWithinShr(v: number): string {
  const base = BigInt(((v | 0) & 0) + 1);
  base >> -126n;
  return "returned";
}
export function discardedOverflowingPower(v: number): string {
  discardPower(2n, BigInt(((v | 0) & 0) + 128));
  return "returned";
}
export function discardedWithinPower(v: number): string {
  discardPower(2n, BigInt(((v | 0) & 0) + 126));
  return "returned";
}
