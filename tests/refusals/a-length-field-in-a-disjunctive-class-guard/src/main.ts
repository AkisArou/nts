// expect: NTS1001 `length` of something without one is not supported by this lowering yet
// Reduced from the Modern Web Crypto profile findings.
// Only the property name changes from length to extent; the class layouts, values and disjunctive guard remain the same.
// Paired control: tests/programs/an-extent-field-in-a-disjunctive-class-guard.

class Base { readonly name = "key"; }
class First extends Base { constructor(readonly length: number) { super(); } }
class Second extends Base { constructor(readonly padding: number, readonly length: number) { super(); } }
function choose(n: number): Base | First | Second { if (n === 0) return new Base(); if (n < 0) return new First(7); return new Second(3, 9); }
export function width(n: number): number {
  const value = choose(n);
  if (value instanceof First || value instanceof Second) return value.length;
  return 0;
}
