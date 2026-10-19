// Exports only types, and records that it was evaluated, for the import elision cases.
((globalThis as { evaluated?: string[] }).evaluated ??= []).push("shape-types");
export interface Shape {
  area(): number;
}
export type Unit = "cm" | "in";
