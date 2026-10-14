// Every bit records one of the eight ordered comparisons. The original
// BigInts stay exact, invalid StringIntegerLiteral spellings compare false,
// and reversing the operands preserves their source evaluation order.
function compare(value: bigint, text: string): number {
  let bits = 0;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value < text) bits += 1;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value <= text) bits += 2;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value > text) bits += 4;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value >= text) bits += 8;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text < value) bits += 16;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text <= value) bits += 32;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text > value) bits += 64;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text >= value) bits += 128;
  return bits;
}

export function incomparableDecimal(n: number): number {
  return compare(1n, n < 0 ? "0." : "1.0");
}

export function incomparableExponent(n: number): number {
  return compare(100n, n < 0 ? "1e2" : "1E+2");
}

export function exactAboveDouble(n: number): number {
  return compare(9007199254740993n, n < 0 ? "9007199254740992" : "9007199254740994");
}

export function exactNegative(n: number): number {
  return compare(-9007199254740993n, n < 0 ? "-9007199254740992" : "-9007199254740994");
}

export function runtimeWideOperands(n: number): number {
  const offset = n < 0 ? -1n : n > 0 ? 1n : 0n;
  const value = 9007199254740993n + offset;
  return compare(value, n < 0 ? "9007199254740993" : "9007199254740994")
    + compare(-value, n < 0 ? "-9007199254740993" : "-9007199254740994") * 256;
}

export function decimalSigns(n: number): number {
  return compare(n < 0 ? -17n : 17n, n < 0 ? "-0017" : "+0017");
}

export function emptyAndWhitespace(n: number): number {
  return compare(n < 0 ? -1n : 0n, n < 0 ? "" : "\t\n\r\v\f \u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeff");
}

export function wideWhitespace(n: number): number {
  return compare(-17n, n < 0 ? "\u3000-17\ufeff" : "\u2029-18\u2028");
}

export function radixPrefixes(n: number): number {
  return compare(31n, n < 0 ? "0x1F" : "0X20")
    + compare(31n, n < 0 ? "0o37" : "0O40") * 256
    + compare(31n, n < 0 ? "0b11111" : "0B100000") * 65536;
}

export function invalidSpellings(n: number): number {
  const values = ["+", "-", "+0x1", "-0X1", "+0o1", "-0b1", "0x", "0o", "0b",
    "0b2", "0o8", "0xg", "1_0", "1n", "Infinity", "NaN", "1 0", "\u00851",
    "\u180e1", "1\u200b", "\ud800", "\0", "0\0"];
  let total = 0;
  for (let i = 0; i < values.length; i++) total += compare(n < 0 ? -1n : 1n, values[i]!);
  return total;
}

export function negativeZero(n: number): number {
  return compare(0n, n < 0 ? "-0000" : "+0");
}

export function signedEndpoints(n: number): number {
  const minimum = -170141183460469231731687303715884105727n - 1n;
  return compare(minimum, n < 0 ? "-170141183460469231731687303715884105728" : "-170141183460469231731687303715884105727")
    + compare(170141183460469231731687303715884105727n,
      n < 0 ? "170141183460469231731687303715884105727" : "170141183460469231731687303715884105728") * 256;
}

export function unboundedStringMagnitude(n: number): number {
  return compare(n < 0 ? -1n : 1n, n < 0
    ? "-99999999999999999999999999999999999999999999999999999999999999999999999999999999"
    : "99999999999999999999999999999999999999999999999999999999999999999999999999999999");
}

export function overflowThenInvalid(n: number): number {
  return compare(1n, n < 0
    ? "99999999999999999999999999999999999999999999999999999999999999999999999999999."
    : "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffg");
}

export function controls(n: number): number {
  return compare(1n, n < 0 ? "0" : "2")
    + (9007199254740993n > 9007199254740992n ? 256 : 0)
    + ("10" < "2" ? 512 : 0);
}

let trace = 0;
function integer(): bigint { trace = trace * 10 + 1; return 1n; }
function string(): string { trace = trace * 10 + 2; return "0."; }

export function evaluationOrder(n: number): number {
  trace = 0;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  const first = integer() > string();
  const forward = trace;
  trace = 0;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  const second = string() < integer();
  return forward * 100 + trace + (first || second ? 10000 : 0) + (n < 0 ? 0 : 1);
}

function compareNullable(value: bigint, text: string | null): number {
  let bits = 0;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value < text) bits += 1;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value <= text) bits += 2;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value > text) bits += 4;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value >= text) bits += 8;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text < value) bits += 16;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text <= value) bits += 32;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text > value) bits += 64;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text >= value) bits += 128;
  return bits;
}

function compareUndefined(value: bigint, text: string | undefined): number {
  let bits = 0;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value < text) bits += 1;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value <= text) bits += 2;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value > text) bits += 4;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (value >= text) bits += 8;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text < value) bits += 16;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text <= value) bits += 32;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text > value) bits += 64;
  // @ts-expect-error -- JavaScript compares BigInt and String with StringToBigInt.
  if (text >= value) bits += 128;
  return bits;
}


export function nullableString(n: number): number {
  const value = n < 0 ? -1n : n > 0 ? 1n : 0n;
  return compareNullable(value, n > 0 ? "0." : null);
}

export function undefinedString(n: number): number {
  const value = n < 0 ? -1n : n > 0 ? 1n : 0n;
  return compareUndefined(value, n > 0 ? "0." : undefined);
}

function absentString(): string | null { trace = trace * 10 + 2; return null; }

export function nullableEvaluationOrder(n: number): number {
  trace = 0;
  // @ts-expect-error -- JavaScript compares BigInt and null as zero.
  const first = integer() > absentString();
  const forward = trace;
  trace = 0;
  // @ts-expect-error -- JavaScript compares null as zero and BigInt.
  const second = absentString() < integer();
  return forward * 100 + trace + (first && second ? 10000 : 0) + (n < 0 ? 0 : 1);
}
