// A class instance passed through a closure call where a structural type is
// declared, the class holding the shared fields in another order.
//
// `callback(null, box)` with `callback: (error, shape: Shape) => void` and
// `box: Box`: TypeScript relates them structurally. At a direct call lowering
// refuses exactly this -- NTS1001 "a pointer cast between two structs that do
// not agree about where their shared fields are" (web-platform's
// MemoryEntry/HttpCacheEntry) -- and **at a closure call it does not**, so C
// hands the `Box *` over as a `Shape *` and reads `width` at `Box`'s first
// slot, which is `depth`'s. A silent wrong answer on C (and LLVM, by
// construction); the JVM declines with NTS4001, "storing a `Box` where a
// `Shape` is declared".
//
// Found through http: `Agent#createConnection` calls `callback(null, socket)`
// with a `Socket` where `HTTPDuplex` is declared (jvm-verifies cause I).
//
// **Control, measured:** the same class declaring its fields in `Shape`'s
// order, which agrees.
//
// **Expected, confirmed under node:** both arms `3`.
interface Shape {
  readonly width: number;
  readonly height: number;
}

class Reordered {
  depth = 300;
  height = 30;
  width = 3;
}

class Ordered {
  width = 3;
  height = 30;
  depth = 300;
}

let seen = 0;

function deliverReordered(callback: (error: unknown, shape: Shape) => void, box: Reordered): void {
  callback(null, box);
}

function deliverOrdered(callback: (error: unknown, shape: Shape) => void, box: Ordered): void {
  callback(null, box);
}

deliverReordered((_error, shape) => {
  seen = shape.width;
}, new Reordered());
observe("fields reordered", String(seen));
deliverOrdered((_error, shape) => {
  seen = shape.width;
}, new Ordered());
observe("fields in order (control)", String(seen));
done();
