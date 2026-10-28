// Numeric member lookup uses the double's exact property-key spelling.
class K {
  [0.9999999999999999](): string {
    return "almost-one";
  }
}
const k = new K();
export const read = k[0.9999999999999999]();

// The control changes only the numeric key to its exact string spelling.
export const control = k["0.9999999999999999"]();
export function result(): string { return read; }
export function resultControl(): string { return control; }
