// Development checks that a value React is about to turn into a string with
// `"" + value` can be: a Symbol or a Temporal object throws there, and the
// error message would point inside React instead of at the value.

function typeName(value: unknown): string {
  const tag =
    typeof value === "object" && value !== null
      ? (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag]
      : undefined;
  if (typeof tag === "string") {
    return tag;
  }
  if (typeof value === "object" && value !== null) {
    const constructorName = (value as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof constructorName === "string") {
      return constructorName;
    }
  }
  return typeof value === "symbol" ? "Symbol" : "Object";
}

function willCoercionThrow(value: unknown): boolean {
  try {
    testStringCoercion(value);
    return false;
  } catch {
    return true;
  }
}

function testStringCoercion(value: unknown): string {
  return "" + (value as string);
}

export function checkKeyStringCoercion(value: unknown): void {
  if (willCoercionThrow(value)) {
    console.error(
      "The provided key is an unsupported type %s." +
        " This value must be coerced to a string before using it here.",
      typeName(value),
    );
    testStringCoercion(value);
  }
}

export function checkPropStringCoercion(value: unknown, propName: string): void {
  if (willCoercionThrow(value)) {
    console.error(
      "The provided `%s` prop is an unsupported type %s." +
        " This value must be coerced to a string before using it here.",
      propName,
      typeName(value),
    );
    testStringCoercion(value);
  }
}
