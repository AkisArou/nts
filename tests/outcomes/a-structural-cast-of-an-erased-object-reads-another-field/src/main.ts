// `caught as { stack?: string }` over an object of an unrelated class.
//
// A TypeScript `as` checks nothing at run time, and the lowering takes it at
// its word: the erased object is unerased into the anonymous `{ stack? }`
// layout and `.stack` reads that layout's erased field 0 out of whatever
// arrived. What it answers is whatever bytes `Unrelated` keeps there: while
// its layout was `first, second, label` the two integers printed "x0" where
// node prints "no stack" (under `nts check`, 2 where node answers -1, 58
// cases); since a class lays its parameter properties out first, as
// JavaScript defines them (`label, first, second`), the string pointer is
// read as a tag and the program dies of SIGSEGV. One defect, two symptoms.
// With a second class in the program that does have `stack` first -- the
// natural control -- the build was killed by SIGSEGV too, and an aborting
// program reports no arm, so the control is left out rather than erasing
// this one.
//
// Moved from blockers/a-cast-to-a-shape-reads-an-unrelated-class, which
// expected the old refusal (`Unrelated` where `{ stack? }` is wanted) and read
// FIXED once that refusal stopped being reached -- before 49d284ce4 -- while the
// program it guarded went on answering wrongly. A refusal that disappears is
// not a fix until the program agrees.
//
// The fix is a design choice, recorded in the compiler lane's plan: read a
// structurally cast field by name at run time, or refuse the unerase into a
// structural type (which would reach `err as { code?: string }` across the
// node runtime).
class Unrelated {
  first = 11;
  second = 22;
  constructor(public label: string) {}
}
function stackOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null) {
    const held = caught as { stack?: string };
    return typeof held.stack === "string" ? held.stack : "no stack";
  }
  return "not an object";
}
observe("unrelated", stackOf(new Unrelated("x0")));
done();
