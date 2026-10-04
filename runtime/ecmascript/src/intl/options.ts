// ECMA-402 GetOption / DefaultNumberOption for the typed scalar boundary.
// Object-to-primitive hooks are outside the NTS object model.
export function stringOption<T extends string>(
  value: T | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  const text = stringValue(value);
  for (let i = 0; i < allowed.length; i++) {
    const candidate = allowed[i]!;
    if (text === candidate) return candidate;
  }
  throw new RangeError("Invalid Intl option: " + text);
}

export function optionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value);
}

export function stringValue(value: string): string {
  // String(symbol) permits a special constructor conversion; abstract ToString
  // rejects it. Public typed inputs generally rule it out before this boundary.
  if (typeof value === "symbol") throw new TypeError("Intl string options reject Symbols");
  return String(value);
}

export function numberValue(value: number): number {
  // Explicit Number(bigint) is permitted, unlike the abstract ToNumber operation.
  if (typeof value === "bigint" || typeof value === "symbol")
    throw new TypeError("Intl numeric inputs reject BigInts and Symbols");
  return Number(value);
}

export function numberOption(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const number = numberValue(value);
  if (!(number >= minimum && number <= maximum))
    throw new RangeError("Intl numeric option is out of range");
  return Math.floor(number);
}
