// expect: NTS1001 `==` between values whose types are not known to agree, which coerces -- and this compiler has no `ToPrimitive` to coerce with is not supported by this lowering yet
// From octane-box2d: QueryCallback (benchmarks/cases/octane-box2d/case.ts:1244).
// QueryCallback compares proxy:Node|null with queryProxy:Node|null|undefined.
// Subject and control differ only by "a == b" -> "a === b".
// Executable control: tests/programs/a-loose-equality-with-an-optional-nullable-object-control.
class Item { value = 1; }
function compare(a: Item | null, b: Item | null | undefined): boolean { return a == b; }
export function probe(n: number): boolean { const a = new Item(); return compare(n > 0 ? a : null, n > 1 ? a : undefined); }
