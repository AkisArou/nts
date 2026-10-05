import { numberValue, stringValue } from "./options.ts";

// Shared Array/TypedArray traversal. The standard binding supplies element
// invocation with exactly (locales, options); TypedArray supplies its validated
// intrinsic length rather than reading an overridable property.
export function arrayLocaleString<T>(
  values: ArrayLike<T>,
  format: (value: T) => string,
  length: number = values.length,
): string {
  const numeric = numberValue(length);
  const count = numeric > 0 ? Math.min(Math.floor(numeric), Number.MAX_SAFE_INTEGER) : 0;
  let result = "";
  for (let index = 0; index < count; index++) {
    if (index > 0) result += ",";
    const value = values[index];
    if (value !== null && value !== undefined) result += stringValue(format(value));
  }
  return result;
}
