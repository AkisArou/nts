// Safe literal operators need no RangeError guard or raising copy.
// The caller try requests raising entries only from the unsafe controls.

function divide(x: bigint, rhs: bigint): bigint { return x / 2n; }
export function catchDivide(x: bigint, rhs: bigint): bigint {
  try { return divide(x, rhs); } catch { return -1n; }
}

function remainder(x: bigint, rhs: bigint): bigint { return x % 10n; }
export function catchRemainder(x: bigint, rhs: bigint): bigint {
  try { return remainder(x, rhs); } catch { return -1n; }
}

function power(x: bigint, rhs: bigint): bigint { return x ** 2n; }
export function catchPower(x: bigint, rhs: bigint): bigint {
  try { return power(x, rhs); } catch { return -1n; }
}

function zeroPower(x: bigint, rhs: bigint): bigint { return x ** 0n; }
export function catchZeroPower(x: bigint, rhs: bigint): bigint {
  try { return zeroPower(x, rhs); } catch { return -1n; }
}

function divideAssigned(x: bigint, rhs: bigint): bigint { x /= 2n; return x; }
export function catchDivideAssigned(x: bigint, rhs: bigint): bigint {
  try { return divideAssigned(x, rhs); } catch { return -1n; }
}

function remainderAssigned(x: bigint, rhs: bigint): bigint { x %= 10n; return x; }
export function catchRemainderAssigned(x: bigint, rhs: bigint): bigint {
  try { return remainderAssigned(x, rhs); } catch { return -1n; }
}

function powerAssigned(x: bigint, rhs: bigint): bigint { x **= 2n; return x; }
export function catchPowerAssigned(x: bigint, rhs: bigint): bigint {
  try { return powerAssigned(x, rhs); } catch { return -1n; }
}

function hexDivisor(x: bigint, rhs: bigint): bigint { return x / 0x2n; }
export function catchHexDivisor(x: bigint, rhs: bigint): bigint {
  try { return hexDivisor(x, rhs); } catch { return -1n; }
}

function separatedDivisor(x: bigint, rhs: bigint): bigint { return x % 1_0n; }
export function catchSeparatedDivisor(x: bigint, rhs: bigint): bigint {
  try { return separatedDivisor(x, rhs); } catch { return -1n; }
}

function parenthesizedExponent(x: bigint, rhs: bigint): bigint { return x ** ((0b10n)); }
export function catchParenthesizedExponent(x: bigint, rhs: bigint): bigint {
  try { return parenthesizedExponent(x, rhs); } catch { return -1n; }
}

function octalAssigned(x: bigint, rhs: bigint): bigint { x /= 0o2n; return x; }
export function catchOctalAssigned(x: bigint, rhs: bigint): bigint {
  try { return octalAssigned(x, rhs); } catch { return -1n; }
}

function zeroDivisor(x: bigint, rhs: bigint): bigint { return x / 0n; }
export function catchZeroDivisor(x: bigint, rhs: bigint): bigint {
  try { return zeroDivisor(x, rhs); } catch { return -1n; }
}

function zeroRemainder(x: bigint, rhs: bigint): bigint { return x % 0n; }
export function catchZeroRemainder(x: bigint, rhs: bigint): bigint {
  try { return zeroRemainder(x, rhs); } catch { return -1n; }
}

function negativeExponent(x: bigint, rhs: bigint): bigint { return x ** -1n; }
export function catchNegativeExponent(x: bigint, rhs: bigint): bigint {
  try { return negativeExponent(x, rhs); } catch { return -1n; }
}

function variableDivisor(x: bigint, rhs: bigint): bigint { return x / rhs; }
export function catchVariableDivisor(x: bigint, rhs: bigint): bigint {
  try { return variableDivisor(x, rhs); } catch { return -1n; }
}

function variableRemainder(x: bigint, rhs: bigint): bigint { return x % rhs; }
export function catchVariableRemainder(x: bigint, rhs: bigint): bigint {
  try { return variableRemainder(x, rhs); } catch { return -1n; }
}

function variableExponent(x: bigint, rhs: bigint): bigint { return x ** rhs; }
export function catchVariableExponent(x: bigint, rhs: bigint): bigint {
  try { return variableExponent(x, rhs); } catch { return -1n; }
}

function zeroAssignedDivisor(x: bigint, rhs: bigint): bigint { x /= 0n; return x; }
export function catchZeroAssignedDivisor(x: bigint, rhs: bigint): bigint {
  try { return zeroAssignedDivisor(x, rhs); } catch { return -1n; }
}

function zeroAssignedRemainder(x: bigint, rhs: bigint): bigint { x %= 0n; return x; }
export function catchZeroAssignedRemainder(x: bigint, rhs: bigint): bigint {
  try { return zeroAssignedRemainder(x, rhs); } catch { return -1n; }
}

function negativeAssignedExponent(x: bigint, rhs: bigint): bigint { x **= -1n; return x; }
export function catchNegativeAssignedExponent(x: bigint, rhs: bigint): bigint {
  try { return negativeAssignedExponent(x, rhs); } catch { return -1n; }
}
