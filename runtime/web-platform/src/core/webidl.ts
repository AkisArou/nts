function roundTiesToEven(value: number): number {
  const lower = Math.floor(value);
  const fraction = value - lower;

  if (fraction < 0.5) {
    return lower;
  }
  if (fraction > 0.5) {
    return lower + 1;
  }
  return lower % 2 === 0 ? lower : lower + 1;
}

/** Enforce Web IDL's required-argument check before converting any argument. */
export function requireArguments(
  args: { readonly length: number },
  required: number,
  operation: string,
): void {
  if (args.length < required) {
    throw new TypeError(operation + " requires at least " + required + " argument(s)");
  }
}

/** Reject values that Web IDL cannot convert to a dictionary. */
export function requireDictionary(value: unknown, name: string): void {
  if (
    value !== undefined &&
    value !== null &&
    typeof value !== "object" &&
    typeof value !== "function"
  ) {
    throw new TypeError(name + " must be a dictionary");
  }
}

/** Apply Web IDL's JavaScript `boolean` conversion. */
export function coerceToBoolean(value: unknown): boolean {
  return value ? true : false;
}

function unsignedInteger(value: number, modulus: number): number {
  const number = +value;
  if (!Number.isFinite(number) || number === 0) {
    return 0;
  }
  const integer = number < 0 ? Math.ceil(number) : Math.floor(number);
  if (integer === 0) {
    return 0;
  }
  const remainder = integer % modulus;
  return remainder < 0 ? remainder + modulus : remainder;
}

/** Convert a number using Web IDL's default `unsigned short` rules. */
export function toUnsignedShort(value: number): number {
  return unsignedInteger(value, 65_536);
}

/** Convert a number using Web IDL's default `unsigned long` rules. */
export function toUnsignedLong(value: number): number {
  return unsignedInteger(value, 4_294_967_296);
}

/** Convert `[EnforceRange] unsigned long long` without narrowing it to a timer ABI. */
export function toEnforceRangeUnsignedLongLong(value: number): number {
  const number = +value;
  if (!Number.isFinite(number)) {
    throw new TypeError("Value is not a finite unsigned long long");
  }
  const integer = number < 0 ? Math.ceil(number) : Math.floor(number);
  // 2^64 is exactly representable; every representable value below it is in range.
  if (integer < 0 || integer >= 18_446_744_073_709_551_616) {
    throw new TypeError("Value is outside the unsigned long long range");
  }
  return integer === 0 ? 0 : integer;
}

/** Convert a number using Web IDL's `[Clamp] unsigned short` rules. */
export function toClampedUnsignedShort(value: number): number {
  const number = +value;
  if (Number.isNaN(number) || number <= 0) {
    return 0;
  }
  if (number >= 65_535) {
    return 65_535;
  }
  return roundTiesToEven(number);
}

/** Convert a number using Web IDL's `[Clamp] long long` rules. */
export function toClampedLongLong(value: number): number {
  const number = +value;
  if (Number.isNaN(number)) {
    return 0;
  }
  if (number <= Number.MIN_SAFE_INTEGER) {
    return Number.MIN_SAFE_INTEGER;
  }
  if (number >= Number.MAX_SAFE_INTEGER) {
    return Number.MAX_SAFE_INTEGER;
  }
  return roundTiesToEven(number);
}

/** Convert a number using Web IDL's default signed `long long` rules. */
export function toLongLong(value: number): number {
  const number = +value;
  if (!Number.isFinite(number) || number === 0) {
    return 0;
  }

  const integer = number < 0 ? Math.ceil(number) : Math.floor(number);
  // Every safe JavaScript integer is already within the signed 64-bit range.
  // Returning it directly also avoids losing the low bits while adding 2^64.
  if (Number.isSafeInteger(integer)) {
    return integer;
  }
  const modulus = 18_446_744_073_709_551_616;
  const signedBoundary = 9_223_372_036_854_775_808;
  let wrapped = integer % modulus;
  if (wrapped < 0) {
    wrapped += modulus;
  }
  return wrapped >= signedBoundary ? wrapped - modulus : wrapped;
}

/** Convert a TypeScript string to a Web IDL scalar-value string. */
export function toUSVString(value: string): string {
  let result = "";
  let runStart = 0;

  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);

    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
        continue;
      }
    } else if (unit < 0xdc00 || unit > 0xdfff) {
      continue;
    }

    result += value.slice(runStart, index) + "\ufffd";
    runStart = index + 1;
  }

  return runStart === 0 ? value : result + value.slice(runStart);
}

/** Apply Web IDL's JavaScript `DOMString` conversion. */
export function coerceToDOMString(value: unknown): string {
  return typeof value === "string" ? value : `${value}`;
}

/** Apply JavaScript string coercion before the typed `USVString` conversion. */
export function coerceToUSVString(value: unknown): string {
  return toUSVString(coerceToDOMString(value));
}

/** Apply Web IDL's JavaScript `ByteString` conversion. */
export function coerceToByteString(value: unknown): string {
  const text = coerceToDOMString(value);
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) > 255) {
      throw new TypeError("ByteString contains a code unit greater than 255");
    }
  }
  return text;
}
