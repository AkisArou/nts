// run: check
// backend: jvm
//
// **Throws `ClassCastException` on the JVM: an interface arm read after `in`
// picked it, on a class that fits the arm and is not its class.** `area`
// takes `Circle | Square`, and `Both` fits both. Prepared HIR for the JVM
// (`--backend jvm`, which preserves field access) reads each arm as `unerase
// %0 : managed<obj#N>` then `field.get`: a `checkcast` to that arm's class and
// a `getfield`. `Both` is a third class, so whichever arm it reaches throws,
// in every case that builds one -- 12 of 29, with 17 checked and agreeing.
//
// **Recorded on main b266dc665, where it throws at `Square`.** Main's `in`
// folded from the arms' members, so a `Both` took the `side` branch; C read
// `side` at `Square`'s index there and answered wrong in the same 12 cases.
// Part 2 stage B (6d43d310d) tests `in` over every object type, so a `Both`
// takes the `radius` branch, and the JVM throws at `Circle` instead -- this
// record then reads CHANGED, still aborted. On C, stage B's read is the
// accessor family's selector, `call.virtual
// Circle#nts$get$radius@interface1`, which every structural owner fills, and
// it agrees. The cases that build a `Round` or a `Block`, each laid out as its
// arm, are the control in the same program and agree on every backend.
//
// The JVM cannot read a common position across two classes the way C can
// (`blockers/union-members-lay-fields-out-differently`), and a matching index
// is not enough: probe `in-iface-agreeing` has a third class holding `read`
// where `Reader` does, and it throws the same way, as do probes
// `in-iface-chain` and `iface-reordered-arm` (all under the JVM lane's
// `mainctl/jvm-probes/probes`). With `Both` declared as `{ kind, radius }` its
// layout is `Round`'s, and the probe agrees on the JVM.
//
// What lifts it is the JVM's equivalent of the accessor rows: wherever the
// materialized lowering emits a selector, the preserved one emits an
// `OpenFieldGet` over the face's structural owners, each at its own index,
// which `chain_field_get` already renders as class tests.
//
// Found on 2026-10-12 by the JVM lane, reviewing stage B.

interface Circle {
  kind: number;
  radius: number;
}

interface Square {
  kind: number;
  side: number;
}

class Round {
  kind = 1;
  radius = 2;
}

class Block {
  kind = 2;
  side = 3;
}

/** Fits both arms, laid out as neither. */
class Both {
  kind = 3;
  side = 4;
  radius = 5;
}

function area(s: Circle | Square): number {
  return "radius" in s ? s.radius * 10 : s.side;
}

export function areaOfOne(n: number): number {
  const k = ((n % 3) + 3) % 3;
  const s: Circle | Square = k === 0 ? new Round() : k === 1 ? new Block() : new Both();
  return area(s) + s.kind * 1000;
}
