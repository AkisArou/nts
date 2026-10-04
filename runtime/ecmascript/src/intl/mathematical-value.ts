// ToIntlMathematicalValue keeps string/BigInt precision rather than passing
// through binary64. Number conversion is used only for NaN, infinity and the
// spec's overflow/underflow boundary; finite nonzero strings stay exact.
function digit(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function radixDecimal(text: string, radix: number): string | number {
  // Little-endian decimal digits. This conversion also works for exact radix
  // strings wider than NTS's deliberate fixed-width BigInt representation.
  const digits = new Uint8Array(Math.ceil((text.length - 2) * Math.log10(radix)) + 1);
  let length = 1;
  if (text.length === 2) return NaN;
  for (let index = 2; index < text.length; index++) {
    let carry = digit(text.charCodeAt(index));
    if (carry < 0 || carry >= radix) return NaN;
    for (let output = 0; output < length; output++) {
      carry += digits[output]! * radix;
      digits[output] = carry % 10;
      carry = Math.floor(carry / 10);
    }
    while (carry !== 0) {
      digits[length++] = carry % 10;
      carry = Math.floor(carry / 10);
    }
  }
  let result = "";
  for (let index = length - 1; index >= 0; index--) result += String(digits[index]!);
  return result;
}

export function decimalValue(input: string): string | number {
  const text = input.trim();
  if (text === "" || text === "Infinity" || text === "+Infinity" || text === "-Infinity")
    return Number(text);
  const prefix = text.slice(0, 2).toLowerCase();
  const radix = prefix === "0x" ? 16 : prefix === "0o" ? 8 : prefix === "0b" ? 2 : 0;
  if (radix !== 0) {
    const result = radixDecimal(text, radix);
    if (typeof result === "number") return result;
    const rounded = Number(result);
    return !Number.isFinite(rounded) || rounded === 0 ? rounded : result;
  }
  let index = text.charAt(0) === "-" || text.charAt(0) === "+" ? 1 : 0;
  let digits = 0;
  while (
    index < text.length &&
    digit(text.charCodeAt(index)) >= 0 &&
    digit(text.charCodeAt(index)) < 10
  ) {
    index++;
    digits++;
  }
  if (text.charAt(index) === ".") {
    index++;
    while (
      index < text.length &&
      digit(text.charCodeAt(index)) >= 0 &&
      digit(text.charCodeAt(index)) < 10
    ) {
      index++;
      digits++;
    }
  }
  if (digits === 0) return NaN;
  if (text.charAt(index) === "e" || text.charAt(index) === "E") {
    index++;
    if (text.charAt(index) === "-" || text.charAt(index) === "+") index++;
    const start = index;
    while (
      index < text.length &&
      digit(text.charCodeAt(index)) >= 0 &&
      digit(text.charCodeAt(index)) < 10
    )
      index++;
    if (start === index) return NaN;
  }
  if (index !== text.length) return NaN;
  const rounded = Number(text);
  return !Number.isFinite(rounded) || rounded === 0 ? rounded : text;
}

export function mathematicalValue(value: number | bigint | string | undefined): number | string {
  if (typeof value === "bigint") return String(value);
  if (typeof value === "string") return decimalValue(value);
  return Number(value);
}

export function rangeValue(value: number | string): string {
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  return String(value);
}
