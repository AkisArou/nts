/**
 * Crypto's [EnforceRange] octet, unsigned short and unsigned long conversions.
 * Local to this feature because core/webidl.ts is owned by another task.
 * https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
 */
const isFiniteNumber = Number.isFinite;
const integerPart = Math.trunc;

export function toCryptoUnsignedInteger(value: unknown, bits: 8 | 16 | 32): number {
  // Unary + performs ToNumber, including rejecting BigInt and Symbol. Number()
  // would incorrectly accept BigInt. The assertion changes no runtime behavior.
  const number = +(value as number);
  if (!isFiniteNumber(number)) throw new TypeError("Expected a finite unsigned integer");
  const integer = integerPart(number);
  const maximum = bits === 8 ? 255 : bits === 16 ? 65_535 : 4_294_967_295;
  if (integer < 0 || integer > maximum) throw new TypeError("Unsigned integer is outside its range");
  return integer === 0 ? 0 : integer;
}
