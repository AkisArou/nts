// The pure RFC codec behind `node:punycode` and `node:url` IDNA conversion.
//
// Punycode (RFC 3492) encodes a Unicode string as ASCII by writing the basic
// characters first, then a run-length-ish encoding of where the rest belong.
// The algorithm is the RFC's, variable for variable — `bias`, `delta`, `damp`
// and `skew` are its names, and renaming them would only make the reference
// harder to follow.
//
// The public deprecation warning deliberately does not live here: URL uses
// this codec internally, and importing `node:url` must not warn about a public
// `node:punycode` module the program never requested.

/** 2^31 - 1. Every overflow check in the RFC is against this. */
const maxInt = 2147483647;

const base = 36;
const tMin = 1;
const tMax = 26;
const skew = 38;
const damp = 700;
const initialBias = 72;
const initialN = 128;
const delimiter = "-";
const baseMinusTMin = base - tMin;

type ErrorType = "overflow" | "not-basic" | "invalid-input";
type DomainMapping = "to-ascii" | "to-unicode";

function error(type: ErrorType): never {
  switch (type) {
    case "overflow":
      throw new RangeError("Overflow: input needs wider integers to process");
    case "not-basic":
      throw new RangeError("Illegal input >= 0x80 (not a basic code point)");
    case "invalid-input":
      throw new RangeError("Invalid input");
  }
}

/** The separators RFC 3490 treats as a dot, including the CJK full-width ones. */
function isLabelSeparator(codeUnit: number): boolean {
  return codeUnit === 0x2e || codeUnit === 0x3002 || codeUnit === 0xff0e || codeUnit === 0xff61;
}

/** In an email address only the domain is encoded; the local part is left alone. */
function mapDomain(domain: string, mapping: DomainMapping): string {
  const firstAt = domain.indexOf("@");
  let domainStart = 0;
  let domainEnd = domain.length;
  let result = "";
  if (firstAt !== -1) {
    domainStart = firstAt + 1;
    result = domain.slice(0, domainStart);
    const secondAt = domain.indexOf("@", firstAt + 1);
    if (secondAt !== -1) domainEnd = secondAt;
  }

  let labelStart = domainStart;
  for (let index = domainStart; index <= domainEnd; index++) {
    const atEnd = index === domainEnd;
    if (!atEnd && !isLabelSeparator(domain.charCodeAt(index))) continue;

    const label = domain.slice(labelStart, index);
    if (mapping === "to-ascii") {
      result += hasNonASCII(label) ? `xn--${encode(label)}` : label;
    } else {
      result += label.startsWith("xn--") ? decode(label.slice(4).toLowerCase()) : label;
    }
    if (!atEnd) result += ".";
    labelStart = index + 1;
  }

  return result;
}

/**
 * UTF-16 code units to code points.
 *
 * An unmatched high surrogate is emitted alone and the counter steps back, so
 * that the following unit still gets its chance to be a pair's first half.
 */
export function ucs2decode(str: string): number[] {
  // A surrogate pair can only make the result shorter than the UTF-16 input.
  // Fill that fixed upper bound once and copy only when a pair was combined.
  const output = new Array<number>(str.length);
  let outputIndex = 0;
  let counter = 0;
  while (counter < str.length) {
    const value = str.charCodeAt(counter++);
    if (value >= 0xd800 && value <= 0xdbff && counter < str.length) {
      const extra = str.charCodeAt(counter++);
      if ((extra & 0xfc00) === 0xdc00) {
        output[outputIndex++] = ((value & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000;
      } else {
        output[outputIndex++] = value;
        counter--;
      }
    } else {
      output[outputIndex++] = value;
    }
  }
  return outputIndex === output.length ? output : output.slice(0, outputIndex);
}

export function ucs2encode(codePoints: readonly number[]): string {
  return codePointsToString(codePoints, codePoints.length);
}

function codePointsToString(codePoints: readonly number[], length: number): string {
  let result = "";
  for (let index = 0; index < length; index++) {
    const codePoint = codePoints[index];
    if (codePoint === undefined) {
      throw new RangeError("Invalid code point NaN");
    }
    result += String.fromCodePoint(codePoint);
  }
  return result;
}

/** A basic code point to its digit value, or `base` when it is not a digit. */
function basicToDigit(codePoint: number): number {
  if (codePoint >= 0x30 && codePoint < 0x3a) return 26 + (codePoint - 0x30);
  if (codePoint >= 0x41 && codePoint < 0x5b) return codePoint - 0x41;
  if (codePoint >= 0x61 && codePoint < 0x7b) return codePoint - 0x61;
  return base;
}

/** A digit value to its basic code point. `flag` uppercases it. */
function digitToBasic(digit: number, flag: number): number {
  return digit + 22 + 75 * (digit < 26 ? 1 : 0) - ((flag !== 0 ? 1 : 0) << 5);
}

/** RFC 3492 §6.1, the bias adaptation. */
function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let k = 0;
  delta = firstTime ? Math.floor(delta / damp) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  for (; delta > (baseMinusTMin * tMax) >> 1; k += base) {
    delta = Math.floor(delta / baseMinusTMin);
  }
  return Math.floor(k + ((baseMinusTMin + 1) * delta) / (delta + skew));
}

/** Punycode to Unicode, RFC 3492 §6.2. */
export function decode(input: string): string {
  const inputLength = input.length;
  // Every decoded point consumes at least one input code unit, so the input
  // length is an exact upper bound and insertion never needs to grow storage.
  const output = new Array<number>(inputLength);
  let outputLength = 0;
  let i = 0;
  let n = initialN;
  let bias = initialBias;

  // Everything before the last delimiter is basic and copied across as-is.
  let basic = input.lastIndexOf(delimiter);
  if (basic < 0) {
    basic = 0;
  }

  for (let j = 0; j < basic; ++j) {
    if (input.charCodeAt(j) >= 0x80) {
      error("not-basic");
    }
    output[outputLength++] = input.charCodeAt(j);
  }

  for (let index = basic > 0 ? basic + 1 : 0; index < inputLength;) {
    // A generalised variable-length integer, decoded most-significant last.
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (index >= inputLength) {
        error("invalid-input");
      }
      const digit = basicToDigit(input.charCodeAt(index++));
      if (digit >= base) {
        error("invalid-input");
      }
      if (digit > Math.floor((maxInt - i) / w)) {
        error("overflow");
      }
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) {
        break;
      }
      const baseMinusT = base - t;
      if (w > Math.floor(maxInt / baseMinusT)) {
        error("overflow");
      }
      w *= baseMinusT;
    }

    const out = outputLength + 1;
    bias = adapt(i - oldi, out, oldi === 0);

    // `i` was a delta over the whole output; fold the overflow into `n`.
    if (Math.floor(i / out) > maxInt - n) {
      error("overflow");
    }
    n += Math.floor(i / out);
    i %= out;

    for (let index = outputLength; index > i; index--) {
      // Positions below outputLength are initialized by construction.
      output[index] = output[index - 1]!;
    }
    output[i++] = n;
    outputLength = out;
  }

  return codePointsToString(output, outputLength);
}

/** Unicode to Punycode, RFC 3492 §6.3. */
export function encode(input: string): string {
  let output = "";
  const codePoints = ucs2decode(input);
  const inputLength = codePoints.length;

  let n = initialN;
  let delta = 0;
  let bias = initialBias;

  for (const value of codePoints) {
    if (value < 0x80) {
      output += String.fromCharCode(value);
    }
  }

  const basicLength = output.length;
  let handledCPCount = basicLength;

  if (basicLength) {
    output += delimiter;
  }

  while (handledCPCount < inputLength) {
    // The smallest code point at or above `n` that is still to be handled.
    let m = maxInt;
    for (const value of codePoints) {
      if (value >= n && value < m) {
        m = value;
      }
    }

    const handledCPCountPlusOne = handledCPCount + 1;
    if (m - n > Math.floor((maxInt - delta) / handledCPCountPlusOne)) {
      error("overflow");
    }

    delta += (m - n) * handledCPCountPlusOne;
    n = m;

    for (const value of codePoints) {
      if (value < n && ++delta > maxInt) {
        error("overflow");
      }
      if (value === n) {
        let q = delta;
        for (let k = base; ; k += base) {
          const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
          if (q < t) {
            break;
          }
          const qMinusT = q - t;
          const baseMinusT = base - t;
          output += String.fromCharCode(digitToBasic(t + (qMinusT % baseMinusT), 0));
          q = Math.floor(qMinusT / baseMinusT);
        }
        output += String.fromCharCode(digitToBasic(q, 0));
        bias = adapt(delta, handledCPCountPlusOne, handledCPCount === basicLength);
        delta = 0;
        ++handledCPCount;
      }
    }

    ++delta;
    ++n;
  }

  return output;
}

/** Decode every `xn--` label of a domain or email address. */
export function toUnicode(input: string): string {
  return mapDomain(input, "to-unicode");
}

/** Encode every non-ASCII label of a domain or email address. */
export function toASCII(input: string): string {
  return mapDomain(input, "to-ascii");
}

/** Node's basic range includes U+007F; only larger code units need encoding. */
function hasNonASCII(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c > 0x7f) {
      return true;
    }
  }
  return false;
}

export const version = "2.1.0";
