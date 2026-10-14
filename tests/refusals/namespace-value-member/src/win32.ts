// The half whose constants differ from the other's. `sep` is the one member
// where two namespaces of the same shape disagree in a way callers depend on.
export const sep = "\\";
export const delimiter = ";";

export function normalize(path: string): string {
  return path;
}
