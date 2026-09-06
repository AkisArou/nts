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

function unsignedInteger(value: number, modulus: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return 0;
  }
  const integer = value < 0 ? Math.ceil(value) : Math.floor(value);
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

/** Convert a number using Web IDL's `[Clamp] unsigned short` rules. */
export function toClampedUnsignedShort(value: number): number {
  if (Number.isNaN(value) || value <= 0) {
    return 0;
  }
  if (value >= 65_535) {
    return 65_535;
  }
  return roundTiesToEven(value);
}

/** Convert a number using Web IDL's `[Clamp] long long` rules. */
export function toClampedLongLong(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value <= Number.MIN_SAFE_INTEGER) {
    return Number.MIN_SAFE_INTEGER;
  }
  if (value >= Number.MAX_SAFE_INTEGER) {
    return Number.MAX_SAFE_INTEGER;
  }
  return roundTiesToEven(value);
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
