/** A canonical Array index, whose maximum is 2^32 - 2. */
export function isArrayIndexKey(key: string): boolean {
  const length = key.length;
  if (length === 0 || length > 10) return false;

  let index = 0;
  for (let offset = 0; offset < length; offset++) {
    const digit = key.charCodeAt(offset) - 48;
    if (digit < 0 || digit > 9) return false;
    if (offset === 0 && digit === 0 && length > 1) return false;
    index = index * 10 + digit;
  }
  return index < 0xffff_ffff;
}

/**
 * The public, statically inspectable portion of a WHATWG URL.
 *
 * The TypeScript test lane can receive either NTS's URL or the host URL. A
 * structural boundary keeps util independent of node:url (which itself uses
 * util.inspect), while requiring enough of the URL contract that an ordinary
 * object with a coincidental `href` field is not treated as one.
 */
export interface URLValue {
  readonly [key: string]: unknown;
  readonly href: string;
  readonly origin: string;
  toJSON(): string;
}

export function isURLValue(value: unknown): value is URLValue {
  return (
    value !== null &&
    typeof value === "object" &&
    "href" in value &&
    typeof value.href === "string" &&
    "origin" in value &&
    typeof value.origin === "string" &&
    "toJSON" in value &&
    typeof value.toJSON === "function"
  );
}
