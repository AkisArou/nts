// From octane-box2d: QueryCallback (benchmarks/cases/octane-box2d/case.ts:1244).
// QueryCallback compares proxy:Node|null with queryProxy:Node|null|undefined.
// Loose equality over unions that cannot coerce compiles as nullish
// identity (#147); until then it refused as a coercing `==` with no
// `ToPrimitive`. This holds its answer to node's.
// Subject and control differ only by "a == b" -> "a === b".
// Control: tests/programs/a-loose-equality-with-an-optional-nullable-object-control.
class Item { value = 1; }
function compare(a: Item | null, b: Item | null | undefined): boolean { return a == b; }
export function probe(n: number): boolean { const a = new Item(); return compare(n > 0 ? a : null, n > 1 ? a : undefined); }
