// A CommonJS module written with ES export syntax, for require-of-named-exports.ts.
export const version = "1.0";
export function major(): number {
  return Number(version.split(".")[0]);
}
