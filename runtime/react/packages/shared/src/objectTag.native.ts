// A native value has no prototype to ask for its tag, so the tag is derived
// from what the value is. Two kinds of tag cannot be derived. The kinds of
// function (`[object AsyncFunction]`, `[object GeneratorFunction]`) are lost
// because a compiled function does not record how it was declared. A
// `Symbol.toStringTag` of the program's own is never read.

export function objectTag(value: unknown): string {
  if (value === undefined) {
    return "[object Undefined]";
  }
  if (value === null) {
    return "[object Null]";
  }
  switch (typeof value) {
    case "string":
      return "[object String]";
    case "number":
      return "[object Number]";
    case "boolean":
      return "[object Boolean]";
    case "bigint":
      return "[object BigInt]";
    case "symbol":
      return "[object Symbol]";
    case "function":
      return "[object Function]";
  }
  if (Array.isArray(value)) {
    return "[object Array]";
  }
  if (value instanceof Error) {
    return "[object Error]";
  }
  if (value instanceof Date) {
    return "[object Date]";
  }
  if (value instanceof RegExp) {
    return "[object RegExp]";
  }
  if (value instanceof Map) {
    return "[object Map]";
  }
  if (value instanceof Set) {
    return "[object Set]";
  }
  if (value instanceof Promise) {
    return "[object Promise]";
  }
  return "[object Object]";
}
