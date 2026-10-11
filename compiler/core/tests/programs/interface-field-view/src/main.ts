interface Named { readonly name: string; }
class Ordered { readonly name = "ordered"; readonly extra = 1; }
class Reordered { readonly extra = 2; readonly name = "reordered"; }
export function nameOf(value: unknown): string { return (value as Named).name; }
export function ordered(): Named { return new Ordered(); }
export function reordered(): Named { return new Reordered(); }
export function exact(): Named { return { name: "exact" }; }
