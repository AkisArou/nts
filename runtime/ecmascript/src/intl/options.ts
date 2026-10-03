// ECMA-402 GetOption / DefaultNumberOption for the typed scalar boundary.
// Object-to-primitive hooks are outside the NTS object model.
export function stringOption<T extends string>(
  value: T | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  // String(symbol) is a special constructor case, whereas ECMA-402's
  // abstract ToString conversion must reject a Symbol.
  if (typeof value === "symbol") throw new TypeError("Intl string options reject Symbols");
  const text = String(value);
  for (let i = 0; i < allowed.length; i++) {
    const candidate = allowed[i]!;
    if (text === candidate) return candidate;
  }
  throw new RangeError("Invalid Intl option: " + text);
}

export function optionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "symbol") throw new TypeError("Intl string options reject Symbols");
  return String(value);
}

export function numberOption(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  // Number(bigint) permits an explicit conversion that abstract ToNumber does
  // not. The public typed options normally rule these inputs out already.
  if (typeof value === "bigint" || typeof value === "symbol")
    throw new TypeError("Intl numeric options reject BigInts and Symbols");
  const number = Number(value);
  if (!(number >= minimum && number <= maximum))
    throw new RangeError("Intl numeric option is out of range");
  return Math.floor(number);
}
