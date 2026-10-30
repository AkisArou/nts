// Reduced from the Modern Web Crypto profile findings.
// Only the property name changes from length to extent; the class layouts, values and disjunctive guard remain the same.
// Paired refusal: tests/refusals/a-length-field-in-a-disjunctive-class-guard.

class Base { readonly name = "key"; }
class First extends Base { constructor(readonly extent: number) { super(); } }
class Second extends Base { constructor(readonly padding: number, readonly extent: number) { super(); } }
function choose(n: number): Base | First | Second { if (n === 0) return new Base(); if (n < 0) return new First(7); return new Second(3, 9); }
export function width(n: number): number {
  const value = choose(n);
  if (value instanceof First || value instanceof Second) return value.extent;
  return 0;
}
