// A literal and runtime-built lone surrogate preserve the same UTF-16 data.
export function lonely(): number {
  return "\ud800".length;
}

/** A lone high surrogate keeps its exact UTF-16 code unit. */
export function code(): number {
  return "\ud800".charCodeAt(0);
}

/** Control: build the same lone surrogate at run time. */
export function built(): number {
  return String.fromCharCode(0xd800).length;
}

/** A valid pair keeps two code units. */
export function paired(): number {
  return "𐀀".length;
}

/** Control for the code-unit read: change only how the string is built. */
export function builtCode(): number {
  return String.fromCharCode(0xd800).charCodeAt(0);
}
