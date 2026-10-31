// From octane-box2d: b2Body#Merge (benchmarks/cases/octane-box2d/case.ts:4241).
// The hoisted body2 var read in b2Body.Merge before its initializer; not an inferred closure-capture cause.
// Subject and control differ only by "    if (n > 0) seen = value;\n    var value: number | undefined = n;" -> "    var value: number | undefined = n;\n    if (n > 0) seen = value;".
// Refusal subject: tests/refusals/a-read-of-a-var-before-its-initializer.
class Holder {
  read(n: number): boolean {
    let seen: number | undefined;
    var value: number | undefined = n;
    if (n > 0) seen = value;
    return seen === undefined;
  }
}
export function probe(n: number): boolean { return new Holder().read(n); }
