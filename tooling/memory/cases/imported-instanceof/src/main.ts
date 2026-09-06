// `instanceof` against an imported class, in a loop.
//
// The operation is a descriptor comparison: a tag test on the erased value, a
// load of the header's descriptor, and a pointer compare against a static. It
// allocates nothing and changes no count, and this is what says so — a lowering
// that answered by asking the runtime to build something, or that retained the
// subject for the length of the test, would show up here and nowhere else,
// because the answers stay right either way.
//
// Imported deliberately. The bug this case follows was that an `instanceof`
// against a class one file away resolved to the *import site's* symbol, found
// no type under it, and was refused. Nothing about that is visible in a count —
// it is here so the fix is exercised by the counting suite rather than only by
// the differential.
import { Base, Leaf } from "./shapes.js";

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    const v: unknown = i % 2 === 0 ? new Leaf(i) : new Base();
    total = (total + (v instanceof Leaf ? 1 : 0)) | 0;
    total = (total + (v instanceof Base ? 2 : 0)) | 0;
  }
  return total;
}
