// **The arms of `blockers/a-cast-to-a-shape-reads-an-unrelated-class` that must
// keep agreeing**, split from it on 2026-10-04 when its lying casts began to
// refuse: a blocker is only compiled, and these need running.
//
// **Two arms that agree today, and must keep agreeing.** A class narrowing that
// *travels*: proven by `instanceof` in `stash`, returned as `unknown`, and read
// with `as Leaf` in `readBack`, where no test dominates the read. Beside it, the
// same read under its own test. Both agree with node, by luck rather than by
// licence: the value really is a `Leaf`, nothing checks, and the read lands.
// They are the population a checked unerase -- the fix for the arms above, and
// for `a-narrowed-value-assigned-to-a-new-binding` -- could break. A change that
// made the lying casts above abort while quietly breaking these would pass every
// arm that existed before them. Constructed by the compiler lane on 2026-09-27;
// no corpus contains the shape.
class Base {
  kind = 1;
}

class Leaf extends Base {
  extra = 2;
}

function make(): Base {
  return new Leaf();
}

function stash(b: Base): unknown {
  if (b instanceof Leaf) return b;
  return null;
}

function readBack(held: unknown): number {
  return (held as Leaf).extra;
}

function travels(n: number): number {
  return readBack(stash(make())) * 100 + n;
}

function dominated(n: number): number {
  const b = make();
  if (b instanceof Leaf) return b.extra * 100 + n;
  return n;
}

observe("a narrowing that travels, read with `as Leaf` elsewhere", String(travels(3)));
observe("the same read under its own test", String(dominated(3)));
done();
