// run: check
//
// Every failing operation is beside the same operation with an operand that
// keeps the exact result in [-2^127, 2^127 - 1]. Remainder of min by -1 is
// exactly zero and must stay valid, although C's raw % is undefined there.

export function subPast(v: number): string {
  const min = -1n << 127n;
  return (min - BigInt(((v | 0) & 7) + 1)).toString();
}

export function subWithin(v: number): string {
  const min = -1n << 127n;
  return (min + 8n - BigInt(((v | 0) & 7) + 1)).toString();
}

export function negPast(v: number): string {
  const min = (-1n << 127n) + BigInt((v | 0) & 0);
  return (-min).toString();
}

export function negWithin(v: number): string {
  const min = (-1n << 127n) + BigInt(((v | 0) & 7) + 1);
  return (-min).toString();
}

export function divPast(v: number): string {
  const min = -1n << 127n;
  return (min / -BigInt(((v | 0) & 0) + 1)).toString();
}

export function divWithin(v: number): string {
  const min = -1n << 127n;
  return (min / -BigInt(((v | 0) & 0) + 2)).toString();
}

export function remWithin(v: number): string {
  const min = -1n << 127n;
  return (min % -BigInt(((v | 0) & 0) + 1)).toString();
}

export function signShiftPast(v: number): string {
  return (1n << BigInt(((v | 0) & 7) + 127)).toString();
}

export function signShiftWithin(v: number): string {
  return (-1n << BigInt(((v | 0) & 7) + 120)).toString();
}

export function reversedShiftPast(v: number): string {
  return (1n >> -BigInt(((v | 0) & 7) + 127)).toString();
}

export function reversedShiftWithin(v: number): string {
  return (-1n >> -BigInt(((v | 0) & 7) + 120)).toString();
}

export function zeroShift(v: number): string {
  return (0n << BigInt(((v | 0) & 7) + 128)).toString();
}

export function hugeDown(v: number): string {
  const count = (-1n << 127n) + BigInt((v | 0) & 0);
  return ((-1n << count) + (0n >> count)).toString();
}

export function hugeUpPast(v: number): string {
  const count = (-1n << 127n) + BigInt((v | 0) & 0);
  return (1n >> count).toString();
}
